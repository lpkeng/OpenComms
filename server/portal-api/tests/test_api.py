# SPDX-License-Identifier: AGPL-3.0-or-later
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import create_app


class FakePublisher:
    def __init__(self):
        self.configs: list[tuple[str, dict | None]] = []
        self.cmds: list[tuple[str, dict]] = []

    def publish_config(self, device_id, config):
        self.configs.append((device_id, config))

    def publish_cmd(self, device_id, cmd):
        self.cmds.append((device_id, cmd))

    def last_config(self, device_id):
        return [c for d, c in self.configs if d == device_id][-1]


@pytest.fixture
def ctx():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    pub = FakePublisher()
    app = create_app(session_factory=sessionmaker(bind=engine, expire_on_commit=False), engine=engine, publisher=pub)
    with TestClient(app) as client:
        client.post("/api/dev/provision", json={"id": "bp-001", "claim_code": "1234-5678"})
        yield client, pub, app


def claim(client, device_id="bp-001", code="1234-5678"):
    return client.post("/api/devices/claim", json={"id": device_id, "claim_code": code})


def test_claim_requires_correct_code_and_pushes_first_config(ctx):
    client, pub, _ = ctx
    assert claim(client, code="wrong").status_code == 400
    assert claim(client, "bp-999").status_code == 400

    r = claim(client)
    assert r.status_code == 201
    cfg = pub.last_config("bp-001")
    assert cfg["version"] == 1
    assert [k["key"] for k in cfg["keys"]] == ["A", "B", "C", "D"]
    # New devices start on no channels: nobody can talk anywhere until the comms plan says so.
    assert all(k["channel_id"] is None for k in cfg["keys"])
    assert cfg["ptt_channel_ids"] == [] and cfg["call_channel_id"] is None
    assert claim(client).status_code == 409


def test_config_change_bumps_version_and_tracks_device_sync(ctx):
    client, pub, app = ctx
    claim(client)
    chans = client.get("/api/events").json()[0]["channels"]
    body = {
        "keys": [
            {"key": "A", "channel_id": chans[1]["id"], "mode": "momentary", "volume": 40},
            {"key": "B", "channel_id": None, "mode": "latch", "volume": 70},
            {"key": "C", "channel_id": chans[2]["id"], "mode": "listen_only", "volume": 70},
            {"key": "D", "channel_id": chans[3]["id"], "mode": "off", "volume": 70},
        ],
        "ptt_channel_ids": [chans[1]["id"]],
        "call_channel_id": chans[1]["id"],
        "mic_gain_db": 55,
        "sidetone": 10,
    }
    r = client.put("/api/devices/bp-001/config", json=body)
    assert r.status_code == 200
    cfg = pub.last_config("bp-001")
    assert cfg["version"] == 2
    assert cfg["keys"][0] == {"key": "A", "channel_id": chans[1]["id"], "mode": "momentary", "volume": 40}

    assert client.get("/api/devices").json()[0]["in_sync"] is False
    app.state.store.update("bp-001", state={"config_version": 2})
    dev = client.get("/api/devices").json()[0]
    assert dev["in_sync"] is True and dev["online"] is True


def test_config_validation(ctx):
    client, _, _ = ctx
    claim(client)
    chans = [c["id"] for c in client.get("/api/events").json()[0]["channels"]]

    def put(keys, **extra):
        body = {"keys": [{"key": k, "channel_id": c, "mode": m} for k, (c, m) in zip("ABCD", keys)], **extra}
        return client.put("/api/devices/bp-001/config", json=body)

    free = (None, "latch")
    assert put([(99999, "latch"), free, free, free]).status_code == 422  # not in the event
    assert client.put("/api/devices/bp-001/config", json={"keys": [{"key": "A"}]}).status_code == 422
    assert put([(chans[0], "latch"), (chans[0], "listen_only"), free, free]).status_code == 422  # same channel twice
    listen_only = [(chans[0], "listen_only"), free, free, free]
    r = put(listen_only, ptt_channel_ids=[chans[0]])
    assert r.status_code == 422 and "PTT" in r.json()["detail"]  # PTT can't talk on a listen-only channel
    assert put(listen_only, call_channel_id=chans[1]).status_code == 422  # call to a channel it isn't on
    assert put(listen_only, call_channel_id=chans[0]).status_code == 200


def test_membership_allocates_keys_and_keeps_ptt_and_call_consistent(ctx):
    client, pub, _ = ctx
    claim(client)
    event = client.get("/api/events").json()[0]
    chans = [c["id"] for c in event["channels"]]
    url = f"/api/events/{event['id']}/plan/bp-001/channels"

    def member(channel, role, **extra):
        return client.put(f"{url}/{channel}", json={"role": role, **extra})

    r = member(chans[0], "talk")
    entry = r.json()
    assert entry["keys"][0]["channel_id"] == chans[0] and entry["keys"][0]["mode"] == "latch"
    assert entry["ptt_channel_ids"] == [chans[0]] and entry["call_channel_id"] == chans[0]
    assert pub.last_config("bp-001")["keys"][0]["channel_id"] == chans[0]  # active event: pushed live

    entry = member(chans[1], "listen").json()
    assert entry["keys"][1] == {"key": "B", "channel_id": chans[1], "mode": "listen_only", "volume": 70}
    assert entry["ptt_channel_ids"] == [chans[0]]

    # Demoting to listen-only removes PTT there; the call key stays (still on the channel).
    entry = member(chans[0], "listen").json()
    assert entry["keys"][0]["mode"] == "listen_only"
    assert entry["ptt_channel_ids"] == [] and entry["call_channel_id"] == chans[0]

    # Dragging between channels re-patches the same key, and PTT/call follow it.
    member(chans[0], "talk")
    entry = member(chans[2], "talk", move_from_channel_id=chans[0]).json()
    assert entry["keys"][0]["channel_id"] == chans[2]
    assert chans[0] not in [k["channel_id"] for k in entry["keys"]]
    assert entry["ptt_channel_ids"] == [chans[2]] and entry["call_channel_id"] == chans[2]

    # Removing the call channel falls back to another channel the device is on.
    entry = member(chans[2], "none").json()
    assert entry["keys"][0]["channel_id"] is None
    assert entry["ptt_channel_ids"] == [] and entry["call_channel_id"] == chans[1]

    # A beltpack has 4 keys, so it can be on at most 4 channels.
    extra = client.post(f"/api/events/{event['id']}/channels", json={"name": "Spare"}).json()["channels"][-1]["id"]
    for c in (chans[0], chans[2], chans[3]):
        assert member(c, "listen").status_code == 200
    r = member(extra, "listen")
    assert r.status_code == 409 and "4 keys" in r.json()["detail"]


def test_inactive_event_plan_is_saved_but_only_pushed_on_activation(ctx):
    client, pub, _ = ctx
    claim(client)
    practice = client.get("/api/events").json()[0]
    driver = practice["channels"][0]["id"]
    client.put(f"/api/events/{practice['id']}/plan/bp-001/channels/{driver}", json={"role": "listen"})

    race = client.post("/api/events", json={"name": "Race Day", "copy_from_event_id": practice["id"]}).json()
    assert [c["name"] for c in race["channels"]] == [c["name"] for c in practice["channels"]]
    race_driver = race["channels"][0]["id"]
    plan = client.get(f"/api/events/{race['id']}/plan").json()
    assert plan["devices"][0]["keys"][0] == {"key": "A", "channel_id": race_driver, "mode": "listen_only", "volume": 70}

    pushes = len(pub.configs)
    r = client.put(f"/api/events/{race['id']}/plan/bp-001/channels/{race_driver}", json={"role": "talk"})
    assert r.status_code == 200 and len(pub.configs) == pushes  # draft: nothing sent to the device

    client.post(f"/api/events/{race['id']}/activate")
    cfg = pub.last_config("bp-001")
    assert cfg["event"]["name"] == "Race Day"
    assert cfg["keys"][0] == {"key": "A", "channel_id": race_driver, "mode": "latch", "volume": 70}
    assert cfg["ptt_channel_ids"] == [race_driver]


def test_deleting_channel_unassigns_it_and_repushes(ctx):
    client, pub, _ = ctx
    claim(client)
    event = client.get("/api/events").json()[0]
    first = event["channels"][0]["id"]
    client.put(f"/api/events/{event['id']}/plan/bp-001/channels/{first}", json={"role": "talk"})
    assert pub.last_config("bp-001")["keys"][0]["channel_id"] == first

    assert client.delete(f"/api/channels/{first}").status_code == 204
    cfg = pub.last_config("bp-001")
    assert cfg["keys"][0]["channel_id"] is None
    assert first not in cfg["ptt_channel_ids"] and cfg["call_channel_id"] is None
    assert all(c["id"] != first for c in cfg["channels"])


def test_activating_event_pushes_its_channels(ctx):
    client, pub, _ = ctx
    claim(client)
    ev = client.post("/api/events", json={"name": "Race Day"}).json()
    client.patch(f"/api/channels/{ev['channels'][0]['id']}", json={"name": "Strategy"})
    v_before = pub.last_config("bp-001")["version"]

    client.post(f"/api/events/{ev['id']}/activate")
    cfg = pub.last_config("bp-001")
    assert cfg["version"] == v_before + 1
    assert cfg["event"]["name"] == "Race Day"
    assert cfg["channels"][0]["name"] == "Strategy"
    assert client.delete(f"/api/events/{ev['id']}").status_code == 409


def test_admin_mute_and_unclaim(ctx):
    client, pub, _ = ctx
    claim(client)
    client.post("/api/devices/bp-001/admin", json={"muted": True})
    assert pub.last_config("bp-001")["admin"] == {"muted": True, "disabled": False}

    client.post("/api/devices/bp-001/cmd", json={"cmd": "call"})
    assert pub.cmds[-1] == ("bp-001", {"cmd": "call", "from": "portal"})

    assert client.delete("/api/devices/bp-001").status_code == 204
    assert pub.last_config("bp-001") is None  # retained config cleared
    assert client.get("/api/devices").json() == []
