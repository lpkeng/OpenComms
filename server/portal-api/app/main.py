# SPDX-License-Identifier: AGPL-3.0-or-later
"""OpenComms portal API (v0).

Run (dev):  uvicorn app.main:app --reload   (from server/portal-api)
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Iterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from . import db as dbmod
from . import schemas, services, settings
from .bridge import LiveStore, MqttBridge, Publisher, WsHub
from .models import Channel, Device, DeviceEventConfig, Event, ProvisionedDevice

log = logging.getLogger("portal")


def create_app(
    session_factory: sessionmaker = dbmod.SessionLocal,
    engine=dbmod.engine,
    publisher: Publisher | None = None,
    start_mqtt: bool = settings.MQTT_ENABLED,
) -> FastAPI:
    store = LiveStore()
    hub = WsHub()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        hub.loop = asyncio.get_running_loop()
        dbmod.Base.metadata.create_all(engine)
        with session_factory() as s:
            services.get_org(s)
        bridge = None
        if publisher is None:
            bridge = MqttBridge(store, hub, settings.MQTT_HOST, settings.MQTT_PORT)
            app.state.publisher = bridge

            def republish() -> None:
                # Re-assert retained configs after (re)connecting, e.g. after a broker restart.
                with session_factory() as s:
                    services.push_all(s, services.get_org(s), bridge, bump=False)

            bridge.on_connected = republish
            if start_mqtt:
                bridge.start()
        else:
            app.state.publisher = publisher
        yield
        if bridge is not None and start_mqtt:
            bridge.stop()

    app = FastAPI(title="OpenComms Portal API", version="0.1.0", lifespan=lifespan)
    app.state.store = store
    app.state.hub = hub

    def get_db() -> Iterator[Session]:
        s = session_factory()
        try:
            yield s
        finally:
            s.close()

    def pub() -> Publisher:
        return app.state.publisher

    def changed() -> None:
        hub.broadcast({"type": "changed"})

    # ---------- helpers ----------

    def device_view(d: Device) -> dict[str, Any]:
        live = store.get(d.id)
        applied = (live["state"] or {}).get("config_version")
        return {
            "id": d.id,
            "kind": d.kind,
            "name": d.name,
            "label": d.label,
            "muted": d.muted,
            "disabled": d.disabled,
            "config_version": d.config_version,
            "applied_version": applied,
            "in_sync": applied == d.config_version,
            "online": live["online"],
            "last_seen": live["last_seen"],
            "state": live["state"],
        }

    def get_device(db: Session, device_id: str) -> Device:
        org = services.get_org(db)
        d = db.get(Device, device_id)
        if d is None or d.org_id != org.id:
            raise HTTPException(404, "Device not found")
        return d

    def get_event(db: Session, event_id: int) -> Event:
        org = services.get_org(db)
        e = db.get(Event, event_id)
        if e is None or e.org_id != org.id:
            raise HTTPException(404, "Event not found")
        return e

    def event_view(e: Event) -> dict[str, Any]:
        return {
            "id": e.id,
            "name": e.name,
            "active": e.active,
            "channels": [{"id": c.id, "name": c.name} for c in e.channels],
        }

    def push_if_active(db: Session, event: Event) -> None:
        if event.active:
            services.push_all(db, event.org, pub())
            changed()

    # ---------- organisation / events / channels ----------

    @app.get("/api/org")
    def org_info(db: Session = Depends(get_db)):
        org = services.get_org(db)
        ev = services.active_event(db, org.id)
        return {"id": org.id, "name": org.name, "active_event_id": ev.id if ev else None}

    @app.get("/api/events")
    def list_events(db: Session = Depends(get_db)):
        org = services.get_org(db)
        return [event_view(e) for e in db.scalars(select(Event).where(Event.org_id == org.id).order_by(Event.id))]

    @app.post("/api/events", status_code=201)
    def create_event(body: schemas.EventCreate, db: Session = Depends(get_db)):
        org = services.get_org(db)
        source = get_event(db, body.copy_from_event_id) if body.copy_from_event_id is not None else None
        e = Event(org_id=org.id, name=body.name, active=False)
        db.add(e)
        db.flush()
        if source is not None:
            services.copy_event(db, source, e)
        else:
            for i, name in enumerate(services.DEFAULT_CHANNELS):
                db.add(Channel(event_id=e.id, name=name, position=i))
        db.commit()
        db.refresh(e)
        changed()
        return event_view(e)

    @app.patch("/api/events/{event_id}")
    def rename_event(event_id: int, body: schemas.EventIn, db: Session = Depends(get_db)):
        e = get_event(db, event_id)
        e.name = body.name
        db.commit()
        push_if_active(db, e)
        return event_view(e)

    @app.delete("/api/events/{event_id}", status_code=204)
    def delete_event(event_id: int, db: Session = Depends(get_db)):
        e = get_event(db, event_id)
        if e.active:
            raise HTTPException(409, "Can't delete the active event; activate another event first")
        db.delete(e)
        db.commit()
        changed()

    @app.post("/api/events/{event_id}/activate")
    def activate_event(event_id: int, db: Session = Depends(get_db)):
        e = get_event(db, event_id)
        for other in db.scalars(select(Event).where(Event.org_id == e.org_id)):
            other.active = other.id == e.id
        db.commit()
        services.push_all(db, e.org, pub())
        changed()
        return event_view(e)

    @app.post("/api/events/{event_id}/channels", status_code=201)
    def add_channel(event_id: int, body: schemas.ChannelIn, db: Session = Depends(get_db)):
        e = get_event(db, event_id)
        db.add(Channel(event_id=e.id, name=body.name, position=len(e.channels)))
        db.commit()
        db.refresh(e)
        push_if_active(db, e)
        changed()
        return event_view(e)

    @app.patch("/api/channels/{channel_id}")
    def rename_channel(channel_id: int, body: schemas.ChannelIn, db: Session = Depends(get_db)):
        c = db.get(Channel, channel_id)
        if c is None:
            raise HTTPException(404, "Channel not found")
        e = get_event(db, c.event_id)
        c.name = body.name
        db.commit()
        push_if_active(db, e)
        changed()
        return event_view(e)

    @app.delete("/api/channels/{channel_id}", status_code=204)
    def delete_channel(channel_id: int, db: Session = Depends(get_db)):
        c = db.get(Channel, channel_id)
        if c is None:
            raise HTTPException(404, "Channel not found")
        e = get_event(db, c.event_id)
        for dec in db.scalars(select(DeviceEventConfig).where(DeviceEventConfig.event_id == e.id)):
            dec.keys = [{**k, "channel_id": None if k["channel_id"] == c.id else k["channel_id"]} for k in dec.keys]
            if dec.ptt_channel_id == c.id:
                dec.ptt_channel_id = None
            if dec.call_channel_id == c.id:
                dec.call_channel_id = None
        db.delete(c)
        db.commit()
        db.refresh(e)
        push_if_active(db, e)
        changed()

    @app.post("/api/channels/{channel_id}/call")
    def call_channel(channel_id: int, db: Session = Depends(get_db)):
        c = db.get(Channel, channel_id)
        if c is None:
            raise HTTPException(404, "Channel not found")
        e = get_event(db, c.event_id)
        if not e.active:
            raise HTTPException(409, "Channel is not in the active event")
        sent = []
        for d in db.scalars(select(Device).where(Device.org_id == e.org_id)):
            dec = services.get_event_config(db, d, e)
            if c.id in services.member_channels(dec.keys):
                pub().publish_cmd(d.id, {"cmd": "call", "channel_id": c.id, "from": "portal"})
                sent.append(d.id)
        db.commit()
        return {"sent_to": sent}

    # ---------- devices ----------

    @app.get("/api/devices")
    def list_devices(db: Session = Depends(get_db)):
        org = services.get_org(db)
        out = []
        for d in db.scalars(select(Device).where(Device.org_id == org.id).order_by(Device.id)):
            out.append({**device_view(d), "config": services.build_config(db, d)})
        db.commit()  # build_config may create default per-event settings
        return out

    @app.get("/api/devices/discovered")
    def discovered(db: Session = Depends(get_db)):
        claimed = set(db.scalars(select(Device.id)))
        out = []
        for device_id in sorted(set(store.ids()) - claimed):
            live = store.get(device_id)
            prov = db.get(ProvisionedDevice, device_id)
            out.append(
                {
                    "id": device_id,
                    "kind": prov.kind if prov else (live["state"] or {}).get("kind", "beltpack"),
                    "provisioned": prov is not None,
                    "online": live["online"],
                }
            )
        return out

    @app.post("/api/devices/claim", status_code=201)
    def claim(body: schemas.ClaimIn, db: Session = Depends(get_db)):
        org = services.get_org(db)
        prov = db.get(ProvisionedDevice, body.id)
        if prov is None or prov.claim_code != body.claim_code:
            raise HTTPException(400, "Unknown device ID or wrong claim code")
        if db.get(Device, body.id) is not None:
            raise HTTPException(409, "Device already claimed")
        d = Device(id=prov.id, org_id=org.id, kind=prov.kind, name=prov.id)
        db.add(d)
        db.flush()
        services.push_config(db, d, pub())
        changed()
        return device_view(d)

    @app.get("/api/devices/{device_id}")
    def device_detail(device_id: str, db: Session = Depends(get_db)):
        d = get_device(db, device_id)
        view = device_view(d)
        view["config"] = services.build_config(db, d)
        db.commit()
        return view

    @app.patch("/api/devices/{device_id}")
    def update_device(device_id: str, body: schemas.DeviceUpdate, db: Session = Depends(get_db)):
        d = get_device(db, device_id)
        if body.name is not None:
            d.name = body.name
        if body.label is not None:
            d.label = body.label
        services.push_config(db, d, pub())
        changed()
        return device_view(d)

    @app.delete("/api/devices/{device_id}", status_code=204)
    def unclaim(device_id: str, db: Session = Depends(get_db)):
        d = get_device(db, device_id)
        db.delete(d)
        db.commit()
        pub().publish_config(device_id, None)
        changed()

    def save_plan(db: Session, device: Device, event: Event) -> None:
        """Commits a plan change; devices only receive it if the event is active."""
        if event.active:
            services.push_config(db, device, pub())
        else:
            db.commit()
        changed()

    def write_config(db: Session, d: Device, e: Event, body: schemas.DeviceEventConfigIn) -> None:
        dec = services.get_event_config(db, d, e)
        try:
            services.apply_config(dec, e, body)
        except services.PlanError as err:
            db.rollback()
            raise HTTPException(err.status, err.detail) from None
        if body.name is not None:
            d.name = body.name
        if body.label is not None:
            d.label = body.label
        save_plan(db, d, e)

    @app.put("/api/devices/{device_id}/config")
    def set_device_config(device_id: str, body: schemas.DeviceEventConfigIn, db: Session = Depends(get_db)):
        """Sets a device's config for the active event."""
        d = get_device(db, device_id)
        e = services.active_event(db, d.org_id)
        if e is None:
            raise HTTPException(409, "No active event")
        write_config(db, d, e, body)
        return {**device_view(d), "config": services.build_config(db, d)}

    # ---------- comms plan ----------

    @app.get("/api/events/{event_id}/plan")
    def get_plan(event_id: int, db: Session = Depends(get_db)):
        """Who is on which channel (and how) for one event, for every claimed device."""
        e = get_event(db, event_id)
        devices = db.scalars(select(Device).where(Device.org_id == e.org_id).order_by(Device.id))
        entries = [services.plan_entry(services.get_event_config(db, d, e), e) for d in devices]
        db.commit()  # get_event_config may create empty entries for new devices
        return {"event": event_view(e), "devices": entries}

    @app.put("/api/events/{event_id}/plan/{device_id}")
    def put_plan_entry(event_id: int, device_id: str, body: schemas.DeviceEventConfigIn, db: Session = Depends(get_db)):
        e = get_event(db, event_id)
        d = get_device(db, device_id)
        write_config(db, d, e, body)
        return services.plan_entry(services.get_event_config(db, d, e), e)

    @app.put("/api/events/{event_id}/plan/{device_id}/channels/{channel_id}")
    def set_membership(
        event_id: int, device_id: str, channel_id: int, body: schemas.MembershipIn, db: Session = Depends(get_db)
    ):
        """Puts a device on a channel as talk & listen or listen only, or takes it off ("none")."""
        e = get_event(db, event_id)
        d = get_device(db, device_id)
        valid = {c.id for c in e.channels}
        if channel_id not in valid or (body.move_from_channel_id not in valid | {None}):
            raise HTTPException(404, "Channel not in this event")
        dec = services.get_event_config(db, d, e)
        try:
            services.set_membership(
                dec, channel_id, body.role, who=d.name or d.id, move_from=body.move_from_channel_id
            )
        except services.PlanError as err:
            db.rollback()
            raise HTTPException(err.status, err.detail) from None
        save_plan(db, d, e)
        return services.plan_entry(dec, e)

    @app.post("/api/devices/{device_id}/admin")
    def set_admin(device_id: str, body: schemas.AdminUpdate, db: Session = Depends(get_db)):
        d = get_device(db, device_id)
        if body.muted is not None:
            d.muted = body.muted
        if body.disabled is not None:
            d.disabled = body.disabled
        services.push_config(db, d, pub())
        changed()
        return device_view(d)

    @app.post("/api/devices/{device_id}/cmd", status_code=202)
    def send_cmd(device_id: str, body: schemas.CommandIn, db: Session = Depends(get_db)):
        d = get_device(db, device_id)
        pub().publish_cmd(d.id, {"cmd": body.cmd, "from": "portal"})
        return {"sent": body.cmd}

    # ---------- dev-only provisioning ----------

    if settings.DEV_MODE:

        @app.post("/api/dev/provision", status_code=201)
        def provision(body: schemas.ProvisionIn, db: Session = Depends(get_db)):
            """Stand-in for QR code + Bluetooth adoption (dev only)."""
            prov = db.get(ProvisionedDevice, body.id)
            if prov is None:
                db.add(ProvisionedDevice(id=body.id, kind=body.kind, claim_code=body.claim_code))
            else:
                prov.kind, prov.claim_code = body.kind, body.claim_code
            db.commit()
            return {"id": body.id}

    # ---------- live updates ----------

    @app.websocket("/api/ws")
    async def ws(websocket: WebSocket):
        await hub.add(websocket)
        try:
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            hub.remove(websocket)

    if settings.WEB_DIST.is_dir():
        app.mount("/", StaticFiles(directory=settings.WEB_DIST, html=True), name="web")

    return app


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
app = create_app()
