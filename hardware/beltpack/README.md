# Beltpack Hardware: Prototype P0

This is the first beltpack prototype. It's built from off-the-shelf modules on perfboard to prove out the audio, controls and LTE link. A custom carrier PCB comes later (see [Path to custom PCB](#path-to-custom-pcb)).

> **Status:** Design draft. Nothing has been built or measured yet. Values marked *TBC* still need to be confirmed on the bench.

---

## Prototype goals

- 4 talk channels (A–D), each with its own talk key and status LED
- 1 Call key for alerting other users
- Rotary encoder for per-channel volume and menus
- Small OLED status display
- 3M Peltor CH-3 FLX2 `-111` headset (dynamic boom mic, built-in PTT)
- 4G LTE audio via the on-board SIM7600G-H
- Runs off a single 18650 cell

## Block diagram

```
                       ┌───────────────────────────────────────────────┐
                       │ LilyGO T-SIM7600G-S3-Standard (H803)          │
   LTE antenna ───────►│  SIM7600G-H  ◄─UART─►  ESP32-S3-WROOM-1 N16R2 │
   (GNSS antenna) ────►│                         │      │      │       │
   18650 ─────────────►│  charger / BMS          │I2S   │I2C   │GPIO   │
                       └─────────────────────────┼──────┼──────┼───────┘
                                                 │      │      │
                         ┌───────────────────────┘      │      ├── 4× talk keys + Call key
                         ▼                              │      ├── EC11 rotary encoder (+ push)
                ┌─────────────────┐   I2C (Qwiic)       │      └── 5× SK6812 RGB LEDs (1-wire)
                │ WM8960 codec    │◄────────────────────┤
                │ mic PGA + HP amp│                     ▼
                └────────┬────────┘              ┌─────────────┐
                         │                       │ 128×64 OLED │
                 FLX2 headset cable              └─────────────┘
              (mic in, earpiece out; PTT pair → IO1)
```

---

## Main board: LilyGO T-SIM7600G-S3-Standard (H803)

| Item | Detail |
|---|---|
| MCU | ESP32-S3-WROOM-1 N16R2: 16 MB flash, 2 MB **quad** PSRAM, so GPIO35–37 are free |
| Modem | SIM7600G-H R2, LTE Cat-4, global bands, built-in GNSS |
| Power | 18650 holder, USB-C/solar charging (500 mA max), on-board BMS |
| Docs | [Quick start + pin map](https://github.com/Xinyuan-LilyGO/LilyGo-Modem-Series/blob/main/docs/en/esp32s3/sim7600g-s3-standard/README.MD) · [Schematic](https://github.com/Xinyuan-LilyGO/LilyGo-Modem-Series/blob/main/schematic/standard/T-SIM7600G-S3-Standard_Rev1.0.pdf) |

**Why we don't use the LilyGO ExpansionKit audio:** the ExpansionKit has a NAU8810 audio chip and a 3.5 mm jack, but they're wired to the **modem's** PCM port. That port is meant for phone calls, and the ESP32 can't get at it. OpenComms streams its own audio from the ESP32, so we fit our own I2S audio chip instead.

### Free GPIO

The camera connector is left empty, which frees up its pins. These are on the 2.54 mm headers and free for our use:

`IO1, IO9, IO14, IO15, IO16, IO17, IO21, IO35, IO36, IO37, IO38, IO39, IO40, IO41, IO47` (15 pins)

Plus the I2C bus on the **SDA (IO3) / SCL (IO2)** header pins and the QWIIC connector. These two pins can only be used for I2C.

Don't use these:
- **IO0, IO45, IO46:** strapping pins
- **IO45 / IO48:** wired to the modem's GPS UART
- **IO4–8, IO10–13, IO18, IO42:** used for the modem, SD card, battery ADC and power-save control

---

## Headset: 3M Peltor CH-3 FLX2 `-111`

Source: *3M PELTOR CH-3 FLX2 Headset Technical Data Sheet (ANZ)*.

**OpenComms uses the CH-3 FLX2 `-111` variant (built-in PTT on the left cup).** It comes as MT74H52A-111 (headband), MT74H52B-111 (neckband) or MT74H52P3E-111 (helmet attach), plus black "SV" versions. Its wiring maps directly onto three isolated pairs: MIC, SPK and PTT.

| Parameter | Value |
|---|---|
| Connector | FLX2 = 6-pin mini-XLR, **male pins on the headset** |
| Microphone | **Dynamic**, 150 Ω, noise-cancelling, 200 Hz–7 kHz, IP68 |
| Mic sensitivity | −71 dB ±3 dB re 1 V/Pa @ 1 kHz (≈ 0.3 mV/Pa) |
| Speakers | 46 mm, 230 Ω ±10% each, SPL 107 ±2 dB, 100 Hz–8 kHz |
| Earpiece load | Both speakers **in parallel**, so **≈ 115 Ω** |
| PTT | Switch contact across the two PTT pins (left cup) |

### Connector and cable

```
 Headset                    Cable                        Beltpack
 mini-XLR 6-pin MALE  ◄──►  6-pin mini-XLR FEMALE  ──►  mini-XLR 6-pin MALE
 (on headset lead)          ── FEMALE both ends ──       (panel mount)
```

- The beltpack has a **6-pin mini-XLR male panel-mount connector**, the same gender as the headset.
- The interconnect cable is **female ↔ female**. Assuming it's wired **straight-through** (pin n ↔ pin n), the beltpack's pin numbering matches the headset's. Verify with a multimeter, because a crossed cable would swap functions.
- The beltpack's male pins are exposed when no cable is fitted, so the headset I/O needs to tolerate being touched or shorted. The 1 kΩ in the PTT line helps. The custom PCB should add ESD protection on all 6 pins.

### FLX2 pin functions (`-111`)

| Pin function | Beltpack connection |
|---|---|
| Microphone ("adjusted signal") | WM8960 LINPUT2 via 4.7 µF |
| Microphone ground | WM8960 LINPUT1 via 4.7 µF |
| PTT | IO1 via 1 kΩ |
| PTT | GND |
| Speakers (parallel) | WM8960 HP_L |
| Speakers ground (parallel) | WM8960 OUT3 (**not** GND) |

Pin *positions* follow the datasheet's "Wiring Pin Configuration" drawing (pin-side view). With a straight-through cable, the beltpack's panel connector uses the same positions.

> The `-110` variant is **not supported**. It has no PTT and its left/right speakers are wired separately.

**Mic gain:** −71 dBV/Pa gives about 0.3–2 mV for close-talked speech. Reaching a healthy ADC level takes about **50–60 dB of gain**. A dynamic mic doesn't need bias voltage, so leave MICBIAS **off**. 3M describes the `-111` mic pin as an "adjusted signal", so tune the gain on the bench.

---

## Audio: WM8960 codec

The WM8960 was chosen for these reasons:
- **Mic gain:** a differential mic preamp with up to **+59 dB** (+29 dB boost and +30 dB PGA). That's enough for a dynamic mic without a separate preamp.
- **Built-in ALC** (automatic level control) and a noise gate for the mic.
- **Two outputs:** a headphone driver plus a 1 W/channel class-D output. The headphone driver should be plenty for the ≈ 115 Ω earpiece load, and the class-D output is a fallback.
- **Easy to connect:** I2C control and a standard I2S interface. The chip is still in production, so it can go straight onto the custom PCB later.

Prototype module: **SparkFun Audio Codec Breakout – WM8960 (BOB-21250 / BOB-21772)**. It's retired by SparkFun but still stocked by resellers. Any WM8960 breakout that exposes MCLK/BCLK/LRC/DAC/ADC, the mic inputs and the headphone outputs will do.

### Mic wiring (differential)

```
FLX2 Microphone         ──┤├── 4.7 µF ──► WM8960 LINPUT2 (non-inverting)
FLX2 Microphone ground  ──┤├── 4.7 µF ──► WM8960 LINPUT1 (inverting)
                          (MICBIAS not connected)
```

### Earpiece wiring

On the `-111` the speaker pair (≈ 115 Ω) is isolated from the mic and PTT, so neither speaker wire needs to go to GND.

```
Option 1 (start here): capless headphone output
  Speakers (parallel)        ──► WM8960 HP_L
  Speakers ground (parallel) ──► WM8960 OUT3 (VMID ≈ 1.65 V, NOT GND)

Option 2 (only if more level is needed): bridged class-D output
  Speakers (parallel)        ──► WM8960 SPK_LP
  Speakers ground (parallel) ──► WM8960 SPK_LN
```

- ⚠️ In both options, the **speaker ground must never touch GND**, the mic wires or the PTT wires.
- **Expected level:** the headphone output swings about 1 V RMS, which is roughly 9 mW into 115 Ω. That should be ample for these high-impedance speakers, so Option 2 is unlikely to be needed. Confirm on the bench.
- Option 2 roughly doubles the voltage swing. It's a switching output, so add a small ferrite bead on each leg if you hear hiss or the cable radiates interference.
- **Volume:** set by the user with the encoder. There is no firmware maximum-level cap (design decision).

### Headset PTT wiring

```
PTT (pin A) ──── 1 kΩ ────► IO1  (on-board 10 kΩ pull-up; active-low)
PTT (pin B) ──────────────► GND
```

The 1 kΩ series resistor gives some protection against ESD and accidental shorts on the long headset cable.

---

## Controls and UI

| Control | Behaviour (planned) |
|---|---|
| **Talk keys A–D** | Tap = latch talk on/off, hold = momentary talk (Bolero/Clear-Com style) |
| **Headset PTT** | Momentary talk on the selected channel(s) (configurable) |
| **Call key** | Send a call/alert to the selected channel |
| **Encoder** | Turn = volume of the last-touched channel; press = cycle channel; long-press = menu |
| **Key LEDs** (SK6812 RGB) | Off = unassigned, green = listening, red = talking, flashing = incoming call |
| **OLED** (128×64) | Channel names, talk/listen state, volume bars, LTE signal, battery |

Keys are active-low to GND using the ESP32 internal pull-ups, debounced in firmware. Use panel-mount keys big enough to press with gloves on.

---

## Pin map (P0)

| Function | ESP32-S3 GPIO | Header | Notes |
|---|---|---|---|
| I2S MCLK | IO38 | Left | WM8960 MCLK |
| I2S BCLK | IO39 | Left | WM8960 BCLK |
| I2S WS (LRCLK) | IO40 | Left | WM8960 DACLRC + ADCLRC (tied) |
| I2S DOUT → codec | IO41 | Left | WM8960 DACDAT (on-board 10 kΩ pull-up is harmless) |
| I2S DIN ← codec | IO15 | Left | WM8960 ADCDAT |
| Encoder A | IO16 | Left | PCNT-capable |
| Encoder B | IO37 | Left | |
| Encoder push | IO21 | Left | Active-low |
| Talk key A | IO17 | Right | Active-low |
| Talk key B | IO35 | Right | Active-low |
| Talk key C | IO36 | Right | Active-low |
| Talk key D | IO9 | Right | Active-low |
| Call key | IO14 | Right | Active-low |
| LED data | IO47 | Right | SK6812 chain: A, B, C, D, Call |
| Headset PTT | IO1 | Right | Active-low via 1 kΩ; on-board 10 kΩ pull-up |
| I2C SDA | IO3 | Left (SDA) / QWIIC | WM8960, OLED |
| I2C SCL | IO2 | Left (SCL) / QWIIC | WM8960, OLED |

Wire by the **silkscreen labels** on the board, not by header position.

### I2C devices

| Device | Address |
|---|---|
| WM8960 | `0x1A` |
| OLED (SSD1306 / SH1106) | `0x3C` |
| On-board SGM38121 (camera LDO) | already on this bus; confirm no clash with an I2C scan |

---

## Power

| Item | Notes |
|---|---|
| Battery | 1× 18650 Li-ion, 4.2 V full charge, high-drain (≥ 3000 mAh, ≥ 10 A) |
| Modem peaks | SIM7600 transmit bursts reach about **2 A**, so the cell must handle this without browning out |
| Power Save pin | Drive **IO42 HIGH** so the power stage can supply full current during LTE transmit |
| LEDs | Power the SK6812s from **VBAT** (not 3V3); a 3.3 V data line is fine at that supply. Cap brightness in firmware |
| First power-up | The BMS must be activated by plugging into **ESP-USB** once before the battery will power the board |
| Charging | On-board charger is limited to 500 mA, so a 3000 mAh cell takes 6 h or more |

**Runtime:** *TBC.* Measure average current while streaming on LTE. If one cell can't last a full event day, options are a second cell on the VBAT pin or swappable cells.

---

## Prototype bill of materials

| # | Part | Qty | Notes |
|---|---|---|---|
| 1 | LilyGO T-SIM7600G-S3-Standard (H803) | 1 | Main board |
| 2 | LTE antenna (IPEX/U.FL) | 1 | Flexible stick-on type fits inside an enclosure |
| 3 | GNSS active antenna (IPEX/U.FL) | 1 | Optional, for position reporting |
| 4 | Nano SIM with data plan | 1 | |
| 5 | 18650 Li-ion cell, high-drain | 1 | 4.2 V chemistry only (no LiFePO4) |
| 6 | WM8960 breakout: SparkFun BOB-21772 / BOB-21250 (reseller stock) | 1 | Audio codec. Fallback: Waveshare WM8960 Audio Board, but mic/HP go via a shared-ground 3.5 mm jack and must be tapped off-board |
| 7 | 6-pin mini-XLR **male** panel connector: **Switchcraft TB6M** (Tini Q-G, solder cup, rear nut) | 1 | Beltpack headset socket; DigiKey SC2572-ND. Test-fit with the cable first |
| 8 | 3M Peltor CH-3 FLX2 `-111` headset (e.g. MT74H52A-111) | 1 | Built-in PTT variant |
| 9 | 6-pin mini-XLR female ↔ female cable | 1 | Headset ↔ beltpack (straight-through) |
| 10 | 4.7 µF film/ceramic capacitors | 2 | Mic coupling |
| 11 | 1 kΩ resistor | 1 | Headset PTT series protection |
| 12 | 0.96"/1.3" I2C OLED, SSD1306 or SH1106, 128×64 | 1 | Qwiic version simplifies wiring |
| 13 | Momentary push buttons (panel-mount, glove-friendly) | 5 | 4× talk + Call |
| 14 | SK6812 RGB LEDs (or 5-LED strip segment) | 5 | One per key |
| 15 | EC11 rotary encoder with push switch + knob | 1 | |
| 16 | Qwiic/JST-SH cables, perfboard, headers, wire | — | |

---

## Bring-up plan

1. **Board alone:** flash a LilyGO `ATdebug` example, confirm the modem registers on LTE and gets a data connection.
2. **I2C scan:** WM8960 at `0x1A`, OLED at `0x3C`, no clashes.
3. **Headset check:** confirm the female↔female cable is straight-through. Then, at the cable's free end with the headset connected, identify the MIC, SPK and PTT pairs. Expect about 115 Ω across the speaker pair and about 150 Ω across the mic, plus a short across PTT when pressed. Confirm the three pairs are isolated from each other.
4. **Audio loopback:** mic → WM8960 ADC → ESP32 → WM8960 DAC → earpiece. Tune mic gain/ALC and check for noise and hum.
5. **UI:** keys, encoder, LEDs and OLED driven from a test sketch.
6. **Power:** measure idle, LTE-attached and streaming current, and check the voltage dip during transmit bursts.
7. **Two-unit link:** stream audio between two beltpacks over LTE via a UDP relay (first end-to-end milestone).

---

## Path to custom PCB

After P0 is proven, a carrier PCB that the LilyGO board plugs into would integrate:
- WM8960 with proper analog layout and mic input protection
- 6-pin mini-XLR **male** panel connector (same pin positions as the headset), with ESD protection on all pins
- Key, LED and encoder footprints matching the enclosure
- Optional second cell / improved charging

## Open questions

- [ ] Earpiece loudness from the headphone output into the ≈ 115 Ω load
- [x] ~~Exact part number for the 6-pin mini-XLR male panel connector~~: Switchcraft TB6M (test-fit with the cable)
- [ ] Is the WM8960 mic preamp quiet enough, or do we need a dedicated preamp?
- [ ] Battery runtime on LTE, and whether one 18650 is enough
- [ ] Enclosure size and key layout
