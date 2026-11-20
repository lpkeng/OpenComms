# OpenComms

**A low-cost, open-source push-to-talk (PTT) intercom: an alternative to commercial systems such as Riedel Bolero and Clear-Com.**

OpenComms runs on an **ESP32-S3 + SIMCom SIM7600G** 4G LTE board. Each device acts as a wireless beltpack. Commercial DECT or UHF intercoms rely on base stations and antennas at your site. This project sends audio over the cellular network instead (or Wi-Fi where it's available), so you don't need on-site infrastructure. Range is limited only by mobile coverage. Each team runs its own small server, so there's no central cloud to depend on. Hardware cost is a fraction of a commercial system.

> **Status:** 🚧 Early development. Beltpack-to-beltpack latency has been proven **under 100 ms** with both beltpacks on LTE, through a relay server. Other features below are design goals unless marked otherwise.

---

## Why?

Professional intercom systems work well but cost a lot. Their range is also limited by the radio infrastructure you deploy. Event crews, motorsport teams and production groups with smaller budgets often fall back to consumer radios or phone calls. Those options lack party-line channels, PTT, and integration with headsets.

| | Commercial (Bolero / Clear-Com) | OpenComms |
|---|---|---|
| Beltpack cost | High (commercial pricing) | Low-cost dev-board hardware |
| Infrastructure | Antennas / base stations / matrix | None on-site: 4G LTE (or Wi-Fi), plus a small server you run yourself |
| Range | Site coverage (typically hundreds of metres) | Anywhere with mobile coverage |
| Latency | Very low | Under 100 ms beltpack-to-beltpack over LTE (measured) |
| Open / hackable | No | Yes |

The main trade-off is reliance on the mobile network. Measured latency between two beltpacks over LTE is under 100 ms, which is comfortable for conversational crew comms.

---

## Planned Features

- [ ] **Push-to-talk (PTT)**: everything is hold-to-talk, on four channel keys and the headset PTT; the wearer can remap the headset PTT on the beltpack
- [ ] **Party-line channels**: 4 channels (A–D) per beltpack; join and talk on one or more shared channels/groups
- [ ] **4G LTE everywhere** via SIM7600G, **Wi-Fi when it's available**, with seamless handover between them
- [ ] **Compressed low-latency audio**: Opus at 24 kbit/s in 20 ms packets over UDP (encoding proven on a plain ESP32)
- [ ] **Headset support**: mic input and earpiece output via an I2S audio codec
- [ ] **Per-channel listen levels** and sidetone
- [ ] **Call / alert signalling** between users
- [ ] **Battery powered**: 6,000 mAh LiPo, USB-C fast charging and an accurate fuel gauge
- [ ] **GPS position reporting** using the SIM7600G's built-in GNSS
- [ ] **Self-hosted server**: each team runs its own audio relay and portal (Docker on a VPS, NAS or track-side box); no central cloud
- [ ] **Encrypted audio and control** with per-device keys; a lost beltpack can be revoked on its own
- [ ] **QR code adoption**: scan a blank beltpack from your dashboard, and the phone sends it the settings over Bluetooth
- [ ] **Web portal** for remote configuration: a visual **comms plan** showing who is on each channel and who can talk or only listen, names, key roles and volumes, live status, GPS map, OTA firmware updates, remote mute/disable, calls, and multiple events
- [ ] **Talk/listen from a web browser** (WebRTC)
- [ ] **Base station** bridging OpenComms to legacy gear: two-way radios, 4-wire, 2-wire partyline (Clear-Com/RTS), line in/out, relay/GPIO
- [ ] **Charging dock** (idea, parked): charging, adoption over the cable, overnight updates and battery-health tracking

---

## System Architecture

```
 ┌──────────────┐ LTE/WiFi ┌──────────────────────────┐ LTE/WiFi ┌──────────────┐
 │  Beltpacks   │◄────────►│  Team server (your own)  │◄────────►│  Beltpacks   │
 │ ESP32-S3 +   │  audio + │  • audio relay           │          │              │
 │ SIM7600G     │  control │  • MQTT control broker   │          └──────────────┘
 └──────────────┘          │  • portal API + database │
                           └───▲──────────────────▲───┘
         Eth / Wi-Fi / LTE     │                  │ HTTPS + WebRTC
 ┌─────────────────────────────┴──┐        ┌──────┴────────────────┐
 │  Base station                  │        │  Web portal           │
 │  radio · 4-wire · 2-wire · line│        │  config · status · map│
 │  relay/GPIO                    │        │  OTA · web talk       │
 └────────────────────────────────┘        └───────────────────────┘
```

1. **Beltpack:** captures mic audio while a talk key is held, encodes it (Opus) and streams it to the server. It decodes and mixes the talkers on its channels, with a listen level per channel.
2. **Base station:** connects legacy radios and intercom systems; each interface port appears as a channel participant.
3. **Server:** each team runs its own (Docker on a VPS, a NAS or a box at the track). It relays each talker's audio to everyone else on the channel without re-encoding, and hosts the MQTT control broker and the portal.
4. **Portal:** a web app for remote configuration, adoption, live status, firmware updates and browser talk/listen.

See [docs/architecture.md](docs/architecture.md) for the full design.

---

## Hardware

### Beltpack

Prototype P0 beltpack (see [hardware/beltpack](hardware/beltpack/README.md) for the full design, pin map and BOM):

| Component | Notes |
|---|---|
| LilyGO T-SIM7600G-S3-Standard (H803) | ESP32-S3 + SIM7600G-H 4G LTE Cat-4 modem with GNSS, 18650 holder |
| Nano SIM with data plan | Any carrier supported by SIM7600G bands |
| WM8960 audio codec | I2S; mic preamp with up to 59 dB gain for dynamic headset mics; headphone amp |
| Headset | 3M Peltor CH-3 FLX2 `-111` (dynamic 150 Ω mic, 2× 230 Ω speakers in parallel, built-in PTT) |
| Controls | 4 hold-to-talk channel keys (A–D) + Call key with RGB LEDs, headset PTT, rotary encoder for listen levels and menu |
| Display | 128×64 I2C OLED (2.42" is the front-runner; e-paper still an option) |
| Battery | 6,000 mAh single-cell LiPo; USB-C charging |
| Enclosure | TBD (3D-printed beltpack case planned) |

### Base station

Bridges OpenComms to legacy gear (see [hardware/base-station](hardware/base-station/README.md)):

| Component | Notes |
|---|---|
| LilyGO T-ETH-Elite (ESP32-S3) | Ethernet (W5500), Wi-Fi, PoE option, mini-PCIe SIM7600 LTE |
| 2× WM8960 audio codecs | 4 mono inputs and 4 mono outputs, one pair per interface port |
| Interface ports | Two-way radio (DB9), 4-wire (RJ45), 2-wire partyline (XLR3), line in/out (TRS), all transformer-isolated |
| Relay / GPIO | 2 relay outputs, 2 opto-isolated inputs |
| Power | 12 V DC (vehicle/battery) or PoE |

---

## Getting Started

> ⚠️ Firmware is not yet available. The steps below describe the planned workflow.

### Prerequisites

- Beltpack hardware (see [hardware/beltpack](hardware/beltpack/README.md))
- Activated SIM card with mobile data
- Toolchain: [ESP-IDF](https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/get-started/) (firmware)
- Somewhere to run your team's server (Docker): a small VPS near the track is simplest because it has a public IP; a box at the track also works if LTE units can reach it (see [docs/architecture.md](docs/architecture.md#server-deployment))

### Build & Flash

```bash
git clone https://github.com/lpkeng/OpenComms.git
cd OpenComms
# build / flash instructions TBD
```

### Configuration

Devices are configured remotely from the **web portal** (channels, who can talk or only listen on each, key roles, names, volumes, firmware). A working portal v0 with a device simulator is in [server/](server/README.md): run `.\tools\dev-up.ps1` and open <http://127.0.0.1:8000>.

Each beltpack is adopted once: scan the QR code on its screen from your server's dashboard on a phone, and the phone sends it the server address, Wi-Fi details and mobile APN over Bluetooth. Bluetooth from a web page needs Chrome or Edge (Android or a laptop); on an iPhone use a Web Bluetooth browser such as Bluefy, or the dock.

---

## Roadmap

1. **Bring-up:** modem connects to LTE, I2S audio loopback works on the ESP32-S3
2. ✅ **Latency test:** two beltpacks exchanging audio over LTE through a relay, measured under 100 ms
3. **PTT + channels:** hold-to-talk keys and headset PTT; the relay routes each talker to their channels and beltpacks mix locally
4. **Control plane + portal v1:** MQTT config/status, device adoption, channel/key assignment, live status. 🟡 **Portal v0 working** against simulated devices, including the visual comms plan (see [server/](server/README.md)); accounts, TLS and production deployment still to do
5. **Audio quality:** Opus, jitter buffer, latency tuning, Wi-Fi ↔ LTE handover
6. **Base station:** radio port first, then line, 4-wire, relay/GPIO, then 2-wire partyline
7. **Portal v2:** QR + Bluetooth adoption, Docker images for self-hosting, OTA, GPS map, browser talk/listen (WebRTC)
8. **Hardware:** custom PCBs and enclosures for the beltpack and base station; then the charging dock

---

## Contributing

Contributions, ideas and testing feedback are welcome. Please open an issue to discuss changes before submitting a pull request.

## License

OpenComms is open source, licensed per component (see [LICENSE](LICENSE)):

| Component | License |
|---|---|
| Device firmware (beltpack, base station) | [GPL-3.0-or-later](LICENSES/GPL-3.0-or-later.txt) |
| Server and portal | [AGPL-3.0-or-later](LICENSES/AGPL-3.0-or-later.txt) |
| Hardware designs | [CERN-OHL-S-2.0](LICENSES/CERN-OHL-S-2.0.txt) |

You may use, build, modify and sell OpenComms, provided you share your changes under the same terms. This includes modified servers offered as a hosted service.

## Disclaimer

This project is not affiliated with Riedel Communications (Bolero) or Clear-Com. All trademarks belong to their respective owners. This is not a safety-critical communications system.
