# SPDX-License-Identifier: AGPL-3.0-or-later
"""Domain logic: seeding, the comms plan (who talks/listens on which channel) and config pushes."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .bridge import Publisher
from .models import Channel, Device, DeviceEventConfig, Event, Organisation
from .schemas import DeviceEventConfigIn
from .settings import KEYS

DEFAULT_CHANNELS = ("Driver", "Engineers", "Pit Crew", "Team")
TALK_MODES = ("latch", "momentary")


class PlanError(Exception):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


def get_org(db: Session) -> Organisation:
    """Single-organisation mode for now; creates a demo org and event on first run."""
    org = db.scalars(select(Organisation).order_by(Organisation.id)).first()
    if org is None:
        org = Organisation(name="Demo Team")
        db.add(org)
        db.flush()
        event = Event(org_id=org.id, name="Practice Day", active=True)
        db.add(event)
        db.flush()
        for i, name in enumerate(DEFAULT_CHANNELS):
            db.add(Channel(event_id=event.id, name=name, position=i))
        db.commit()
    return org


def active_event(db: Session, org_id: int) -> Event | None:
    return db.scalars(select(Event).where(Event.org_id == org_id, Event.active.is_(True))).first()


# ---------- comms plan helpers ----------


def empty_keys() -> list[dict[str, Any]]:
    return [{"key": k, "channel_id": None, "mode": "latch", "volume": 70} for k in KEYS]


def talk_channels(keys: list[dict[str, Any]]) -> list[int]:
    return [k["channel_id"] for k in keys if k["channel_id"] is not None and k["mode"] in TALK_MODES]


def member_channels(keys: list[dict[str, Any]]) -> list[int]:
    """Channels the device hears (talk or listen-only keys). Keys set to "off" don't count."""
    return [k["channel_id"] for k in keys if k["channel_id"] is not None and k["mode"] != "off"]


def get_event_config(db: Session, device: Device, event: Event) -> DeviceEventConfig:
    """A device's settings for one event. New devices start on no channels."""
    dec = db.scalars(
        select(DeviceEventConfig).where(
            DeviceEventConfig.device_id == device.id, DeviceEventConfig.event_id == event.id
        )
    ).first()
    if dec is None:
        dec = DeviceEventConfig(
            device_id=device.id, event_id=event.id, keys=empty_keys(), ptt_channel_ids=[], call_channel_id=None
        )
        db.add(dec)
        db.flush()
    return dec


def plan_entry(dec: DeviceEventConfig, event: Event) -> dict[str, Any]:
    """A device's comms-plan entry, with references to deleted channels dropped."""
    valid = {c.id for c in event.channels}
    keys = [{**k, "channel_id": k["channel_id"] if k.get("channel_id") in valid else None} for k in dec.keys]
    talk, member = set(talk_channels(keys)), set(member_channels(keys))
    return {
        "device_id": dec.device_id,
        "keys": keys,
        "ptt_channel_ids": [c for c in dec.ptt_channel_ids if c in talk],
        "call_channel_id": dec.call_channel_id if dec.call_channel_id in member else None,
        "mic_gain_db": dec.mic_gain_db,
        "sidetone": dec.sidetone,
    }


def apply_config(dec: DeviceEventConfig, event: Event, body: DeviceEventConfigIn) -> None:
    """Replaces a device's whole plan entry (key editor). Validates against the event's channels."""
    valid = {c.id for c in event.channels}
    keys = [k.model_dump() for k in body.keys]
    assigned = [k["channel_id"] for k in keys if k["channel_id"] is not None]
    used = set(assigned) | set(body.ptt_channel_ids) | ({body.call_channel_id} - {None})
    if not used <= valid:
        raise PlanError(422, "Channel not in this event")
    if len(assigned) != len(set(assigned)):
        raise PlanError(422, "Each channel can only be on one key")
    if not set(body.ptt_channel_ids) <= set(talk_channels(keys)):
        raise PlanError(422, "Headset PTT can only talk on channels this device can talk on")
    if body.call_channel_id is not None and body.call_channel_id not in member_channels(keys):
        raise PlanError(422, "The call key can only send to a channel this device is on")
    dec.keys = keys
    dec.ptt_channel_ids = list(dict.fromkeys(body.ptt_channel_ids))
    dec.call_channel_id = body.call_channel_id
    dec.mic_gain_db = body.mic_gain_db
    dec.sidetone = body.sidetone


def set_membership(
    dec: DeviceEventConfig, channel_id: int, role: str, *, who: str, move_from: int | None = None
) -> None:
    """Puts a device on a channel as a talker or listener (or takes it off), allocating beltpack keys.

    `move_from` re-patches the key currently on that channel (drag a person from one channel to another).
    Headset PTT only ever targets talk channels; the call key only targets channels the device is on.
    """
    keys = [dict(k) for k in dec.keys]

    def find(cid: int) -> int | None:
        return next((i for i, k in enumerate(keys) if k["channel_id"] == cid), None)

    moving = move_from is not None and move_from != channel_id and role != "none"
    idx = find(channel_id)
    src = find(move_from) if moving else None
    if moving and src is None:
        raise PlanError(422, f"{who} isn't on the channel they're being moved from")

    if role == "none":
        if idx is not None:
            keys[idx] = {**keys[idx], "channel_id": None, "mode": "latch"}
    else:
        if idx is None:
            if src is not None:
                idx, src = src, None  # re-patch the moved key to the new channel
            else:
                idx = next((i for i, k in enumerate(keys) if k["channel_id"] is None), None)
            if idx is None:
                raise PlanError(
                    409, f"{who} already uses all {len(keys)} keys. Take them off another channel first."
                )
        current = keys[idx]["mode"]
        mode = "listen_only" if role == "listen" else (current if current in TALK_MODES else "latch")
        keys[idx] = {**keys[idx], "channel_id": channel_id, "mode": mode}
        if src is not None:  # already on the target channel: just drop the source channel
            keys[src] = {**keys[src], "channel_id": None, "mode": "latch"}

    ptt = list(dec.ptt_channel_ids)
    call = dec.call_channel_id
    if moving:  # PTT and call targets follow the moved key
        ptt = [channel_id if c == move_from else c for c in ptt]
        call = channel_id if call == move_from else call
    talk, member = talk_channels(keys), member_channels(keys)
    ptt = list(dict.fromkeys(c for c in ptt if c in talk))
    if role == "talk" and not ptt:
        ptt = [channel_id]
    if call not in member:
        call = member[0] if member else None

    dec.keys = keys
    dec.ptt_channel_ids = ptt
    dec.call_channel_id = call


def copy_event(db: Session, source: Event, target: Event) -> None:
    """Copies channels and every device's plan entry from one event to another."""
    id_map: dict[int, int] = {}
    for c in source.channels:
        new = Channel(event_id=target.id, name=c.name, position=c.position)
        db.add(new)
        db.flush()
        id_map[c.id] = new.id
    for dec in db.scalars(select(DeviceEventConfig).where(DeviceEventConfig.event_id == source.id)):
        db.add(
            DeviceEventConfig(
                device_id=dec.device_id,
                event_id=target.id,
                keys=[{**k, "channel_id": id_map.get(k["channel_id"])} for k in dec.keys],
                ptt_channel_ids=[id_map[c] for c in dec.ptt_channel_ids if c in id_map],
                call_channel_id=id_map.get(dec.call_channel_id) if dec.call_channel_id is not None else None,
                mic_gain_db=dec.mic_gain_db,
                sidetone=dec.sidetone,
            )
        )
    db.flush()


# ---------- device config ----------


def build_config(db: Session, device: Device) -> dict[str, Any]:
    """The full desired config sent to a device (retained on its config topic)."""
    cfg: dict[str, Any] = {
        "version": device.config_version,
        "name": device.name,
        "label": device.label,
        "admin": {"muted": device.muted, "disabled": device.disabled},
        "event": None,
        "channels": [],
        "keys": empty_keys(),
        "ptt_channel_ids": [],
        "call_channel_id": None,
        "mic_gain_db": 52,
        "sidetone": 20,
    }
    event = active_event(db, device.org_id)
    if event is None:
        return cfg
    entry = plan_entry(get_event_config(db, device, event), event)
    del entry["device_id"]
    cfg.update(
        event={"id": event.id, "name": event.name},
        channels=[{"id": c.id, "name": c.name} for c in event.channels],
        **entry,
    )
    return cfg


def push_config(db: Session, device: Device, publisher: Publisher, *, bump: bool = True) -> dict[str, Any]:
    if bump:
        device.config_version += 1
    cfg = build_config(db, device)
    db.commit()
    publisher.publish_config(device.id, cfg)
    return cfg


def push_all(db: Session, org: Organisation, publisher: Publisher, *, bump: bool = True) -> None:
    for device in db.scalars(select(Device).where(Device.org_id == org.id)):
        push_config(db, device, publisher, bump=bump)
