// SPDX-License-Identifier: AGPL-3.0-or-later
import { useMemo, useState } from 'react'
import {
  canTalk,
  displayName,
  membershipOn,
  talkingOn,
  type ChannelInfo,
  type Person,
  type PlanModel,
  type Selection,
} from '../plan'

interface Props {
  model: PlanModel
  selection: Selection
  onSelect: (s: Selection) => void
}

const W = 1000
const NODE_W = 200
const NODE_H = 46
const GAP = 12
const TOP = 40
const COL_X = { talker: 10, channel: 400, hearer: 790 } as const

type Kind = keyof typeof COL_X
type Level = 'primary' | 'secondary' | 'dim' | ''

interface FlowNode {
  id: string
  kind: Kind
  x: number
  y: number
  person?: Person
  ch?: ChannelInfo
}

interface FlowEdge {
  id: string
  from: FlowNode
  to: FlowNode
  ch: ChannelInfo
  person: Person
  dir: 'talk' | 'hear'
  listenOnly: boolean
  live: boolean
  blocked: boolean
  y1: number
  y2: number
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

function layout(model: PlanModel) {
  const index = new Map(model.channels.map((c, i) => [c.channel.id, i]))
  // Order people by the average position of their channels, which keeps most edges from crossing.
  const byChannels = (people: Person[], roles: string[]) => {
    const avg = (p: Person) => {
      const idx = p.memberships.filter((m) => roles.includes(m.role)).map((m) => index.get(m.channelId) ?? 0)
      return idx.reduce((a, b) => a + b, 0) / Math.max(1, idx.length)
    }
    return [...people].sort((a, b) => avg(a) - avg(b))
  }
  const talkers = byChannels(
    model.people.filter((p) => p.memberships.some((m) => m.role === 'talk')),
    ['talk'],
  )
  const hearers = byChannels(
    model.people.filter((p) => p.memberships.length > 0),
    ['talk', 'listen'],
  )

  const colH = (n: number) => n * NODE_H + Math.max(0, n - 1) * GAP
  const height = Math.max(colH(talkers.length), colH(model.channels.length), colH(hearers.length), NODE_H)
  const place = (kind: Kind, i: number, n: number) => ({
    kind,
    x: COL_X[kind],
    y: TOP + (height - colH(n)) / 2 + i * (NODE_H + GAP),
  })

  const talkerNodes: FlowNode[] = talkers.map((p, i) => ({ id: `t:${p.id}`, person: p, ...place('talker', i, talkers.length) }))
  const channelNodes: FlowNode[] = model.channels.map((ch, i) => ({
    id: `c:${ch.channel.id}`,
    ch,
    ...place('channel', i, model.channels.length),
  }))
  const hearerNodes: FlowNode[] = hearers.map((p, i) => ({ id: `h:${p.id}`, person: p, ...place('hearer', i, hearers.length) }))
  const channelNode = new Map(channelNodes.map((n) => [n.ch!.channel.id, n]))

  const edges: FlowEdge[] = []
  for (const t of talkerNodes) {
    const p = t.person!
    for (const m of p.memberships) {
      const c = channelNode.get(m.channelId)
      if (!c || m.role !== 'talk') continue
      edges.push({
        id: `${t.id}>${c.id}`,
        from: t,
        to: c,
        ch: c.ch!,
        person: p,
        dir: 'talk',
        listenOnly: false,
        live: canTalk(p) && talkingOn(model, p, m.channelId),
        blocked: !canTalk(p),
        y1: 0,
        y2: 0,
      })
    }
  }
  for (const h of hearerNodes) {
    const p = h.person!
    for (const m of p.memberships) {
      const c = channelNode.get(m.channelId)
      if (!c) continue
      const someoneTalking = c.ch!.talkers.some((t) => t.id !== p.id && canTalk(t) && talkingOn(model, t, m.channelId))
      edges.push({
        id: `${c.id}>${h.id}`,
        from: c,
        to: h,
        ch: c.ch!,
        person: p,
        dir: 'hear',
        listenOnly: m.role === 'listen',
        live: !p.device.disabled && someoneTalking,
        blocked: p.device.disabled,
        y1: 0,
        y2: 0,
      })
    }
  }

  // Spread edge ends down each node's side, ordered by where the other end is.
  const group = (key: (e: FlowEdge) => string) => {
    const map = new Map<string, FlowEdge[]>()
    for (const e of edges) map.set(key(e), [...(map.get(key(e)) ?? []), e])
    return [...map.values()]
  }
  const spread = (list: FlowEdge[], end: 'y1' | 'y2') => {
    const node = end === 'y1' ? list[0].from : list[0].to
    const other = (e: FlowEdge) => (end === 'y1' ? e.to.y : e.from.y)
    list.sort((a, b) => other(a) - other(b))
    list.forEach((e, i) => {
      e[end] = node.y + 8 + (NODE_H - 16) * (list.length === 1 ? 0.5 : i / (list.length - 1))
    })
  }
  for (const list of group((e) => e.from.id)) spread(list, 'y1')
  for (const list of group((e) => e.to.id)) spread(list, 'y2')

  return { height: TOP + height + 10, nodes: [...talkerNodes, ...channelNodes, ...hearerNodes], edges }
}

function edgeLevel(e: FlowEdge, focus: Selection, focusPerson: Person | undefined): Level {
  if (!focus) return ''
  if (focus.kind === 'channel') return e.ch.channel.id === focus.id ? 'primary' : 'dim'
  if (e.person.id === focus.id) return 'primary'
  const m = focusPerson && membershipOn(focusPerson, e.ch.channel.id)
  // Someone talking into a channel the focused person hears, or someone hearing a channel they talk on.
  if (e.dir === 'talk') return m ? 'secondary' : 'dim'
  return m?.role === 'talk' ? 'secondary' : 'dim'
}

const RANK: Record<Level, number> = { dim: 0, '': 1, secondary: 2, primary: 3 }

function selectionOf(n: FlowNode): Selection {
  return n.person ? { kind: 'person', id: n.person.id } : { kind: 'channel', id: n.ch!.channel.id }
}

function nodeText(n: FlowNode, model: PlanModel): { title: string; sub: string } {
  if (n.ch) return { title: n.ch.channel.name, sub: `${n.ch.talkers.length} talk · ${n.ch.listeners.length} listen` }
  const p = n.person!
  const d = p.device
  if (d.disabled) return { title: displayName(d), sub: 'Disabled' }
  if (n.kind === 'talker' && d.muted) return { title: displayName(d), sub: 'Muted by admin' }
  const count = n.kind === 'talker' ? p.memberships.filter((m) => m.role === 'talk').length : p.memberships.length
  const fallback = n.kind === 'talker' ? `Talks on ${count}` : `Hears ${count} of ${model.channels.length}`
  return { title: displayName(d), sub: d.label || fallback }
}

export default function PlanFlow({ model, selection, onSelect }: Props) {
  const [hover, setHover] = useState<Selection>(null)
  const { height, nodes, edges } = useMemo(() => layout(model), [model])
  const focus = hover ?? selection
  const focusPerson = focus?.kind === 'person' ? model.people.find((p) => p.id === focus.id) : undefined

  const levels = new Map(edges.map((e) => [e.id, edgeLevel(e, focus, focusPerson)]))
  const nodeLevel = (n: FlowNode): Level => {
    if (!focus) return ''
    const s = selectionOf(n)
    if (s?.kind === focus.kind && s.id === focus.id) return 'primary'
    const touching = edges.filter((e) => e.from === n || e.to === n).map((e) => levels.get(e.id))
    return touching.includes('primary') ? 'primary' : touching.includes('secondary') ? 'secondary' : 'dim'
  }
  const sorted = [...edges].sort((a, b) => RANK[levels.get(a.id)!] - RANK[levels.get(b.id)!])
  const idle = model.people.filter((p) => p.memberships.length === 0)

  return (
    <>
      <p className="muted small hint">
        Audio flows left to right: people who can talk, the channel, and everyone who hears it. Dashed lines are listen
        only. Hover or click anyone to trace their audio.
      </p>
      <svg className="flow" viewBox={`0 0 ${W} ${height}`} role="img" aria-label="Who hears whom">
        <g className="col-titles">
          <text x={COL_X.talker + NODE_W / 2} y={16}>
            CAN TALK
          </text>
          <text x={COL_X.channel + NODE_W / 2} y={16}>
            CHANNEL
          </text>
          <text x={COL_X.hearer + NODE_W / 2} y={16}>
            HEARS
          </text>
          <text x={(COL_X.talker + NODE_W + COL_X.channel) / 2} y={16} className="arrow">
            talks on →
          </text>
          <text x={(COL_X.channel + NODE_W + COL_X.hearer) / 2} y={16} className="arrow">
            is heard by →
          </text>
        </g>
        {sorted.map((e) => {
          const x1 = e.from.x + NODE_W
          const x2 = e.to.x
          const mx = (x1 + x2) / 2
          const cls = ['edge', levels.get(e.id), e.listenOnly && 'listen', e.live && 'live', e.blocked && 'blocked']
          return (
            <path
              key={e.id}
              d={`M ${x1} ${e.y1} C ${mx} ${e.y1}, ${mx} ${e.y2}, ${x2} ${e.y2}`}
              className={cls.filter(Boolean).join(' ')}
              stroke={e.blocked ? undefined : e.ch.color}
            />
          )
        })}
        {nodes.map((n) => {
          const { title, sub } = nodeText(n, model)
          const s = selectionOf(n)
          const talking =
            n.kind === 'talker'
              ? edges.some((e) => e.from === n && e.live)
              : n.kind === 'channel' && edges.some((e) => e.to === n && e.live)
          const selected = selection?.kind === s?.kind && selection?.id === s?.id
          const cls = ['node', n.kind, nodeLevel(n), talking && 'talking', selected && 'selected']
          if (n.person && (n.person.device.disabled || (n.kind === 'talker' && n.person.device.muted))) cls.push('off')
          return (
            <g
              key={n.id}
              className={cls.filter(Boolean).join(' ')}
              transform={`translate(${n.x} ${n.y})`}
              tabIndex={0}
              role="button"
              aria-label={`${title}: ${sub}`}
              onMouseEnter={() => setHover(s)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(s)}
              onBlur={() => setHover(null)}
              onClick={() => onSelect(s)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onSelect(s)
              }}
            >
              <rect className="node-box" width={NODE_W} height={NODE_H} rx={8} />
              {n.ch && <rect className="node-bar" width={6} height={NODE_H - 12} x={6} y={6} rx={3} fill={n.ch.color} />}
              <text x={n.ch ? 20 : 12} y={20} className="node-title">
                {truncate(title, 22)}
              </text>
              <text x={n.ch ? 20 : 12} y={36} className="node-sub">
                {truncate(sub, 28)}
              </text>
              {talking && <circle cx={NODE_W - 14} cy={NODE_H / 2} r={5} className="talk-dot" />}
            </g>
          )
        })}
      </svg>
      {idle.length > 0 && (
        <p className="muted small">Not on any channel: {idle.map((p) => displayName(p.device)).join(', ')}</p>
      )}
    </>
  )
}
