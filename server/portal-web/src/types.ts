// SPDX-License-Identifier: AGPL-3.0-or-later

export type KeyName = 'A' | 'B' | 'C' | 'D'
/** Talk keys are hold-to-talk and also hear their channel; listen-only keys can't talk. */
export type KeyMode = 'talk' | 'listen_only'
export type Command = 'call' | 'identify' | 'reboot' | 'reset_ptt'

export interface Channel {
  id: number
  name: string
}

export interface OcEvent {
  id: number
  name: string
  active: boolean
  channels: Channel[]
}

export interface Org {
  id: number
  name: string
  active_event_id: number | null
}

export interface KeyConfig {
  key: KeyName
  channel_id: number | null
  mode: KeyMode
  volume: number
}

export interface DeviceConfig {
  version: number
  name: string
  label: string
  admin: { muted: boolean; disabled: boolean }
  event: { id: number; name: string } | null
  channels: Channel[]
  keys: KeyConfig[]
  ptt_channel_id: number | null
  call_channel_id: number | null
  mic_gain_db: number
  sidetone: number
}

export interface DeviceState {
  kind: string
  fw: string
  config_version: number | null
  battery_pct: number
  battery_v: number
  charging: boolean
  net: string
  rssi_dbm: number
  gps: { fix: boolean; lat: number; lon: number }
  listen: KeyName[]
  talk: KeyName[]
  /** Headset PTT channel in use; differs from the plan if the wearer remapped it on the beltpack. */
  ptt_channel_id?: number | null
  alert: boolean
  identify: boolean
  uptime_s: number
}

export interface Device {
  id: string
  kind: string
  name: string
  label: string
  muted: boolean
  disabled: boolean
  config_version: number
  applied_version: number | null
  in_sync: boolean
  online: boolean
  last_seen: number | null
  state: DeviceState | null
  config?: DeviceConfig
}

export interface Discovered {
  id: string
  kind: string
  provisioned: boolean
  online: boolean
}

export interface LiveEntry {
  online: boolean
  state: DeviceState | null
  last_seen: number | null
}

export type Role = 'talk' | 'listen'

/** One device's settings for one event: which channel each key is on and how. */
export interface PlanEntry {
  device_id: string
  keys: KeyConfig[]
  ptt_channel_id: number | null
  call_channel_id: number | null
  mic_gain_db: number
  sidetone: number
}

export interface Plan {
  event: OcEvent
  devices: PlanEntry[]
}

export type WsMessage = { type: 'changed' } | { type: 'live'; id: string; live: LiveEntry }
