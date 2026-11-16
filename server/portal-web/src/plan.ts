// SPDX-License-Identifier: AGPL-3.0-or-later
// Comms-plan model shared by the board, matrix and audio-flow views.
import type { Channel, Device, KeyName, OcEvent, Plan, PlanEntry, Role } from './types'

// Distinct channel colours. Red is deliberately absent: it means "talking now".
const PALETTE = ['#3b82f6', '#f59e0b', '#10b981', '#a855f7', '#06b6d4', '#ec4899', '#84cc16', '#f97316']

export function channelColor(event: OcEvent | null, channelId: number | null): string | undefined {
  if (!event || channelId == null) return undefined
  const i = event.channels.findIndex((c) => c.id === channelId)
  return i < 0 ? undefined : PALETTE[i % PALETTE.length]
}

export const displayName = (d: { id: string; name: string }) => d.name || d.id

export interface Membership {
  channelId: number
  role: Role
  key: KeyName
}

export function memberships(entry: PlanEntry): Membership[] {
  return entry.keys.flatMap((k) =>
    k.channel_id == null || k.mode === 'off'
      ? []
      : [{ channelId: k.channel_id, role: k.mode === 'listen_only' ? ('listen' as const) : ('talk' as const), key: k.key }],
  )
}

export interface Person {
  id: string
  device: Device
  entry: PlanEntry
  memberships: Membership[]
}

export interface ChannelInfo {
  channel: Channel
  color: string
  talkers: Person[]
  listeners: Person[]
}

export interface PlanModel {
  event: OcEvent
  live: boolean
  people: Person[]
  channels: ChannelInfo[]
}

export function buildModel(plan: Plan, devices: Device[]): PlanModel {
  const byId = new Map(devices.map((d) => [d.id, d]))
  const people: Person[] = plan.devices
    .filter((e) => byId.has(e.device_id))
    .map((entry) => ({ id: entry.device_id, device: byId.get(entry.device_id)!, entry, memberships: memberships(entry) }))
    .sort((a, b) => displayName(a.device).localeCompare(displayName(b.device)))
  const channels = plan.event.channels.map((channel, i) => {
    const on = (role: Role) =>
      people.filter((p) => p.memberships.some((m) => m.channelId === channel.id && m.role === role))
    return { channel, color: PALETTE[i % PALETTE.length], talkers: on('talk'), listeners: on('listen') }
  })
  return { event: plan.event, live: plan.event.active, people, channels }
}

export function membershipOn(p: Person, channelId: number): Membership | undefined {
  return p.memberships.find((m) => m.channelId === channelId)
}

export const freeKeys = (p: Person) => p.entry.keys.filter((k) => k.channel_id == null).length

/** Whether a person could be put on this channel without taking them off another one. */
export const canJoin = (p: Person, channelId: number) =>
  p.entry.keys.some((k) => k.channel_id === channelId) || freeKeys(p) > 0

export const hasPtt = (p: Person, channelId: number) => p.entry.ptt_channel_ids.includes(channelId)

/** Talking on this channel right now (live state, active event only). */
export function talkingOn(model: PlanModel, p: Person, channelId: number): boolean {
  const m = membershipOn(p, channelId)
  const s = p.device.state
  return !!(model.live && m && p.device.online && s && s.talk.includes(m.key))
}

/** Can actually be heard: on the channel as a talker and not muted/disabled by an admin. */
export const canTalk = (p: Person) => !p.device.muted && !p.device.disabled

export function hears(model: PlanModel, p: Person): { ch: ChannelInfo; from: Person[] }[] {
  if (p.device.disabled) return []
  return model.channels
    .filter((ch) => membershipOn(p, ch.channel.id))
    .map((ch) => ({ ch, from: ch.talkers.filter((t) => t.id !== p.id) }))
}

export function heardBy(model: PlanModel, p: Person): { ch: ChannelInfo; by: Person[] }[] {
  if (!canTalk(p)) return []
  return model.channels
    .filter((ch) => membershipOn(p, ch.channel.id)?.role === 'talk')
    .map((ch) => ({ ch, by: [...ch.talkers, ...ch.listeners].filter((q) => q.id !== p.id && !q.device.disabled) }))
}

export function channelWarning(ch: ChannelInfo): string | null {
  const members = ch.talkers.length + ch.listeners.length
  if (members === 0) return 'Nobody is on this channel'
  if (ch.talkers.length === 0) return 'Nobody can talk on this channel'
  if (members === 1) return 'Only one person, so nobody hears them'
  return null
}

export type Selection = { kind: 'person'; id: string } | { kind: 'channel'; id: number } | null

/** People and channels related to the current selection, for highlighting. */
export function related(model: PlanModel, sel: Selection): { people: Set<string>; channels: Set<number> } | null {
  if (!sel) return null
  if (sel.kind === 'channel') {
    const ch = model.channels.find((c) => c.channel.id === sel.id)
    return { people: new Set([...(ch?.talkers ?? []), ...(ch?.listeners ?? [])].map((p) => p.id)), channels: new Set([sel.id]) }
  }
  const p = model.people.find((x) => x.id === sel.id)
  if (!p) return null
  return { people: new Set([p.id]), channels: new Set(p.memberships.map((m) => m.channelId)) }
}
