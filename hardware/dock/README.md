# Charging Dock

> **Status:** Parked. These ideas are liked but not designed yet. The beltpack's [power design](../beltpack/README.md#carrier-pcb-power-design) already allows for dock charging pins.

A dock that holds a team's beltpacks between sessions: it charges them and also handles the jobs that are slow, fiddly or risky over the air.

## Functions

| Function | Notes |
|---|---|
| **Charging bank** | 5–10 slots, each with its own status light |
| **Adoption** | Set up blank units over the cable, no phone needed. This is the quick alternative to QR code + Bluetooth adoption ([architecture](../../docs/architecture.md#adopting-a-blank-beltpack)) |
| **Firmware updates** | Overnight, over USB: faster and safer than over LTE, and never during an event |
| **Config sync** | Channels, names and keys while charging |
| **Battery health** | Track charge cycles and real capacity, and flag tired batteries before race day. Combines the dock's per-slot current sensing with each beltpack's fuel-gauge history |
| **Diagnostics** | Mic, speaker and button checks; log collection |
| **Server in a box** (optional) | A small computer inside the dock running the team server, for a track-side setup |

## Hardware ideas

- **Supply:** a single 12 or 24 V supply, about 150 W for ten slots at 15 W each plus headroom. A small fan for heat.
- **Per-slot power:** an electronic fuse in each slot, so a shorted unit only kills its own slot.
  - Feeding each slot **9–12 V** cuts pogo-pin current to about 1.3–1.7 A for 15 W. The beltpack's BQ25895 charger accepts up to 14 V.
  - With 12 V passed straight through, a slot needs only the fuse and current sensing; with a 24 V supply it needs a buck converter.
- **Per-slot current sensing** (e.g. INA226) for charge monitoring and battery-health data.
- **Data:** a USB hub, with USB data on each slot's pogo pins.
- **Status:** an addressable RGB LED per slot: charging, full, updating, fault.
- **Network:** Ethernet, for the optional built-in server.
- **Mechanics:** magnets and guides so the pogo pins line up reliably.

## Open questions

- [ ] Pogo-pin layout (power, ground, USB data), and how many pins power needs at the chosen voltage
- [ ] Number of slots
- [ ] 12 V pass-through vs a per-slot buck converter
- [ ] Whether to include the server in a box
