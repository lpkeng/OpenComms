# OpenComms

**A low-cost, open-source push-to-talk (PTT) intercom: an alternative to commercial systems such as Riedel Bolero and Clear-Com.**

OpenComms runs on an **ESP32-S3 + SIMCom SIM7600G** 4G LTE board. Each device acts as a wireless beltpack. Commercial DECT or UHF intercoms rely on base stations and antennas at your site. This project sends audio over the cellular network instead, so you don't need on-site infrastructure. Range is limited only by mobile coverage. Hardware cost is a fraction of a commercial system.

> **Status:** 🚧 Early development / concept. Features below are design goals unless marked otherwise.

---

## Why?

Professional intercom systems work well but cost a lot. Their range is also limited by the radio infrastructure you deploy. Event crews, motorsport teams and production groups with smaller budgets often fall back to consumer radios or phone calls. Those options lack party-line channels, PTT, and integration with headsets.

| | Commercial (Bolero / Clear-Com) | OpenComms |
|---|---|---|
| Beltpack cost | High (commercial pricing) | Low-cost dev-board hardware |
| Infrastructure | Antennas / base stations / matrix | None on-site (uses 4G LTE) |
| Range | Site coverage (typically hundreds of metres) | Anywhere with mobile coverage |
| Latency | Very low | Higher (depends on the cellular network) |
| Open / hackable | No | Yes |

The trade-off is latency and reliance on the mobile network. For many crews, wide range and low cost matter more than broadcast-grade latency.

---

## Planned Features

- [ ] **Push-to-talk (PTT)**: momentary and latching talk modes
- [ ] **Party-line channels**: join and talk on one or more shared channels/groups
- [ ] **4G LTE transport** via SIM7600G (Wi-Fi as an optional fallback)
- [ ] **Compressed low-latency audio** (e.g. Opus) over UDP
- [ ] **Headset support**: mic input and earpiece output via an I2S audio codec
- [ ] **Per-channel volume** and sidetone
- [ ] **Call / alert signalling** between users
- [ ] **Battery powered** with charge and level monitoring
- [ ] **GPS position reporting** using the SIM7600G's built-in GNSS
- [ ] **Server / relay** to mix and route audio between beltpacks
- [ ] **Web or app console** for managing users, channels and devices

---

## System Architecture

```
 ┌──────────────┐        4G LTE         ┌────────────────────┐        4G LTE        ┌──────────────┐
 │  Beltpack A  │ ────── UDP audio ───► │   Intercom Server  │ ◄───── UDP audio ─── │  Beltpack B  │
 │ ESP32-S3 +   │ ◄──── mixed audio ─── │  (relay / mixer,   │ ──── mixed audio ──► │ ESP32-S3 +   │
 │ SIM7600G     │                       │  channel routing)  │                      │ SIM7600G     │
 └──────────────┘                       └────────────────────┘                      └──────────────┘
        ▲                                         ▲
   Headset + PTT                          Optional web console
```

1. **Beltpack:** captures mic audio while PTT is held, encodes it, and streams it to the server. It also receives and plays back the mixed channel audio.
2. **Server:** a cloud or self-hosted relay. It receives streams, mixes audio per channel, and sends each user the mix for the channels they've joined.
3. **Console (optional):** device, user and channel management.

---

## Hardware

| Component | Notes |
|---|---|
| ESP32-S3 + SIM7600G board | Main MCU + 4G LTE Cat-4 modem with GNSS |
| Nano SIM with data plan | Any carrier supported by SIM7600G bands |
| I2S audio codec / mic + amp | TBD (e.g. ES8311, or INMP441 + MAX98357A) |
| Headset | TBD connector (e.g. 3.5 mm TRRS or XLR-4 for comms headsets) |
| PTT button(s) | Momentary switches, GPIO input |
| Battery | 18650 Li-ion (TBD) |
| Enclosure | TBD (3D-printed beltpack case planned) |

> Pin mapping and wiring diagrams will be added once the hardware is finalised.

---

## Getting Started

> ⚠️ Firmware is not yet available. The steps below describe the planned workflow.

### Prerequisites

- ESP32-S3 + SIM7600G board
- Activated SIM card with mobile data
- Toolchain: TBD (ESP-IDF or PlatformIO)

### Build & Flash

```bash
git clone https://github.com/lpkeng/OpenComms.git
cd OpenComms
# build / flash instructions TBD
```

### Configuration

Planned configuration options:

- APN settings for your mobile carrier
- Server address and port
- Device / user name
- Default channel(s)

---

## Roadmap

1. **Bring-up:** modem connects to LTE, I2S audio loopback works on the ESP32-S3
2. **Point-to-point audio:** two beltpacks talking via a simple UDP relay
3. **PTT + channels:** party-line channel routing on the server
4. **Audio quality:** Opus encoding, jitter buffer, latency tuning
5. **Hardware:** custom PCB/enclosure, headset connector, battery management
6. **Management:** web console, device provisioning, GPS tracking

---

## Contributing

Contributions, ideas and testing feedback are welcome. Please open an issue to discuss changes before submitting a pull request.

## License

TBD

## Disclaimer

This project is not affiliated with Riedel Communications (Bolero) or Clear-Com. All trademarks belong to their respective owners. This is not a safety-critical communications system.
