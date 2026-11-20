# System Architecture

This describes how beltpacks, base stations, the server and the web portal fit together, including **remote configuration** of devices.

> **Status:** Architecture draft. Core technology decisions are recorded in the [decisions log](#decisions-log).

## Principles

- **LTE first.** A beltpack works anywhere with mobile coverage, with no fixed network or UHF radio infrastructure. It uses Wi-Fi instead when good Wi-Fi is available.
- **No central cloud.** Each team runs the OpenComms server itself (Docker on a VPS, a NAS or a small box at the track) and owns its devices' keys. A hosted option may come later, but nothing will depend on it.
- **Teams are isolated.** A team's devices only trust, and only talk to, that team's server.

---

## Overview

```
  ┌─────────────┐                                    ┌──────────────────────────────────────────┐
  │ Beltpacks   │──┐                                 │ Team server (VPS or track-side box)      │
  │ (Wi-Fi/LTE) │  │   Control: MQTT over TLS        │  ┌────────────┐     ┌──────────────────┐ │
  └─────────────┘  ├──────────────────────────────── ►│  │ MQTT broker│◄───►│ Portal API       │ │
  ┌─────────────┐  │                                 │  └────────────┘     │ (config, status, │ │
  │ Base station│──┤   Audio: Opus/UDP, AES-GCM      │  ┌────────────┐     │  accounts, OTA)  │ │
  │ (Eth/WiFi/  │  ├──────────────────────────────── ►│  │ Media      │◄───►└────────┬─────────┘ │
  │  LTE)       │  │                                 │  │ server     │              │           │
  └─────────────┘  │                                 │  │ (relay)    │     ┌────────▼─────────┐ │
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
| Network manager | Beltpack: Wi-Fi when it's good, LTE otherwise ([below](#beltpack-networking-wi-fi--lte)). Base station: Ethernet → Wi-Fi → LTE failover |
| Control client | MQTT/TLS: receives config/commands, publishes status |
| Config store | Versioned config in NVS; applied atomically; survives reboot. Local settings (headset PTT remap, listen levels) are kept separately |
| Audio engine | I2S codec, Opus encode/decode, an adaptive jitter buffer per talker, and a local mix of the talkers it receives with per-channel listen levels |
| UI | Hold-to-talk keys, encoder and menu, LEDs, display (beltpack) or front-panel status (base station) |
| OTA | `esp_https_ota`, A/B app partitions, rollback on failed boot |

### Beltpack networking: Wi-Fi + LTE

LTE is the core link, so a beltpack works wherever there's coverage. Where good Wi-Fi exists (a garage or a pit building), the beltpack uses it instead: lower latency and no mobile data.

- **Prefer Wi-Fi, fall back to LTE** when Wi-Fi signal or packet loss crosses a threshold. Switch back only above a higher threshold (hysteresis), so it doesn't flap at the edge of coverage.
- **Keep LTE warm:** while on Wi-Fi the modem stays registered with its data connection up, so a switch takes milliseconds rather than the seconds a fresh attach needs. This costs some battery.
- **Overlap during handover:** for a moment the beltpack sends audio over both links, and the server drops the duplicates by sequence number, so there's no audible gap.
- **Session IDs, not IP addresses:** every audio packet carries a session ID, so the server keeps the stream when the beltpack's address changes.
- **Outbound only:** LTE devices sit behind carrier NAT, so nothing can connect in to them. Beltpacks always connect out to the team server, which therefore needs a public address ([Server deployment](#server-deployment)).

### Base station "virtual users"

Each base-station interface port (radio, 4-wire, 2-wire, line) appears to the server as its own participant. In the portal it can be assigned to channels exactly like a beltpack key, with extra port-specific settings such as PTT/COR mode, VOX threshold and levels.

---

## Control plane: remote configuration

### Topics

Implemented by the portal API and the device simulator (`tools/device-sim`); device firmware must follow the same contract.

| Topic | Direction | Content |
|---|---|---|
| `oc/dev/{id}/config` | Server → device (retained, QoS 1) | Full desired config JSON with `version`. An empty retained message means "unclaimed: clear config" |
| `oc/dev/{id}/state` | Device → server | Applied `config_version`, battery, signal, network link, GPS, firmware version, key talk/listen states, headset PTT channel in use (`ptt_channel_id`), call/identify flags |
| `oc/dev/{id}/cmd` | Server → device (QoS 1) | Momentary actions only: `call`, `identify`, `reboot`, `reset_ptt` (later `ota`) |
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
  "keys": [ { "key": "A", "channel_id": 5, "mode": "talk", "volume": 70 }, ... ],
  "ptt_channel_id": 5,
  "call_channel_id": 5,
  "mic_gain_db": 52,
  "sidetone": 20
}
```

Key modes: `talk` (hold to talk, and hears the channel) and `listen_only`. There is no latching talk: every talk key, and the headset PTT, is **hold-to-talk**.

### Headset PTT

The headset PTT talks on **one** channel, `ptt_channel_id`, which must be one of the device's talk channels. The wearer can remap it on the beltpack (hold the headset PTT and a channel key for 10 s, then confirm with the encoder; see [hardware/beltpack](../hardware/beltpack/README.md#controls-and-ui)):

- The remap is stored in NVS, survives restarts, and is reported in `state.ptt_channel_id`. The portal shows it as remapped (a dashed PTT badge).
- It **sticks** until an admin changes that device's `ptt_channel_id` in the portal, the active event changes, the channel stops being one the device can talk on, or the portal sends `reset_ptt` ("Reset to plan").
- To spot an admin change, the beltpack stores the event and the portal's `ptt_channel_id` from when the remap was made. The device simulator implements this rule (`--remap-ptt bp-001=Engineers`).

### Comms plan (who hears whom)

Each event has a **comms plan**: for every device, which channel each key is on and whether it can talk there. The plan is not a separate structure; it's derived from the key mappings above.

| Key mode | Role on that channel |
|---|---|
| `talk` | **Talk & listen**: talks on the channel (hold to talk) and hears everyone who talks on it |
| `listen_only` | **Listen only**: hears the channel but can't talk on it |
| No key on the channel | Not on the channel: hears nothing from it |

Rules the API enforces:

- A beltpack has 4 keys, so a person can be on at most 4 channels, and a channel can only be on one of their keys.
- The headset PTT targets one channel the device can talk on; the call key can only target channels it's on.
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
| Adopt, release and revoke devices | Scan a blank beltpack's QR code; release a unit for another team; revoke a lost one on its own |
| Device names and user labels | Shown on the beltpack display and in the portal |
| Key roles and default volumes | Talk & listen or listen only per key (all talk is hold-to-talk); default volumes; one headset PTT channel |
| Live status | Online, battery, signal strength, network link, talk/listen activity |
| GPS map | Beltpack positions from the SIM7600 GNSS, reported periodically |
| Remote firmware updates | Upload a signed image; roll out to selected devices or groups; progress and rollback status |
| Remote mute / disable | Immediate; device shows "disabled by admin" |
| Send call/alert from the portal | To a channel or a specific device (LED flash + tone) |
| Talk/listen from a web browser | WebRTC client joins channels like a beltpack (mic permission required) |
| Multiple events | Each event has its own channels and comms plan (below) |

### Accounts and teams

```
Organisation (team)
 ├── Users (admin / operator / viewer roles)
 ├── Devices (beltpacks, base stations), adopted by the organisation
 └── Events
      ├── Channels (A, B, C, ... with names, e.g. "Pit", "Engineers", "Race Control")
      └── Comms plan: each device's keys for this event (channel + talk & listen / listen only)
```

- Each team runs its own server, so a server normally holds one organisation. The data model still supports several, for a possible hosted option later.
- A device belongs to one organisation, and is active in one event at a time.
- Switching the active event pushes the corresponding config to all its devices.

### Web talk/listen

Browsers can't send raw UDP, so the media server also accepts **WebRTC** connections. WebRTC uses Opus natively, so no transcoding is needed between beltpacks and browsers. A browser user joins channels with talk/listen permissions defined by their role.

---

## Media plane (summary)

| Item | Proposal |
|---|---|
| Codec | Opus at **24 kbit/s, 20 ms frames**. Proven: a plain ESP32 (not S3) encoded this in real time without trouble, so the ESP32-S3 has spare CPU. 10 ms frames save about 10 ms each way but roughly double the packet overhead (~69 instead of ~46 kbit/s on the wire), so the frame size will be a server setting to try per track |
| Audio bandwidth | **Wideband (16 kHz sampling, ~8 kHz audio).** The CH-3 mic covers 200 Hz–7 kHz and the speakers 100 Hz–8 kHz, so higher sample rates would carry audio the headset can't capture or reproduce |
| Quality levers (S3) | Spend spare CPU on Opus complexity, in-band FEC for packet loss, and optionally noise suppression and AGC, rather than on a higher bitrate |
| Latency | **Measured: under 100 ms beltpack-to-beltpack with both beltpacks on LTE, through a relay server.** See [Latency](#latency) for what keeps it there |
| Transport | **UDP only**: a retransmitted packet would arrive too late to play. Each packet carries a session ID, sequence number and timestamp (reordering, duplicates, handover). Adaptive jitter buffer per talker on the device: starts around 40 ms, stays small on clean Wi-Fi and grows on choppy LTE. Opus loss concealment and in-band FEC cover missing packets |
| Routing | **Relay, no server mixing.** The server forwards each talker's packets, without re-encoding, to everyone else on that channel and never back to the talker. Each listener receives at most the **3 most recent talkers** across its channels; the beltpack decodes and mixes them with its per-channel listen levels, so level changes are instant and simultaneous talkers are all heard |
| Silence | No audio packets when nobody is talking (PTT-gated). A tiny keepalive about once a second keeps the LTE radio connected and NAT mappings open |
| Security | **AES-128-GCM** per packet (ESP32-S3 hardware AES; 16-byte tag). Per-session keys are issued over the mTLS control link and rotated on reconnect. Packet sequence numbers form the nonce and also reject replays. Encryption is hop-by-hop: the relay decrypts each packet and re-encrypts it for each listener's session (cheap, and the audio is never re-encoded). Browsers use WebRTC's built-in DTLS-SRTP |

### Latency

Measured under 100 ms beltpack-to-beltpack over LTE. The levers that keep it there, roughly in order of impact:

1. **Server close to the track:** a data centre in the same city or region. The biggest single factor.
2. **Keepalive:** the tiny packet about once a second stops the LTE radio dropping to idle. Waking it can add 50–100 ms or more.
3. **No server mixing:** the relay forwards packets, so the only jitter buffer is on the listening beltpack.
4. **UDP with no retransmits,** and a lean adaptive jitter buffer starting around 40 ms.
5. **Carrier choice:** latency varies by network and by track, so test each one (Telstra is often best in regional Australia).
6. **Keep Wi-Fi traffic local:** when most beltpacks are on Wi-Fi, run the server at the track rather than in a data centre.
7. **Shorter frames:** 10 ms Opus frames save about 10 ms each way, for roughly 50% more LTE data.

**Catching the first word.** A transmission mustn't lose its first syllable while the link wakes up:

- The mic, codec and encoder run all the time, so audio is captured from the instant the PTT closes.
- The keepalive keeps the LTE radio connected, so the first packet doesn't wait for the radio to reconnect.
- Packets from the first moments are sent rather than dropped; the listener's jitter buffer absorbs the extra delay at the start.

### LTE data estimate

At 20 ms frames each talker sends 50 packets per second. Per packet that's 60 bytes of Opus payload plus about 56 bytes of overhead (IP/UDP headers, our session/sequence/timestamp header and the encryption tag). That totals about **46 kbit/s, or ~21 MB per hour** of continuous audio in one direction.

- **Upload** happens only while the user is talking, plus the keepalive (about 0.2 MB per hour).
- **Download** is one stream per active talker on the user's channels (at most 3 at once), only while someone is talking. Usually that's one stream.
- Worst case, with one talker at a time and audio flowing constantly for a 10-hour event day, is about **210 MB per direction**. Real use with intermittent talk should be a fraction of that.

WireGuard was considered instead of AES-GCM + mTLS. It would add about 45 bytes per packet (its own header plus a second IP/UDP header inside the tunnel), roughly 40% more data at 20 ms frames, and makes sending over Wi-Fi and LTE at once harder.

---

## Adoption, provisioning and security

| Item | Decision |
|---|---|
| Trust | **Each team's server is the authority.** On first start it creates the team's own CA. There is no central OpenComms CA, and a device adopted by one team can't connect to another team's server |
| Device identity | **Per-device key pair, mutual TLS.** The beltpack generates its key pair on first boot (the private key never leaves the device). During adoption the team server signs a certificate whose CN is the device ID |
| Revocation | Revoke a device from the portal and the broker and relay reject it immediately. A lost beltpack is revoked on its own, without rekeying the rest of the fleet |
| Key protection | Prototype: key in encrypted NVS. Production: ESP32-S3 Digital Signature peripheral + flash encryption + secure boot |
| Transport security | mTLS for MQTT; HTTPS for the portal; AES-128-GCM for device audio, with session keys sent over the mTLS control link |
| Admin actions | Mute/disable/OTA are role-restricted and logged |

### Adopting a blank beltpack

The QR code is the main way to adopt units; the [dock](../hardware/dock/README.md) is the quick option for a batch.

1. On first boot the beltpack generates its key pair and shows a QR code: unit ID, public-key fingerprint and a one-time pairing code.
2. The team opens **their own server's** dashboard on a phone, scans the QR code and approves the unit.
3. The phone sends the beltpack the server's addresses (public, plus a local one for track Wi-Fi), the team CA certificate, Wi-Fi details and the mobile APN over **Bluetooth LE**, authenticated with the pairing code. Nothing passes through any third-party server.
4. The beltpack connects out to the team server, proves it holds the key from the QR code, receives its certificate, then gets its config (name, channels, keys).
5. Repeat for each unit, or drop them in the dock.

Things to know:

- Web pages can only use Bluetooth in Chrome and Edge (Android, Windows, macOS, Linux). **No browser on iPhone or iPad supports it.** iPhone users can adopt with a Web Bluetooth browser such as Bluefy, or over USB / the dock.
- Phones only allow the camera and Bluetooth on HTTPS pages, so the dashboard needs a certificate the phone trusts: Let's Encrypt on a VPS with a domain name is easiest. A track-side box needs a domain name or a tunnel.
- The portal's current claim code + `/api/dev/provision` flow is a development stand-in for this.

### Releasing a unit

Release it from the dashboard, or factory-reset it on the beltpack (Device menu → Factory reset, confirmed with a long press). Either way the beltpack wipes its keys, certificate and server details, and is blank for the next team.

### Firmware updates (OTA)

| Item | Decision |
|---|---|
| Rollout | **Staged and admin-approved:** an admin publishes a release, it goes to a test group first, then the admin promotes it to all devices (or selected groups) |
| Event safety | **Never during an event.** Devices in an active event defer the update until the event ends, or until they're idle or charging |
| Auto-halt | The rollout pauses automatically if updated devices fail to boot or fail to reconnect |
| Device side | `esp_https_ota`, A/B app partitions, automatic rollback if the new image doesn't confirm a healthy boot |
| Integrity | Images are signed; devices verify the signature before installing |
| Dock | Overnight updates over USB while charging ([dock](../hardware/dock/README.md), parked) |

---

## Server deployment

Each team runs the server itself with **Docker Compose**. The same images run on a small VPS, a NAS, or a box at the track (possibly inside the dock later).

| Where | Good for | Notes |
|---|---|---|
| VPS in the same city or region | Mostly-LTE fleets; the simplest setup | Has a public IP. Wi-Fi beltpacks also reach it over the internet |
| Box at the track | Mostly-Wi-Fi fleets: keeps Wi-Fi audio local | LTE beltpacks need a way in: a fixed IP with port forwarding, or a VPS that forwards the UDP and MQTT ports |
| NAS or server at base | Teams that already run one | Needs port forwarding or a tunnel; latency depends on the base's internet link |

Beltpacks always connect out, so for LTE units the server needs a public address. The project will document the port-forwarding and tunnel options. The dashboard needs HTTPS that phones trust (see [Adopting a blank beltpack](#adopting-a-blank-beltpack)).

| Service | Decision |
|---|---|
| MQTT broker | **Mosquitto** (mTLS client certificates; per-device topic ACLs via the dynamic-security plugin) |
| Portal API | **Python + FastAPI** (AGPL-3.0) |
| Portal web app | **React + Vite** (AGPL-3.0), served as static files |
| Media relay (UDP + WebRTC) | **Go** + Pion WebRTC (AGPL-3.0). Forwards Opus packets; no decoding except for features that need it later, such as recording |
| Database | PostgreSQL |
| TLS | Let's Encrypt (or a tunnel) for the dashboard; the team's own CA, created on first start, for device certificates |

The portal API and media server communicate over **gRPC** with a shared protobuf contract (generated code for Go and Python):

| Direction | Messages | gRPC pattern |
|---|---|---|
| API → media | Channel assignments, session keys, revocations, mute/disable | Unary calls (acknowledged) |
| Media → API | Talk activity, stream stats | Server-streaming |
| Media startup | Fetch current sessions, keys and assignments | Unary "sync state" call |

The gRPC port is internal only (not exposed publicly) and secured with TLS.

## Decisions log

- [x] Server: Go media relay + Python FastAPI portal API
- [x] Portal front end: React + Vite
- [x] Hosting: each team self-hosts with Docker (VPS, NAS or track-side box); no central cloud. A hosted option may come later, but nothing depends on it
- [x] Audio routing: the relay forwards talkers without re-encoding (no server mixing); each listener gets at most 3 talkers and mixes locally
- [x] Audio encryption: AES-128-GCM, session keys over the control link (WireGuard considered: simpler key handling, but ~40% more LTE data and harder Wi-Fi/LTE overlap)
- [x] Device credentials: per-device key pair generated on the device; certificate issued by the team server's own CA; mutual TLS
- [x] Adoption: QR code + Bluetooth LE from the team's own dashboard; the dock is the quick option
- [x] Talk: everything is hold-to-talk (no latching keys)
- [x] Headset PTT: one channel; the wearer can remap it on the beltpack, and the remap sticks until an admin changes it in the portal
- [x] Beltpack battery: single-cell 6,000 mAh LiPo, USB-C charging, plus a charging dock
- [x] OTA: staged, admin-approved, never during an event
- [x] License: GPL-3.0 firmware, AGPL-3.0 server/portal, CERN-OHL-S hardware
- [x] Internal API ↔ media server link: gRPC
- [x] MQTT broker: Mosquitto (EMQX ruled out: BSL 1.1 from v5.9 conflicts with a freely self-hostable AGPL project)
