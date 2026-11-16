# SPDX-License-Identifier: AGPL-3.0-or-later
"""MQTT bridge, live device state and WebSocket fan-out."""

from __future__ import annotations

import asyncio
import json
import logging
import threading
import time
from collections.abc import Callable
from typing import Any, Protocol

import paho.mqtt.client as mqtt
from fastapi import WebSocket

from . import settings

log = logging.getLogger("portal.mqtt")


class Publisher(Protocol):
    def publish_config(self, device_id: str, config: dict[str, Any] | None) -> None: ...
    def publish_cmd(self, device_id: str, cmd: dict[str, Any]) -> None: ...


class LiveStore:
    """Latest online flag and state report per device (not persisted)."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._data: dict[str, dict[str, Any]] = {}

    def update(self, device_id: str, *, online: bool | None = None, state: dict | None = None) -> dict:
        with self._lock:
            entry = self._data.setdefault(device_id, {"online": False, "state": None, "last_seen": None})
            if online is not None:
                entry["online"] = online
            if state is not None:
                entry["state"] = state
                entry["online"] = True
                entry["last_seen"] = time.time()
            return dict(entry)

    def get(self, device_id: str) -> dict:
        with self._lock:
            return dict(self._data.get(device_id, {"online": False, "state": None, "last_seen": None}))

    def ids(self) -> list[str]:
        with self._lock:
            return list(self._data)

    def forget(self, device_id: str) -> None:
        with self._lock:
            self._data.pop(device_id, None)


class WsHub:
    def __init__(self) -> None:
        self._clients: set[WebSocket] = set()
        self.loop: asyncio.AbstractEventLoop | None = None

    async def add(self, ws: WebSocket) -> None:
        await ws.accept()
        self._clients.add(ws)

    def remove(self, ws: WebSocket) -> None:
        self._clients.discard(ws)

    async def _send_all(self, msg: dict) -> None:
        text = json.dumps(msg)
        for ws in list(self._clients):
            try:
                await ws.send_text(text)
            except Exception:
                self._clients.discard(ws)

    def broadcast(self, msg: dict) -> None:
        """Thread-safe: may be called from the MQTT thread or request handlers."""
        if self.loop is None or not self._clients:
            return
        asyncio.run_coroutine_threadsafe(self._send_all(msg), self.loop)


class MqttBridge:
    def __init__(self, store: LiveStore, hub: WsHub, host: str, port: int) -> None:
        self.store, self.hub = store, hub
        self.host, self.port = host, port
        # Called (from the MQTT thread) after every successful (re)connect.
        self.on_connected: Callable[[], None] | None = None
        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="oc-portal-api")
        self.client.on_connect = self._on_connect
        self.client.on_message = self._on_message
        self.client.reconnect_delay_set(1, 10)

    def start(self) -> None:
        self.client.connect_async(self.host, self.port, keepalive=30)
        self.client.loop_start()

    def stop(self) -> None:
        self.client.loop_stop()
        self.client.disconnect()

    def _on_connect(self, client, _userdata, _flags, reason_code, _props) -> None:
        if reason_code.is_failure:
            log.warning("MQTT connect failed: %s", reason_code)
            return
        log.info("Connected to MQTT broker %s:%s", self.host, self.port)
        client.subscribe([(f"{settings.TOPIC_ROOT}/+/state", 1), (f"{settings.TOPIC_ROOT}/+/online", 1)])
        if self.on_connected is not None:
            try:
                self.on_connected()
            except Exception:
                log.exception("on_connected hook failed")

    def _on_message(self, _client, _userdata, msg: mqtt.MQTTMessage) -> None:
        parts = msg.topic.split("/")
        if len(parts) != 4:
            return
        device_id, leaf = parts[2], parts[3]
        try:
            if leaf == "online":
                entry = self.store.update(device_id, online=msg.payload.decode() == "true")
            elif leaf == "state":
                entry = self.store.update(device_id, state=json.loads(msg.payload))
            else:
                return
        except (ValueError, UnicodeDecodeError):
            log.warning("Bad payload on %s", msg.topic)
            return
        self.hub.broadcast({"type": "live", "id": device_id, "live": entry})

    def publish_config(self, device_id: str, config: dict[str, Any] | None) -> None:
        payload = json.dumps(config) if config is not None else b""  # empty retained = clear
        self.client.publish(f"{settings.TOPIC_ROOT}/{device_id}/config", payload, qos=1, retain=True)

    def publish_cmd(self, device_id: str, cmd: dict[str, Any]) -> None:
        self.client.publish(f"{settings.TOPIC_ROOT}/{device_id}/cmd", json.dumps(cmd), qos=1)
