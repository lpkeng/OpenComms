# SPDX-License-Identifier: AGPL-3.0-or-later
"""Simulated OpenComms beltpacks for portal development.

Each simulated device speaks the real control-plane protocol (docs/architecture.md):
  oc/dev/{id}/online  retained "true"/"false" (last will)
  oc/dev/{id}/config  retained desired config  (subscribed)
  oc/dev/{id}/cmd     commands                  (subscribed)
  oc/dev/{id}/state   status reports            (published)

Devices it claims are named and put on channels as a motorsport crew (--scenario none to skip).

Usage:  python tools/device-sim/sim.py --count 6
"""

from __future__ import annotations

import argparse
import json
import random
import threading
import time
import urllib.error
import urllib.request

import paho.mqtt.client as mqtt

# Pit lane, Sydney Motorsport Park
BASE_LAT, BASE_LON = -33.8037, 150.8705
TALK_MODES = {"latch", "momentary"}


class SimBeltpack:
    def __init__(self, device_id: str, host: str, port: int, rng: random.Random) -> None:
        self.id = device_id
        self.rng = rng
        self.lock = threading.Lock()
        self.config: dict | None = None
        self.battery = rng.uniform(55, 100)
        self.charging = rng.random() < 0.15
        self.rssi = rng.uniform(-95, -70)
        self.lat = BASE_LAT + rng.uniform(-0.0015, 0.0015)
        self.lon = BASE_LON + rng.uniform(-0.0015, 0.0015)
        self.talk_key: str | None = None
        self.talk_until = 0.0
        self.alert_until = 0.0
        self.identify_until = 0.0
        self.started = time.time()

        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=device_id)
        self.client.will_set(self.topic("online"), "false", qos=1, retain=True)
        self.client.on_connect = self._on_connect
        self.client.on_message = self._on_message
        self.client.reconnect_delay_set(1, 10)
        self.client.connect_async(host, port, keepalive=15)
        self.client.loop_start()

    def topic(self, leaf: str) -> str:
        return f"oc/dev/{self.id}/{leaf}"

    def _on_connect(self, client, _u, _f, reason_code, _p) -> None:
        if reason_code.is_failure:
            return
        client.publish(self.topic("online"), "true", qos=1, retain=True)
        client.subscribe([(self.topic("config"), 1), (self.topic("cmd"), 1)])
        self.publish_state()

    def _on_message(self, _c, _u, msg: mqtt.MQTTMessage) -> None:
        if not msg.topic.startswith(f"oc/dev/{self.id}/"):
            return
        leaf = msg.topic.rsplit("/", 1)[-1]
        if leaf == "config":
            with self.lock:
                self.config = json.loads(msg.payload) if msg.payload else None
                self.talk_key = None
            v = self.config["version"] if self.config else "-"
            print(f"[{self.id}] applied config v{v}")
        elif leaf == "cmd":
            cmd = json.loads(msg.payload).get("cmd")
            now = time.time()
            with self.lock:
                if cmd == "call":
                    self.alert_until = now + 6
                elif cmd == "identify":
                    self.identify_until = now + 6
                elif cmd == "reboot":
                    self.started = now
                    self.talk_key = None
            print(f"[{self.id}] command: {cmd}")
        self.publish_state()

    def _can_talk(self) -> list[str]:
        cfg = self.config
        if not cfg or cfg["admin"]["muted"] or cfg["admin"]["disabled"]:
            return []
        return [k["key"] for k in cfg["keys"] if k["channel_id"] is not None and k["mode"] in TALK_MODES]

    def tick(self, dt: float) -> None:
        now = time.time()
        with self.lock:
            self.battery = min(100.0, self.battery + 0.05 * dt) if self.charging else max(0.0, self.battery - 0.01 * dt)
            self.rssi = max(-115.0, min(-60.0, self.rssi + self.rng.uniform(-2, 2)))
            self.lat += self.rng.uniform(-0.00004, 0.00004)
            self.lon += self.rng.uniform(-0.00004, 0.00004)
            if self.talk_key and (now > self.talk_until or self.talk_key not in self._can_talk()):
                self.talk_key = None
            elif not self.talk_key and self.rng.random() < 0.06:
                keys = self._can_talk()
                if keys:
                    self.talk_key = self.rng.choice(keys)
                    self.talk_until = now + self.rng.uniform(2, 6)
        self.publish_state()

    def publish_state(self) -> None:
        now = time.time()
        with self.lock:
            cfg = self.config
            state = {
                "kind": "beltpack",
                "fw": "0.1.0-sim",
                "config_version": cfg["version"] if cfg else None,
                "battery_pct": round(self.battery),
                "battery_v": round(3.3 + 0.9 * self.battery / 100, 2),
                "charging": self.charging,
                "net": "lte",
                "rssi_dbm": round(self.rssi),
                "gps": {"fix": True, "lat": round(self.lat, 6), "lon": round(self.lon, 6)},
                "listen": [k["key"] for k in cfg["keys"] if k["channel_id"] is not None and k["mode"] != "off"]
                if cfg and not cfg["admin"]["disabled"]
                else [],
                "talk": [self.talk_key] if self.talk_key else [],
                "alert": now < self.alert_until,
                "identify": now < self.identify_until,
                "uptime_s": int(now - self.started),
            }
        self.client.publish(self.topic("state"), json.dumps(state), qos=0)

    def stop(self) -> None:
        self.client.publish(self.topic("online"), "false", qos=1, retain=True).wait_for_publish(2)
        self.client.loop_stop()
        self.client.disconnect()


def api_call(api: str, method: str, path: str, body: dict | None = None) -> tuple[int, str]:
    req = urllib.request.Request(
        api + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json"},
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def api_post(api: str, path: str, body: dict) -> tuple[int, str]:
    return api_call(api, "POST", path, body)


# Demo crew for the "motorsport" scenario: (name, label, {channel: role}, headset PTT channel).
# The Driver channel is the classic example: engineer and driver talk, the data engineer only listens in.
MOTORSPORT_CREW = [
    ("Sam", "Race Engineer", {"Driver": "talk", "Engineers": "talk", "Pit Crew": "talk", "Team": "listen"}, "Driver"),
    ("Alex", "Driver (Car 7)", {"Driver": "talk"}, "Driver"),
    ("Jordan", "Data Engineer", {"Driver": "listen", "Engineers": "talk", "Team": "listen"}, "Engineers"),
    ("Chris", "Crew Chief", {"Pit Crew": "talk", "Engineers": "listen", "Team": "listen"}, "Pit Crew"),
    ("Taylor", "Team Manager", {"Driver": "listen", "Engineers": "listen", "Pit Crew": "listen", "Team": "talk"}, "Team"),
]


def apply_scenario(api: str, newly_claimed: list[str]) -> None:
    """Names the newly claimed devices and puts them on channels (only devices claimed in this run)."""
    status, body = api_call(api, "GET", "/api/events")
    event = next((e for e in json.loads(body) if e["active"]), None) if status == 200 else None
    if event is None:
        print("  (scenario skipped: no active event)")
        return
    channel_ids = {c["name"]: c["id"] for c in event["channels"]}
    for device_id, (name, label, roles, ptt) in zip(newly_claimed, MOTORSPORT_CREW):
        if not set(roles) <= set(channel_ids):
            print(f"  (scenario skipped for {device_id}: event lacks channels {sorted(set(roles) - set(channel_ids))})")
            continue
        keys = [{"key": k, "channel_id": None, "mode": "latch", "volume": 70} for k in "ABCD"]
        for key, (channel, role) in zip(keys, roles.items()):
            key.update(channel_id=channel_ids[channel], mode="latch" if role == "talk" else "listen_only")
        body = {
            "name": name,
            "label": label,
            "keys": keys,
            "ptt_channel_ids": [channel_ids[ptt]],
            "call_channel_id": channel_ids[ptt],
        }
        status, detail = api_call(api, "PUT", f"/api/events/{event['id']}/plan/{device_id}", body)
        print(f"  {device_id} -> {name} ({label})" if status == 200 else f"  {device_id}: scenario failed {status} {detail}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--count", type=int, default=6)
    ap.add_argument("--broker", default="127.0.0.1:1883")
    ap.add_argument("--api", default="http://127.0.0.1:8000")
    ap.add_argument("--claim", type=int, default=None, help="auto-claim the first N devices (default: all but one)")
    ap.add_argument(
        "--scenario",
        choices=("motorsport", "none"),
        default="motorsport",
        help="name newly claimed devices and put them on channels (default: motorsport crew)",
    )
    ap.add_argument("--seed", type=int, default=1)
    args = ap.parse_args()

    host, port = args.broker.split(":")
    rng = random.Random(args.seed)
    ids = [f"bp-{i:03d}" for i in range(1, args.count + 1)]
    codes = {i: f"{rng.randint(1000, 9999)}-{rng.randint(1000, 9999)}" for i in ids}
    n_claim = args.count - 1 if args.claim is None else args.claim

    print("Provisioning simulated devices via", args.api)
    newly_claimed = []
    for i, device_id in enumerate(ids):
        status, _ = api_post(args.api, "/api/dev/provision", {"id": device_id, "claim_code": codes[device_id]})
        if status >= 300:
            raise SystemExit(f"Provisioning failed ({status}). Is the portal API running at {args.api}?")
        claimed = ""
        if i < n_claim:
            status, _ = api_post(args.api, "/api/devices/claim", {"id": device_id, "claim_code": codes[device_id]})
            claimed = "claimed" if status == 201 else ("already claimed" if status == 409 else f"claim failed {status}")
            if status == 201:
                newly_claimed.append(device_id)
        print(f"  {device_id}  claim code {codes[device_id]}  {claimed}")
    if args.scenario == "motorsport" and newly_claimed:
        print("Setting up the demo crew:")
        apply_scenario(args.api, newly_claimed)

    devices = [SimBeltpack(d, host, int(port), random.Random(f"{args.seed}-{d}")) for d in ids]
    print(f"Running {len(devices)} simulated beltpacks. Ctrl+C to stop.")
    try:
        while True:
            time.sleep(2)
            for d in devices:
                d.tick(2)
    except KeyboardInterrupt:
        pass
    finally:
        for d in devices:
            d.stop()


if __name__ == "__main__":
    main()
