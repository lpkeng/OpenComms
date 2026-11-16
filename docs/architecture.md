# System Architecture

This describes how beltpacks, base stations, the server and the web portal fit together, including **remote configuration** of devices.

> **Status:** Architecture draft. Core technology decisions are recorded in the [decisions log](#decisions-log).

---

## Overview

```
  ┌─────────────┐                                    ┌──────────────────────────────────────────┐
  │ Beltpacks   │──┐                                 │ Cloud VPS                                │
  │ (LTE)       │  │   Control: MQTT over TLS        │  ┌────────────┐     ┌──────────────────┐ │
  └─────────────┘  ├──────────────────────────────── ►│  │ MQTT broker│◄───►│ Portal API       │ │
  ┌─────────────┐  │                                 │  └────────────┘     │ (config, status, │ │
  │ Base station│──┤   Audio: Opus over UDP          │  ┌────────────┐     │  accounts, OTA)  │ │
  │ (Eth/WiFi/  │  ├──────────────────────────────── ►│  │ Media      │◄───►└────────┬─────────┘ │
  │  LTE)       │  │                                 │  │ server     │              │           │
  └─────────────┘  │                                 │  │ (mix/route)│     ┌────────▼─────────┐ │
                   │                                 │  └─────▲──────┘     │ Database         │ │
  ┌─────────────┐  │   Web portal (HTTPS)            │        │ WebRTC     └──────────────────┘ │
  │ Browser     │──┴──────────────────────────────── ►│  Portal web app ───┘                    │
  │ (portal +   │                                    └──────────────────────────────────────────┘
  │  web talk)  │
  └─────────────┘
```

The system has three independent planes:

| Plane | Purpose | Transport (proposed) |
|---|---|---|
| **Control** | Config, status, commands, OTA triggers | MQTT 3.1.1/5 over TLS (port 8883) |
| **Media** | Real-time audio | Opus over UDP (devices), WebRTC (browsers) |
| **Management** | Portal UI and API | HTTPS (web app + REST/JSON API) |

Devices keep working with their **last known config** if the control link drops. Audio and control are independent.

---

## Devices

Beltpacks and base stations share the same firmware core (ESP-IDF):

| Module | Function |
|---|---|
| Network manager | LTE (beltpack); Ethernet → Wi-Fi → LTE failover (base station) |
| Control client | MQTT/TLS: receives config/commands, publishes status |
| Config store | Versioned config in NVS; applied atomically; survives reboot |
| Audio engine | I2S codec, Opus encode/decode, jitter buffer, mixing of received channels |
| UI | Keys/LEDs/OLED (beltpack) or front-panel status (base station) |
| OTA | `esp_https_ota`, A/B app partitions, rollback on failed boot |

### Base station "virtual users"

Each base-station interface port (radio, 4-wire, 2-wire, line) appears to the server as its own participant. In the portal it can be assigned to channels exactly like a beltpack key, with extra port-specific settings such as PTT/COR mode, VOX threshold and levels.

---

## Control plane: remote configuration

### Topics

Implemented by the portal API and the device simulator (`tools/device-sim`); device firmware must follow the same contract.

| Topic | Direction | Content |
|---|---|---|
| `oc/dev/{id}/config` | Server → device (retained, QoS 1) | Full desired config JSON with `version`. An empty retained message means "unclaimed: clear config" |
| `oc/dev/{id}/state` | Device → server | Applied `config_version`, battery, signal, network link, GPS, firmware version, key talk/listen states, call/identify flags |
| `oc/dev/{id}/cmd` | Server → device (QoS 1) | Momentary actions only: `call`, `identify`, `reboot` (later `ota`) |
| `oc/dev/{id}/online` | Device (retained) + broker last will | `true` on connect; `false` via last will on disconnect |

- Topics are keyed by **device ID only**. The device ID is the certificate CN, so Mosquitto ACLs can restrict each device to `oc/dev/{its id}/#`. Which organisation a device belongs to is a server-side mapping, not part of the topic.
- **Mute and disable are part of the config** (`admin.muted`, `admin.disabled`), not commands, so they survive reboots and reconnects.
- Devices must ignore messages on topics that aren't their own.

### Config flow

1. An admin edits a device in the portal, which saves the desired config in the database and increments its `version`.
2. The API publishes the full config to the device's **retained** `config` topic. It also re-publishes all configs (without bumping versions) whenever it reconnects to the broker.
3. The device receives it (immediately, or on its next connection), validates and stores it, applies it, and reports the applied `version` in `state`.
4. The portal shows the device as **in sync** or **pending** by comparing versions.

### Beltpack config (implemented fields)

```json
{
  "version": 7,
  "name": "Lucas", "label": "Crew Chief",
  "admin": { "muted": false, "disabled": false },
  "event": { "id": 2, "name": "Race Day" },
  "channels": [ { "id": 5, "name": "Pit" }, { "id": 6, "name": "Engineers" } ],
  "keys": [ { "key": "A", "channel_id": 5, "mode": "latch", "volume": 70 }, ... ],
  "ptt_channel_ids": [5],
  "call_channel_id": 5,
  "mic_gain_db": 52,
  "sidetone": 20
}
```

Key modes: `latch` (tap on/off, hold = momentary), `momentary`, `listen_only`, `off`.

### Comms plan (who hears whom)

Each event has a **comms plan**: for every device, which channel each key is on and whether it can talk there. The plan is not a separate structure; it's derived from the key mappings above.

| Key mode | Role on that channel |
|---|---|
| `latch` / `momentary` | **Talk & listen**: talks on the channel and hears everyone who talks on it |
| `listen_only` | **Listen only**: hears the channel but can't talk on it |
| `off`, or no key on the channel | Not on the channel: hears nothing from it |

Rules the API enforces:

- A beltpack has 4 keys, so a person can be on at most 4 channels, and a channel can only be on one of their keys.
- Headset PTT can only target channels the device can talk on; the call key can only target channels it's on.
- Newly claimed devices start on **no channels**.
- Edits to the **active** event's plan are pushed to devices immediately. Plans for other events are **drafts**: saved, and sent when that event is activated. A new event can copy the channels and plan of an existing one.

| Endpoint | Purpose |
|---|---|
| `GET /api/events/{event}/plan` | Every claimed device's plan entry (keys, PTT, call, audio) for that event |
| `PUT /api/events/{event}/plan/{device}` | Replace one device's whole entry (the key editor) |
| `PUT /api/events/{event}/plan/{device}/channels/{channel}` | `{"role": "talk" \| "listen" \| "none", "move_from_channel_id": null}`: put a device on a channel or take it off. The API picks a free key; `move_from_channel_id` re-patches the key from another channel instead (drag from one channel to another). Returns 409 if all keys are in use |
| `POST /api/events` | `{"name", "copy_from_event_id"}`: create an event, optionally copying channels and plan |

The portal shows the plan three ways, with shared selection and live talk indicators: a **board** (drag people into each channel's *Talk & listen* or *Listen only* zone), a **matrix** (people × channels) and an **audio flow** diagram (who can talk → channel → who hears it). Selecting a person or channel spells out who they hear and who hears them, and flags channels nobody can talk on or nobody hears.

### Base station config (example fields)

- Per port: channel assignment, input/output level trim, enable/disable
- Radio: COR polarity, VOX threshold, PTT hang time, TX time-out, half-duplex priority
- 2-wire: hybrid null, call signalling on/off
- Relays: trigger source (e.g. call on channel C), pulse/latch
- Network: preferred link order, APN, Wi-Fi credentials

---

## Portal features (first version)

| Feature | Notes |
|---|---|
| Comms plan: who talks and listens on each channel | Board (drag and drop), matrix and audio-flow views, plus a per-beltpack key editor. Base-station ports will join the same plan |
| Device names and user labels | Shown on the beltpack OLED and in the portal |
| Key behaviour and default volumes | Latch/momentary per key; default volumes |
| Live status | Online, battery, signal strength, network link, talk/listen activity |
| GPS map | Beltpack positions from the SIM7600 GNSS, reported periodically |
| Remote firmware updates | Upload a signed image; roll out to selected devices or groups; progress and rollback status |
| Remote mute / disable | Immediate; device shows "disabled by admin" |
| Send call/alert from the portal | To a channel or a specific device (LED flash + tone) |
| Talk/listen from a web browser | WebRTC client joins channels like a beltpack (mic permission required) |
| Multiple events/teams | Accounts and multi-tenancy (below) |

### Accounts and multi-tenancy

```
Organisation (team)
 ├── Users (admin / operator / viewer roles)
 ├── Devices (beltpacks, base stations), claimed by the organisation
 └── Events
      ├── Channels (A, B, C, ... with names, e.g. "Pit", "Engineers", "Race Control")
      └── Comms plan: each device's keys for this event (channel + talk & listen / listen only)
```

- A device belongs to one organisation, and is active in one event at a time.
- Switching the active event pushes the corresponding config to all its devices.

### Web talk/listen

Browsers can't send raw UDP, so the media server also accepts **WebRTC** connections. WebRTC uses Opus natively, so no transcoding is needed between beltpacks and browsers. A browser user joins channels with talk/listen permissions defined by their role.

---

## Media plane (summary)

| Item | Proposal |
|---|---|
| Codec | Opus at **24 kbit/s, 20 ms frames**. Proven: a plain ESP32 (not S3) encoded this in real time without trouble, so the ESP32-S3 has spare CPU. 10 ms frames remain an option for lower latency |
| Audio bandwidth | **Wideband (16 kHz sampling, ~8 kHz audio).** The CH-3 mic covers 200 Hz–7 kHz and the speakers 100 Hz–8 kHz, so higher sample rates would carry audio the headset can't capture or reproduce |
| Quality levers (S3) | Spend spare CPU on Opus complexity, in-band FEC for packet loss, and optionally noise suppression and AGC, rather than on a higher bitrate |
| Latency budget | **Measured: under 100 ms beltpack-to-beltpack over LTE.** Keep server mixing and jitter buffering from eroding this |
| Transport | UDP with sequence numbers and timestamps; adaptive jitter buffer on the device |
| Mixing | Server mixes per channel and sends each participant a **mix-minus** (everything except their own audio) |
| Silence | No packets sent when not talking (PTT-gated), which saves LTE data |
| Security | **AES-128-GCM** per packet (ESP32-S3 hardware AES; 16-byte tag). Per-session keys are issued over the TLS control link and rotated on reconnect. Packet sequence numbers form the nonce and also reject replays. This is device↔server encryption: the server decrypts in order to mix. Browsers use WebRTC's built-in DTLS-SRTP |

### LTE data estimate

At 20 ms frames each direction sends 50 packets per second. Per packet that's 60 bytes of Opus payload plus about 56 bytes of overhead (IP/UDP headers, our sequence/timestamp header and the encryption tag). That totals about **46 kbit/s, or ~21 MB per hour** of continuous audio in one direction.

- **Upload** happens only while the user is talking.
- **Download** is a single mixed stream from the server, sent only while someone on the user's channels is talking.
- Worst case, with audio flowing constantly for a 10-hour event day, is about **210 MB per direction**. Real use with intermittent talk should be a fraction of that.

---

## Provisioning and security

| Item | Decision |
|---|---|
| Device identity | **Per-device X.509 certificate, mutual TLS.** During USB provisioning the device generates its own private key (it never leaves the device) and sends a CSR; the OpenComms CA signs it. The certificate CN is the device ID |
| Revocation | Revoke an individual device certificate from the portal; the broker and media server reject it |
| Key protection | Prototype: key in encrypted NVS. Production: ESP32-S3 Digital Signature peripheral + flash encryption + secure boot |
| Claiming | Scan the device's QR code (ID + claim code) in the portal to add it to an organisation |
| Transport security | mTLS for MQTT; HTTPS for the portal; AES-128-GCM for device audio |
| Admin actions | Mute/disable/OTA are role-restricted and logged |

### Firmware updates (OTA)

| Item | Decision |
|---|---|
| Rollout | **Staged and admin-approved:** an admin publishes a release, it goes to a test group first, then the admin promotes it to all devices (or selected groups) |
| Event safety | **Never during an event.** Devices in an active event defer the update until the event ends, or until they're idle or charging |
| Auto-halt | The rollout pauses automatically if updated devices fail to boot or fail to reconnect |
| Device side | `esp_https_ota`, A/B app partitions, automatic rollback if the new image doesn't confirm a healthy boot |
| Integrity | Images are signed; devices verify the signature before installing |

---

## Server deployment

A single small cloud VPS runs everything for the first version, e.g. with Docker Compose:

| Service | Decision |
|---|---|
| MQTT broker | **Mosquitto** (mTLS client certificates; per-device topic ACLs via the dynamic-security plugin) |
| Portal API | **Python + FastAPI** (AGPL-3.0) |
| Portal web app | **React + Vite** (AGPL-3.0), served as static files |
| Media server (UDP + WebRTC, mixing) | **Go** + Pion WebRTC + libopus (AGPL-3.0) |
| Database | PostgreSQL |
| TLS | Let's Encrypt (public HTTPS); private OpenComms CA for device certificates |

Choose a VPS region close to the users to minimise latency.

The portal API and media server communicate over **gRPC** with a shared protobuf contract (generated code for Go and Python):

| Direction | Messages | gRPC pattern |
|---|---|---|
| API → media | Channel assignments, session keys, revocations, mute/disable | Unary calls (acknowledged) |
| Media → API | Talk activity, stream stats | Server-streaming |
| Media startup | Fetch current sessions, keys and assignments | Unary "sync state" call |

The gRPC port is internal only (not exposed publicly) and secured with TLS.

## Decisions log

- [x] Server: Go media server + Python FastAPI portal API
- [x] Portal front end: React + Vite
- [x] Audio encryption: AES-128-GCM, session keys over the control link
- [x] Device credentials: per-device X.509 certificates, mutual TLS
- [x] OTA: staged, admin-approved, never during an event
- [x] License: GPL-3.0 firmware, AGPL-3.0 server/portal, CERN-OHL-S hardware
- [x] Internal API ↔ media server link: gRPC
- [x] MQTT broker: Mosquitto (EMQX ruled out: BSL 1.1 from v5.9 conflicts with a freely self-hostable AGPL project)
