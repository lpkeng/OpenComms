// SPDX-License-Identifier: AGPL-3.0-or-later
import { useRef, useState, type CSSProperties, type DragEvent } from 'react'
import { api, type Run } from '../api'
import { HeadphonesIcon, MicIcon, WarnIcon } from '../icons'
import {
  channelWarning,
  displayName,
  freeKeys,
  hasPtt,
  membershipOn,
  talkingOn,
  type ChannelInfo,
  type Person,
  type PlanModel,
  type Selection,
} from '../plan'
import type { Role } from '../types'
import type { SetRole } from './CommsPlan'
import InlineName from './InlineName'

interface Props {
  model: PlanModel
  selection: Selection
  onSelect: (s: Selection) => void
  setRole: SetRole
  run: Run
}

/** What is being dragged: a person from the People list (from = null) or a chip from a channel. */
interface Dragged {
  person: Person
  from: number | null
}
/** Where it would land: a channel's talk or listen zone, or the People list (take off the channel). */
type Zone = { channelId: number; role: Role } | 'people'
interface Verdict {
  ok: boolean
  reason?: string
}

const ROLE_LABEL: Record<Role, string> = { talk: 'Talk & listen', listen: 'Listen only' }
const zoneKey = (z: Zone) => (z === 'people' ? 'people' : `${z.channelId}:${z.role}`)

function RoleIcon({ role, size, muted }: { role: Role; size?: number; muted?: boolean }) {
  return role === 'talk' ? <MicIcon size={size} muted={muted} /> : <HeadphonesIcon size={size} />
}

function verdict(d: Dragged, z: Zone, copy: boolean): Verdict | null {
  if (z === 'people') return d.from == null ? null : { ok: true } // a person dragged out of People isn't a drop here
  const moving = d.from != null && d.from !== z.channelId && !copy
  if (moving || membershipOn(d.person, z.channelId) || freeKeys(d.person) > 0) return { ok: true }
  return { ok: false, reason: `${displayName(d.person.device)} has no free keys` }
}

interface ChipProps {
  person: Person
  ch: ChannelInfo
  role: Role
  model: PlanModel
  selected: boolean
  onSelect: (s: Selection) => void
  setRole: SetRole
  onDragStart: (e: DragEvent) => void
  onDragEnd: () => void
}

function Chip({ person, ch, role, model, selected, onSelect, setRole, onDragStart, onDragEnd }: ChipProps) {
  const m = membershipOn(person, ch.channel.id)
  const name = displayName(person.device)
  const other: Role = role === 'talk' ? 'listen' : 'talk'
  const notes = [
    person.device.muted && 'muted by admin',
    person.device.disabled && 'disabled',
    !person.device.online && 'offline',
  ].filter(Boolean)
  const cls = ['chip', talkingOn(model, person, ch.channel.id) && 'talking', selected && 'selected']
  if (!person.device.online) cls.push('offline')
  return (
    <div
      className={cls.filter(Boolean).join(' ')}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={() => onSelect({ kind: 'person', id: person.id })}
      title={`${name}: ${ROLE_LABEL[role].toLowerCase()} on key ${m?.key}${notes.length ? ` (${notes.join(', ')})` : ''}\nDrag to move to another channel, Ctrl+drag to add`}
    >
      <RoleIcon role={role} muted={person.device.muted} />
      <span className="chip-name">{name}</span>
      {hasPtt(person, ch.channel.id) && (
        <span className="ptt-badge" title="Headset PTT talks here">
          PTT
        </span>
      )}
      <span className="key-badge" title={`On key ${m?.key}`}>
        {m?.key}
      </span>
      <span className="chip-actions">
        <button
          type="button"
          className="icon-btn"
          title={role === 'talk' ? `Make ${name} listen only` : `Let ${name} talk`}
          onClick={(e) => {
            e.stopPropagation()
            void setRole(person.id, ch.channel.id, other)
          }}
        >
          <RoleIcon role={other} size={12} />
        </button>
        <button
          type="button"
          className="icon-btn"
          title={`Take ${name} off ${ch.channel.name}`}
          onClick={(e) => {
            e.stopPropagation()
            void setRole(person.id, ch.channel.id, 'none')
          }}
        >
          ×
        </button>
      </span>
    </div>
  )
}

function AddSelect({ model, ch, role, setRole }: { model: PlanModel; ch: ChannelInfo; role: Role; setRole: SetRole }) {
  const options = model.people.filter((p) => membershipOn(p, ch.channel.id)?.role !== role)
  if (options.length === 0) return null
  return (
    <select
      className="add-select"
      value=""
      aria-label={`Add someone to ${ch.channel.name}: ${ROLE_LABEL[role].toLowerCase()}`}
      onChange={(e) => {
        if (e.target.value) void setRole(e.target.value, ch.channel.id, role)
      }}
    >
      <option value="">+ Add…</option>
      {options.map((p) => {
        const m = membershipOn(p, ch.channel.id)
        const full = !m && freeKeys(p) === 0
        return (
          <option key={p.id} value={p.id} disabled={full}>
            {displayName(p.device)}
            {m ? ` (now ${ROLE_LABEL[m.role].toLowerCase()})` : full ? ' (no free keys)' : ''}
          </option>
        )
      })}
    </select>
  )
}

export default function PlanBoard({ model, selection, onSelect, setRole, run }: Props) {
  const dragged = useRef<Dragged | null>(null)
  const [over, setOver] = useState<{ key: string; verdict: Verdict } | null>(null)
  const [newChannel, setNewChannel] = useState('')

  const startDrag = (e: DragEvent, d: Dragged) => {
    dragged.current = d
    e.dataTransfer.effectAllowed = 'copyMove'
    e.dataTransfer.setData('text/plain', d.person.id)
  }
  const endDrag = () => {
    dragged.current = null
    setOver(null)
  }

  const drop = (d: Dragged, z: Zone, copy: boolean) => {
    if (z === 'people') {
      if (d.from != null) void setRole(d.person.id, d.from, 'none')
      return
    }
    if (d.from != null && d.from !== z.channelId && !copy) {
      void setRole(d.person.id, z.channelId, z.role, d.from)
    } else if (membershipOn(d.person, z.channelId)?.role !== z.role) {
      void setRole(d.person.id, z.channelId, z.role)
    }
  }

  const dropTarget = (z: Zone) => ({
    onDragOver: (e: DragEvent) => {
      const d = dragged.current
      if (!d) return
      const copy = e.ctrlKey || e.metaKey
      const v = verdict(d, z, copy)
      if (!v) return
      if (v.ok) {
        e.preventDefault()
        e.dataTransfer.dropEffect = copy && d.from != null ? 'copy' : 'move'
      }
      const key = zoneKey(z)
      if (over?.key !== key || over.verdict.ok !== v.ok) setOver({ key, verdict: v })
    },
    onDragLeave: (e: DragEvent) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
      setOver((o) => (o?.key === zoneKey(z) ? null : o))
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault()
      const d = dragged.current
      const copy = e.ctrlKey || e.metaKey
      endDrag()
      if (d && verdict(d, z, copy)?.ok) drop(d, z, copy)
    },
  })
  const overClass = (z: Zone) => (over?.key === zoneKey(z) ? (over.verdict.ok ? 'drop-ok' : 'drop-no') : '')

  const selectedPerson = selection?.kind === 'person' ? selection.id : null
  const selectedChannel = selection?.kind === 'channel' ? selection.id : null
  const colorOf = (id: number) => model.channels.find((c) => c.channel.id === id)?.color
  const nameOf = (id: number) => model.channels.find((c) => c.channel.id === id)?.channel.name

  return (
    <>
      <p className="muted small hint">
        Drag people onto a channel: <MicIcon size={12} /> <b>Talk &amp; listen</b> or <HeadphonesIcon size={12} />{' '}
        <b>Listen only</b>. Drag a chip to move it (Ctrl+drag to add) or back to People to take it off. Click anyone to
        see who they hear.
      </p>
      <div className="board">
        <aside className={`people-panel ${overClass('people')}`} {...dropTarget('people')}>
          <div className="panel-title">
            People <span className="muted">{model.people.length}</span>
          </div>
          {model.people.map((p) => {
            const free = freeKeys(p)
            return (
              <div
                key={p.id}
                className={`person ${selectedPerson === p.id ? 'selected' : ''} ${p.device.online ? '' : 'offline'}`}
                draggable
                onDragStart={(e) => startDrag(e, { person: p, from: null })}
                onDragEnd={endDrag}
                onClick={() => onSelect({ kind: 'person', id: p.id })}
                title="Drag onto a channel"
              >
                <div className="person-name">
                  <span className={`dot ${p.device.online ? 'on' : ''}`} />
                  {displayName(p.device)}
                </div>
                {p.device.label && <div className="small muted">{p.device.label}</div>}
                <div className="person-meta">
                  {p.memberships.map((m) => (
                    <span
                      key={m.key}
                      className="mini"
                      style={{ background: colorOf(m.channelId) }}
                      title={`${nameOf(m.channelId)}: ${ROLE_LABEL[m.role].toLowerCase()} (key ${m.key})`}
                    >
                      <RoleIcon role={m.role} size={10} />
                    </span>
                  ))}
                  <span className="muted small">
                    {free === 0 ? 'all keys used' : `${free} key${free === 1 ? '' : 's'} free`}
                  </span>
                </div>
              </div>
            )
          })}
          {over?.key === 'people' && over.verdict.ok && <div className="zone-hint">Drop to take off the channel</div>}
        </aside>

        {model.channels.map((ch) => {
          const warning = channelWarning(ch)
          return (
            <div
              key={ch.channel.id}
              className={`ch-col ${selectedChannel === ch.channel.id ? 'selected' : ''}`}
              style={{ '--ch': ch.color } as CSSProperties}
            >
              <header className="ch-head" onClick={() => onSelect({ kind: 'channel', id: ch.channel.id })}>
                <span className="swatch" />
                <span className="ch-name">
                  <InlineName
                    value={ch.channel.name}
                    onSave={(name) => void run(() => api.patch(`/channels/${ch.channel.id}`, { name }))}
                  />
                </span>
                <button
                  type="button"
                  className="icon-btn"
                  title={`Delete ${ch.channel.name}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (confirm(`Delete channel "${ch.channel.name}"? Everyone on it loses that key.`))
                      void run(() => api.del(`/channels/${ch.channel.id}`))
                  }}
                >
                  ×
                </button>
              </header>
              {warning && (
                <div className="ch-warning">
                  <WarnIcon size={12} /> {warning}
                </div>
              )}
              {(['talk', 'listen'] as const).map((role) => {
                const zone: Zone = { channelId: ch.channel.id, role }
                const people = role === 'talk' ? ch.talkers : ch.listeners
                const cls = overClass(zone)
                return (
                  <div key={role} className={`zone ${role} ${cls}`} {...dropTarget(zone)}>
                    <div className="zone-title">
                      <RoleIcon role={role} /> {ROLE_LABEL[role]} <span className="muted">{people.length}</span>
                    </div>
                    {people.map((p) => (
                      <Chip
                        key={p.id}
                        person={p}
                        ch={ch}
                        role={role}
                        model={model}
                        selected={selectedPerson === p.id}
                        onSelect={onSelect}
                        setRole={setRole}
                        onDragStart={(e) => startDrag(e, { person: p, from: ch.channel.id })}
                        onDragEnd={endDrag}
                      />
                    ))}
                    {people.length === 0 && <div className="zone-empty">Drop people here</div>}
                    {cls === 'drop-no' && over?.verdict.reason && <div className="zone-reason">{over.verdict.reason}</div>}
                    <AddSelect model={model} ch={ch} role={role} setRole={setRole} />
                  </div>
                )
              })}
            </div>
          )
        })}

        <form
          className="ch-col ch-add"
          onSubmit={(e) => {
            e.preventDefault()
            const name = newChannel.trim()
            void run(() => api.post(`/events/${model.event.id}/channels`, { name })).then((ok) => {
              if (ok) setNewChannel('')
            })
          }}
        >
          <div className="ch-head muted">New channel</div>
          <input placeholder="e.g. Strategy" value={newChannel} onChange={(e) => setNewChannel(e.target.value)} />
          <button type="submit" disabled={!newChannel.trim()}>
            Add channel
          </button>
        </form>
      </div>
    </>
  )
}
