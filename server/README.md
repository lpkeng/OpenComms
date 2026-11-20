# OpenComms Server

| Component | Path | Stack | Status |
|---|---|---|---|
| Portal API | [portal-api](portal-api) | Python, FastAPI, SQLAlchemy, paho-mqtt | v0 |
| Portal web app | [portal-web](portal-web) | React, Vite, TypeScript, Leaflet | v0 |
| Media server | — | Go, Pion WebRTC, libopus | Not started |

Licensed **AGPL-3.0-or-later** (see [LICENSE](../LICENSE)).

## Portal v0: what works

- **Devices:** live status (online/offline, battery, signal, firmware), live talk/listen per key (keys coloured by channel), config sync state (in sync / pending)
- **Claiming:** add a device by ID + claim code; discovered-but-unclaimed devices are listed. This is a development stand-in for QR code + Bluetooth adoption
- **Comms plan:** who is on which channel, and who can talk or only listen, shown three ways with live talk indicators:
  - **Board:** a column per channel with *Talk & listen* and *Listen only* zones; drag people in, drag chips between channels (Ctrl+drag to add), or drag them back to People to take them off
  - **Matrix:** people × channels; pick not on / listen only / talk & listen per cell
  - **Audio flow:** who can talk → channel → who hears it; hover or click anyone to trace their audio
  - Selecting a person or channel spells out who they hear and who hears them, and flags problems (nobody can talk on a channel, nobody hears it, someone isn't on any channel)
- **Remote config:** name, label, keys A–D (channel, talk & listen or listen only, default volume), headset PTT channel, call channel, mic gain, sidetone; pushed as a versioned, retained MQTT message. All talk is hold-to-talk
- **Headset PTT remaps:** if a wearer remaps their headset PTT on the beltpack, the portal shows a dashed PTT badge and offers "Reset to plan"
- **Admin:** mute/unmute, disable/enable, call, identify, remove device
- **Events & channels:** create/rename/delete events and channels; new events can copy the channels and comms plan of the active event; plans for inactive events are drafts, and activating an event pushes its plan to every device; call everyone on a channel
- **Map:** device GPS positions on OpenStreetMap, coloured by status

Not yet: user accounts and login (single organisation, **no authentication**, so run it locally only), TLS/mTLS, QR code + Bluetooth adoption, Docker images, OTA, browser talk/listen, base-station port config.

## Run locally (Windows)

Requires Python 3.11+ and Node 20+. No Docker or Mosquitto needed: a Python MQTT broker is used for development.

**One-time setup** (from the repo root):

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r server\portal-api\requirements.txt
cd server\portal-web; npm install; npm run build; cd ..\..
```

**Start everything** (broker, API and 6 simulated beltpacks, each in its own window):

```powershell
.\tools\dev-up.ps1
```

Then open <http://127.0.0.1:8000>. One simulated device (`bp-006`) is left unclaimed; its claim code is printed in the simulator window.

The simulator names the devices it claims and puts them on channels as a motorsport crew, so the comms plan has something to show (`--scenario none` skips this):

| Device | Person | Talk & listen | Listen only |
|---|---|---|---|
| `bp-001` | Sam, Race Engineer | Driver, Engineers, Pit Crew | Team |
| `bp-002` | Alex, Driver (Car 7) | Driver | — |
| `bp-003` | Jordan, Data Engineer | Engineers | Driver, Team |
| `bp-004` | Chris, Crew Chief | Pit Crew | Engineers, Team |
| `bp-005` | Taylor, Team Manager | Team | Driver, Engineers, Pit Crew |

This only happens when a device is first claimed. To start again from scratch, stop everything and delete `server/portal-api/data/opencomms.db`.

To see a headset PTT remap made on a beltpack, start the simulator with `--remap-ptt bp-001=Engineers` (Sam moves his headset PTT from Driver to Engineers). It follows the firmware rule: the remap sticks until you change Sam's PTT in the portal, switch event, or press "Reset to plan".

To work on the web app with hot reload, also run `npm run dev` in `server/portal-web` and open <http://localhost:5173> (API calls are proxied to port 8000).

### Manual start

```powershell
.\.venv\Scripts\python.exe tools\dev-broker\broker.py                       # MQTT on 127.0.0.1:1883
cd server\portal-api; ..\..\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000
.\.venv\Scripts\python.exe tools\device-sim\sim.py --count 6                 # from the repo root
```

### Tests

```powershell
cd server\portal-api; ..\..\.venv\Scripts\python.exe -m pytest -q
cd server\portal-web; npm run build; npm run lint
```

## Configuration (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `OC_DATABASE_URL` | `sqlite:///server/portal-api/data/opencomms.db` | SQLAlchemy URL; use PostgreSQL in production |
| `OC_MQTT_HOST` / `OC_MQTT_PORT` | `127.0.0.1` / `1883` | MQTT broker |
| `OC_DEV_MODE` | `1` | Enables `/api/dev/provision` (stand-in for QR code + Bluetooth adoption). **Set to `0` in production** |
| `OC_WEB_DIST` | `server/portal-web/dist` | Built web app served at `/` |

## Notes

- The dev broker pins **amqtt 0.11.4**: amqtt 0.12.x delivers retained messages to subscribers of unrelated topics.
- The MQTT topic contract and config format are documented in [docs/architecture.md](../docs/architecture.md#control-plane-remote-configuration).
