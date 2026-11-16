# OpenComms

**A low-cost, open-source push-to-talk (PTT) intercom: an alternative to commercial systems such as Riedel Bolero and Clear-Com.**

OpenComms runs on an **ESP32-S3 + SIMCom SIM7600G** 4G LTE board. Each device acts as a wireless beltpack. Commercial DECT or UHF intercoms rely on base stations and antennas at your site. This project sends audio over the cellular network instead, so you don't need on-site infrastructure. Range is limited only by mobile coverage. Hardware cost is a fraction of a commercial system.

> **Status:** 🚧 Early development. Beltpack-to-beltpack latency over LTE has been proven **under 100 ms**. Other features below are design goals unless marked otherwise.

---

## Why?

Professional intercom systems work well but cost a lot. Their range is also limited by the radio infrastructure you deploy. Event crews, motorsport teams and production groups with smaller budgets often fall back to consumer radios or phone calls. Those options lack party-line channels, PTT, and integration with headsets.

| | Commercial (Bolero / Clear-Com) | OpenComms |
|---|---|---|
| Beltpack cost | High (commercial pricing) | Low-cost dev-board hardware |
| Infrastructure | Antennas / base stations / matrix | None on-site (uses 4G LTE) |
| Range | Site coverage (typically hundreds of metres) | Anywhere with mobile coverage |
| Latency | Very low | Under 100 ms beltpack-to-beltpack over LTE (measured) |
| Open / hackable | No | Yes |

The main trade-off is reliance on the mobile network. Measured latency between two beltpacks over LTE is under 100 ms, which is comfortable for conversational crew comms.

---

## Planned Features

- [ ] **Push-to-talk (PTT)**: momentary and latching talk modes
- [ ] **Party-line channels**: 4 channels (A–D) per beltpack; join and talk on one or more shared channels/groups
- [ ] **4G LTE transport** via SIM7600G (Wi-Fi as an optional fallback)
- [ ] **Compressed low-latency audio**: Opus at 24 kbit/s in 20 ms packets over UDP (encoding proven on a plain ESP32)
- [ ] **Headset support**: mic input and earpiece output via an I2S audio codec
- [ ] **Per-channel volume** and sidetone
- [ ] **Call / alert signalling** between users
- [ ] **Battery powered** with charge and level monitoring
- [ ] **GPS position reporting** using the SIM7600G's built-in GNSS
- [ ] **Server / relay** to mix and route audio between beltpacks
- [ ] **Web portal** for remote configuration: a visual **comms plan** showing who is on each channel and who can talk or only listen, names, key modes and volumes, live status, GPS map, OTA firmware updates, remote mute/disable, calls, and multiple events/teams
- [ ] **Talk/listen from a web browser** (WebRTC)
- [ ] **Base station** bridging OpenComms to legacy gear: two-way radios, 4-wire, 2-wire partyline (Clear-Com/RTS), line in/out, relay/GPIO

---

## System Architecture

```
 ┌──────────────┐   LTE    ┌──────────────────────────┐    LTE   ┌──────────────┐
 │  Beltpacks   │◄────────►│  Cloud server (VPS)      │◄────────►│  Beltpacks   │
 │ ESP32-S3 +   │  audio + │  • media mixer / relay   │          │              │
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

1. **Beltpack:** captures mic audio while talking, encodes it (Opus) and streams it to the server. It plays back the mix for its channels.
2. **Base station:** connects legacy radios and intercom systems; each interface port appears as a channel participant.
3. **Server:** runs on a cloud VPS. It mixes audio per channel (mix-minus per participant), and hosts the MQTT control broker and the portal.
4. **Portal:** a web app for remote configuration, live status, firmware updates and browser talk/listen.

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
| Controls | 4 talk keys (A–D) + Call key with RGB LEDs, headset PTT, rotary encoder for volume |
| Display | 128×64 I2C OLED |
| Battery | 18650 Li-ion, high-drain |
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
- A cloud VPS (small Linux VM near your region) with a public IP to run the relay/mixer server

### Build & Flash

```bash
git clone https://github.com/lpkeng/OpenComms.git
cd OpenComms
# build / flash instructions TBD
```

### Configuration

Devices are configured remotely from the **web portal** (channels, who can talk or only listen on each, key modes, names, volumes, firmware). A working portal v0 with a device simulator is in [server/](server/README.md): run `.\tools\dev-up.ps1` and open <http://127.0.0.1:8000>. Only the network setup is done locally on the device:

- APN settings for your mobile carrier
- Server address
- Device claim (scan the device's QR code in the portal)

---

## Roadmap

1. **Bring-up:** modem connects to LTE, I2S audio loopback works on the ESP32-S3
2. ✅ **Latency test:** two beltpacks exchanging audio over LTE, measured under 100 ms
3. **PTT + channels:** party-line channel routing with mix-minus on the server
4. **Control plane + portal v1:** MQTT config/status, device claiming, channel/key assignment, live status. 🟡 **Portal v0 working** against simulated devices, including the visual comms plan (see [server/](server/README.md)); accounts, TLS and production deployment still to do
5. **Audio quality:** Opus, jitter buffer, latency tuning
6. **Base station:** radio port first, then line, 4-wire, relay/GPIO, then 2-wire partyline
7. **Portal v2:** OTA, GPS map, browser talk/listen (WebRTC), multiple events/teams
8. **Hardware:** custom PCBs and enclosures for beltpack and base station

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
