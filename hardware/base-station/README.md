# Base Station: Concept Design

The base station is a fixed or desk unit that connects OpenComms channels to **legacy comms gear**: two-way radios, 4-wire matrix ports, 2-wire partyline (Clear-Com / RTS), and line-level program and record feeds. It connects to the OpenComms server like a beltpack. Each interface port shows up as a "virtual user" that can be assigned to channels from the [portal](../../docs/architecture.md).

> **Status:** Concept / architecture draft. Nothing has been built yet. Items marked *TBC* need confirming from datasheets or on the bench.

---

## Requirements

| Requirement | Decision |
|---|---|
| Two-way radio interface | 1 port: RX audio, TX audio, PTT out, COR/COS in |
| 4-wire balanced audio | 1 port: balanced in + balanced out |
| 2-wire partyline | 1 port: Clear-Com-style single-channel first; RTS dual-channel later |
| Line in/out | 1 port: program feed in, record/feed out |
| Relay / GPIO | 2 relay outputs (tally, alarms) + 2 isolated inputs |
| Network | Ethernet **and** Wi-Fi **and** LTE, with automatic failover |
| Power | **12 V DC** (vehicle / battery, 9–16 V) **or PoE** (802.3af) |
| Configuration | Entirely from the portal (port-to-channel mapping, levels, PTT/COR modes) |

---

## Block diagram

```
                     ┌──────────────────────────────────────────────────────────┐
  Ethernet / PoE ───►│ LilyGO T-ETH-Elite (ESP32-S3 N16R8, W5500, PoE option)   │
  LTE antenna ──────►│  + SIM7600G-H mini-PCIe modem      Wi-Fi (built-in)      │
  12 V DC ─► buck ──►│                                                          │
                     └──────┬──────────────┬──────────────┬─────────────────────┘
                       I2S0 │         I2S1 │          I2C │ (via TCA9548A mux)
                            ▼              ▼              ├── TCA9555 GPIO expander
                   ┌──────────────┐ ┌──────────────┐      ├── OLED status display
                   │ Codec A      │ │ Codec B      │      └── codec control
                   │ (WM8960)     │ │ (WM8960)     │
                   │ L: Radio     │ │ L: 2-wire    │
                   │ R: 4-wire    │ │ R: Line      │
                   └──┬────────┬──┘ └──┬────────┬──┘
                      │        │       │        │
               ┌──────▼──┐ ┌───▼────┐ ┌▼───────┐ ┌▼────────┐   ┌──────────────────┐
               │ Radio   │ │ 4-wire │ │ 2-wire │ │ Line    │   │ GPIO (expander)  │
               │ I/F     │ │ I/F    │ │ hybrid │ │ in/out  │   │ PTT, COR, 2×relay│
               │ (DB9)   │ │ (RJ45) │ │ (XLR3) │ │ (TRS)   │   │ 2×opto in, LEDs  │
               └─────────┘ └────────┘ └────────┘ └─────────┘   └──────────────────┘
               All external audio ports are transformer-isolated.
```

---

## Main board: LilyGO T-ETH-Elite (ESP32-S3)

| Item | Detail |
|---|---|
| MCU | ESP32-S3-WROOM-1, 16 MB flash, **8 MB octal PSRAM** (so GPIO35–37 are **not** available) |
| Ethernet | W5500 (SPI) |
| PoE | Optional module, IEEE 802.3af Class 0, 36–57 V |
| LTE | Mini-PCIe slot: SIM7600G-H PCIe module (set the board's voltage DIP switch for SIMCom PCIe modules) |
| Wi-Fi | ESP32-S3 built-in |
| Docs | [T-ETH-Elite ESP32-S3](https://github.com/Xinyuan-LilyGO/LilyGo-Modem-Series/blob/main/docs/en/esp32s3/t-eth-elite-s3/README.MD) |

Using the same ESP32-S3 and SIM7600 family as the beltpack means the base station **shares most of its firmware**: network stack, control link, audio transport, codec driver and OTA.

### GPIO budget

Pins already used by the board: modem (1, 3, 4, 5, 6), GPS (39, 42), SD (9–12), Ethernet (14, 21, 45, 47, 48), LED (38), I2C (17, 18).

Free: `IO2, IO7, IO8, IO13, IO15, IO16, IO40, IO41`, plus `IO43/IO44` if the console moves to USB-CDC. Which of these reach the expansion header is *TBC*.

That's too few pins to wire everything directly, so all slow I/O (PTT, COR, relays, inputs, LEDs) goes through an **I2C GPIO expander**. Direct GPIO is used only for I2S.

### Tentative pin map

| Function | GPIO | Notes |
|---|---|---|
| I2S MCLK (both codecs) | IO40 | Shared |
| I2S0 BCLK / WS / DOUT / DIN | IO41 / IO15 / IO16 / IO13 | Codec A: radio + 4-wire |
| I2S1 BCLK / WS / DOUT / DIN | IO7 / IO8 / IO43 / IO44 | Codec B: 2-wire + line (needs the console on USB-CDC) |
| GPIO expander interrupt | IO2 | COR and opto-input changes |
| I2C SDA / SCL | IO17 / IO18 | TCA9548A mux → codec A, codec B (both `0x1A`); TCA9555 `0x20`; OLED `0x3C` |

### Audio channels

Each WM8960 is stereo, so two codecs give **4 mono inputs and 4 mono outputs**, one pair per interface port. The codec driver is the same as the beltpack's. A later custom PCB could use a single 4-in/4-out TDM codec instead, freeing GPIO.

---

## Interface ports

All external audio ports are **transformer-isolated**. This breaks ground loops between vehicles, radios and mains-powered gear, and protects the electronics. Levels are matched with resistor pads or transformer ratios, and fine-tuned digitally from the portal.

### 1. Two-way radio (DB9 female)

| Signal | Direction | Interface |
|---|---|---|
| RX audio | Radio → base | From the radio's speaker/line out; attenuator so speaker-level signals don't clip; transformer |
| TX audio | Base → radio | To the radio's mic input (mic level, tens of mV); attenuator; transformer |
| PTT | Base → radio | Solid-state relay (optoMOS) contact, pulls the radio's PTT to its own ground |
| COR / COS | Radio → base | Optocoupler input, polarity set in the portal; **VOX** (audio-level detect) fallback in firmware |
| GND | — | Radio ground (isolated from base-station ground) |

DB9 was chosen so the radio port can't be confused with Ethernet. **Per-radio adapter cables** handle Motorola / Kenwood / Hytera accessory connectors (pinouts *TBC* per model).

Behaviour, configured in the portal:
- Radio RX feeds the mapped channel while COR is active (or the VOX threshold is exceeded).
- Anyone talking on the mapped channel keys the radio's PTT, with a configurable hang time.
- **Half-duplex rules:** don't key PTT while COR is active (configurable priority), plus a transmit time-out timer.
- The server sends the radio a **mix-minus**: everything on the channel except the radio's own audio. This prevents loops.

### 2. 4-wire balanced (RJ45)

| Signal | Detail |
|---|---|
| Audio in | Balanced, transformer-coupled, nominal 0 / +4 dBu (selectable) |
| Audio out | Balanced, transformer-coupled, nominal 0 / +4 dBu |
| Connector | RJ45 using a common matrix 4-wire pinout (*TBC*: match Clear-Com matrix convention), or 2× XLR3 |

Used to connect to an intercom matrix port, a broadcast desk, or another comms system's 4-wire interface.

### 3. 2-wire partyline (XLR3 male + female loop-through)

The base station joins an **existing powered partyline as a user station**. It does **not** power or terminate the line in the first version.

| Item | Detail |
|---|---|
| Line connection | High-impedance bridging tap; DC-blocked; isolated |
| 2W↔4W conversion | Transformer hybrid with adjustable null, plus a firmware echo canceller to separate send from receive |
| Call signalling | Detect and generate partyline call signals (Clear-Com: DC on the audio line; RTS: tone). Levels *TBC* from manufacturer docs |
| Phase 1 | Clear-Com-style single channel |
| Phase 2 | RTS-style dual channel (TW), optional line power/termination for standalone use |

> Native 2-wire is the hardest interface to get right because of hybrid nulling and call signalling. Until it's proven, a commercial 2W↔4W interface on the **4-wire port** is a working fallback.

### 4. Line in/out (6.35 mm TRS, balanced)

- **Line in:** program feed (e.g. race commentary, PA) mixed into a channel, or sent to listen-only "program" channels.
- **Line out:** feed a recorder, PA or broadcast desk from a selected channel mix.

### 5. Relay / GPIO (pluggable terminal block)

| Item | Detail |
|---|---|
| 2× relay outputs | Dry contact (NO/COM), e.g. tally light, alarm or siren on a channel call |
| 2× opto-isolated inputs | e.g. external PTT foot switch, remote call trigger |

---

## Network

| Link | Use |
|---|---|
| Ethernet (W5500) | Preferred: lowest latency and cost |
| Wi-Fi | Second choice: venue Wi-Fi |
| LTE (SIM7600) | Fallback: always available, works anywhere with coverage |

Failover is automatic: **Ethernet → Wi-Fi → LTE**. The current link is reported to the portal.

## Power

| Input | Detail |
|---|---|
| 12 V DC | 9–16 V vehicle/battery input. Reverse-polarity protection, TVS for load dump, wide-input buck → 5 V |
| PoE | 802.3af via the T-ETH-Elite PoE module |
| Both connected | Ideal-diode OR-ing of the 5 V rails (*TBC* against the T-ETH-Elite schematic) |

Rough power budget: board + LTE + 2 codecs + interfaces ≈ 2–4 W (*TBC*), well within 802.3af (≈ 12.95 W at the device).

## Front panel

- 128×64 OLED: network link, signal, server status, per-port activity (COR, PTT, levels)
- Status LEDs per port
- One button: show IP / identify / factory reset (long-press)

All configuration happens in the portal. The front panel only shows status.

---

## Prototype plan

1. T-ETH-Elite bring-up: Ethernet, Wi-Fi and LTE (PCIe SIM7600) failover; control link to the server.
2. Two WM8960 breakouts on I2S0/I2S1 behind a TCA9548A, with 4-channel loopback.
3. **Radio port first.** It's the most common legacy gear and the simplest interface (audio + PTT + COR).
4. Line in/out and 4-wire ports (transformer front ends).
5. Relay/GPIO via TCA9555.
6. 2-wire partyline hybrid (phase 1), tested against a real Clear-Com line.

## Open questions

- [ ] Which T-ETH-Elite GPIOs reach the expansion header
- [ ] Power OR-ing between the 12 V buck and PoE on the T-ETH-Elite
- [ ] Radio adapter cable pinouts for target Motorola / Kenwood / Hytera models
- [ ] 4-wire connector standard (RJ45 matrix pinout vs XLR3)
- [ ] 2-wire partyline: exact levels, impedances and call signalling (Clear-Com, RTS)
- [ ] Audio transformer selection (line and mic level, bandwidth, size)
- [ ] Enclosure: desk unit vs 1U half-rack vs vehicle-mount
