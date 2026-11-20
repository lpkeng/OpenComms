// SPDX-License-Identifier: AGPL-3.0-or-later
import type { CSSProperties, ReactNode } from 'react'
import { HeadphonesIcon, MicIcon, WarnIcon } from '../icons'
import {
  canTalk,
  channelWarning,
  displayName,
  headsetPtt,
  heardBy,
  hears,
  membershipOn,
  type ChannelInfo,
  type Person,
  type PlanModel,
  type Selection,
} from '../plan'
import type { KeyMode } from '../types'
import PttBadge from './PttBadge'

interface Props {
  model: PlanModel
  selection: Selection
  onSelect: (s: Selection) => void
  onEdit: (deviceId: string) => void
  onResetPtt: (deviceId: string) => void
}

type Select = (s: Selection) => void

const MODE_TEXT: Record<KeyMode, string> = {
  talk: 'talk & listen (hold to talk)',
  listen_only: 'listen only',
}

/** "A", "A and B", "A, B and C". */
function joinList(items: ReactNode[]): ReactNode {
  return items.map((item, i) => (
    <span key={i}>
      {i > 0 && (i === items.length - 1 ? ' and ' : ', ')}
      {item}
    </span>
  ))
}

function PersonLink({ p, onSelect }: { p: Person; onSelect: Select }) {
  return (
    <button className="link" onClick={() => onSelect({ kind: 'person', id: p.id })}>
      {displayName(p.device)}
    </button>
  )
}

function ChannelTag({ ch, onSelect }: { ch: ChannelInfo; onSelect: Select }) {
  return (
    <button
      className="ch-tag"
      style={{ '--ch': ch.color } as CSSProperties}
      onClick={() => onSelect({ kind: 'channel', id: ch.channel.id })}
    >
      <span className="swatch" />
      {ch.channel.name}
    </button>
  )
}

interface PersonSummaryProps {
  p: Person
  model: PlanModel
  onSelect: Select
  onEdit: () => void
  onResetPtt: () => void
}

function PersonSummary({ p, model, onSelect, onEdit, onResetPtt }: PersonSummaryProps) {
  const d = p.device
  const name = displayName(d)
  const channel = (id: number | null) => model.channels.find((c) => c.channel.id === id)
  const people = (list: Person[]) => joinList(list.map((q) => <PersonLink key={q.id} p={q} onSelect={onSelect} />))
  const tag = (ch: ChannelInfo) => <ChannelTag key={ch.channel.id} ch={ch} onSelect={onSelect} />
  const heard = hears(model, p)
  const heardByList = heardBy(model, p)
  const talksSomewhere = p.memberships.some((m) => m.role === 'talk')
  const listenOnly = p.memberships.filter((m) => m.role === 'listen').flatMap((m) => channel(m.channelId) ?? [])
  const ptt = headsetPtt(model, p)
  const pttChannel = channel(ptt.channelId)
  const plannedPtt = channel(ptt.planned)
  const call = channel(p.entry.call_channel_id)

  return (
    <>
      <h3>{name}</h3>
      <div className="muted small">
        {d.label && `${d.label} · `}
        <code>{d.id}</code> · {d.online ? 'online' : 'offline'}
      </div>
      {d.disabled && <p className="note bad">Disabled by an admin, so can't talk or listen.</p>}
      {d.muted && !d.disabled && <p className="note warn">Muted by an admin, so nobody hears them until unmuted.</p>}

      <h4>
        <HeadphonesIcon /> Hears
      </h4>
      {heard.length === 0 ? (
        <p className="muted">{d.disabled ? 'Nothing while disabled.' : `Nothing. ${name} isn't on any channel.`}</p>
      ) : (
        <ul className="sum-list">
          {heard.map(({ ch, from }) => (
            <li key={ch.channel.id}>
              {tag(ch)} {from.length ? <>from {people(from)}</> : <span className="muted">nobody can talk here</span>}
            </li>
          ))}
        </ul>
      )}

      <h4>
        <MicIcon /> Is heard by
      </h4>
      {heardByList.length === 0 ? (
        <p className="muted">
          {talksSomewhere ? `Nobody while ${d.disabled ? 'disabled' : 'muted'}.` : `Nobody. ${name} can only listen.`}
        </p>
      ) : (
        <ul className="sum-list">
          {heardByList.map(({ ch, by }) => (
            <li key={ch.channel.id}>
              {tag(ch)} → {by.length ? people(by) : <span className="muted">nobody else is on it</span>}
              {ptt.channelId === ch.channel.id && <PttBadge model={model} ptt={ptt} />}
            </li>
          ))}
        </ul>
      )}
      {listenOnly.length > 0 && (
        <p className="small">
          <b>Listen only</b> on {joinList(listenOnly.map(tag))}: hears it but can't talk there.
        </p>
      )}

      <h4>Keys</h4>
      <ul className="sum-list">
        {p.entry.keys.map((k) => {
          const ch = channel(k.channel_id)
          return (
            <li key={k.key}>
              <span className="key-badge">{k.key}</span>{' '}
              {ch ? (
                <>
                  {tag(ch)} <span className="muted small">{MODE_TEXT[k.mode]}</span>
                </>
              ) : (
                <span className="muted">free</span>
              )}
            </li>
          )
        })}
      </ul>
      <p className="small">
        Headset PTT talks on: {pttChannel ? tag(pttChannel) : <span className="muted">nothing</span>}
        <br />
        Call button alerts: {call ? tag(call) : <span className="muted">nobody</span>}
      </p>
      {ptt.remapped && (
        <div className="note info">
          <span>
            {name} remapped their headset PTT on the beltpack (plan: {plannedPtt ? tag(plannedPtt) : 'nothing'}). It
            stays until you change their PTT here or reset it.
          </span>
          <button onClick={onResetPtt}>Reset to plan</button>
        </div>
      )}
      <button onClick={onEdit}>Edit keys &amp; audio…</button>
    </>
  )
}

function ChannelSummary({ ch, model, onSelect }: { ch: ChannelInfo; model: PlanModel; onSelect: Select }) {
  const warning = channelWarning(ch)
  const link = (p: Person) => <PersonLink key={p.id} p={p} onSelect={onSelect} />
  const talkers = joinList(ch.talkers.map(link))
  const listeners = joinList(ch.listeners.map(link))
  const others = model.people.filter((p) => !membershipOn(p, ch.channel.id))
  const row = (p: Person) => {
    const m = membershipOn(p, ch.channel.id)!
    const notes = [`key ${m.key}`]
    const ptt = headsetPtt(model, p)
    if (ptt.channelId === ch.channel.id) notes.push(ptt.remapped ? 'headset PTT (remapped on the beltpack)' : 'headset PTT')
    if (m.role === 'talk' && !canTalk(p)) notes.push(p.device.disabled ? 'disabled' : 'muted')
    else if (p.device.disabled) notes.push('disabled')
    if (!p.device.online) notes.push('offline')
    return (
      <li key={p.id}>
        {link(p)} <span className="muted small">{notes.join(' · ')}</span>
      </li>
    )
  }
  return (
    <>
      <h3 className="ch-title" style={{ '--ch': ch.color } as CSSProperties}>
        <span className="swatch" /> {ch.channel.name}
      </h3>
      {warning && (
        <p className="note warn">
          <WarnIcon /> {warning}
        </p>
      )}
      <p>
        {ch.talkers.length >= 2 && <>{talkers} talk to each other. </>}
        {ch.talkers.length === 1 && <>{talkers} can talk here. </>}
        {ch.listeners.length > 0 && (
          <>
            {listeners} {ch.listeners.length === 1 ? 'listens' : 'listen'} in but can't talk.
          </>
        )}
      </p>
      <h4>
        <MicIcon /> Talk &amp; listen <span className="muted">({ch.talkers.length})</span>
      </h4>
      {ch.talkers.length ? <ul className="sum-list">{ch.talkers.map(row)}</ul> : <p className="muted">Nobody</p>}
      <h4>
        <HeadphonesIcon /> Listen only <span className="muted">({ch.listeners.length})</span>
      </h4>
      {ch.listeners.length ? <ul className="sum-list">{ch.listeners.map(row)}</ul> : <p className="muted">Nobody</p>}
      {others.length > 0 && (
        <p className="small muted">Can't hear this channel: {joinList(others.map(link))}</p>
      )}
    </>
  )
}

function Overview({ model, onSelect }: { model: PlanModel; onSelect: Select }) {
  const issues: ReactNode[] = [
    ...model.channels.flatMap((ch) => {
      const w = channelWarning(ch)
      return w ? [<>{<ChannelTag ch={ch} onSelect={onSelect} />}: {w.charAt(0).toLowerCase() + w.slice(1)}</>] : []
    }),
    ...model.people
      .filter((p) => p.memberships.length === 0)
      .map((p) => (
        <>
          <PersonLink p={p} onSelect={onSelect} /> isn't on any channel
        </>
      )),
    ...model.people
      .filter((p) => p.device.muted || p.device.disabled)
      .map((p) => (
        <>
          <PersonLink p={p} onSelect={onSelect} /> is {p.device.disabled ? 'disabled' : 'muted'} by an admin
        </>
      )),
    ...model.people
      .filter((p) => headsetPtt(model, p).remapped)
      .map((p) => (
        <>
          <PersonLink p={p} onSelect={onSelect} /> remapped their headset PTT on the beltpack
        </>
      )),
  ]
  const keys = model.people[0]?.entry.keys.length ?? 4
  return (
    <>
      <h3>Who hears what</h3>
      <p className="muted">Click a person or a channel in any view to see exactly who they hear and who hears them.</p>
      <ul className="sum-list">
        <li>
          <MicIcon /> <b>Talk &amp; listen</b>: can talk on the channel and hears everyone who talks on it.
        </li>
        <li>
          <HeadphonesIcon /> <b>Listen only</b>: hears the channel but can't talk on it.
        </li>
        <li>
          <span className="ptt-badge">PTT</span> The headset's push-to-talk button talks on this channel. Dashed means
          the wearer remapped it on the beltpack.
        </li>
        <li>Each beltpack has {keys} channel keys, so a person can be on up to {keys} channels.</li>
      </ul>
      <h4>Needs attention</h4>
      {issues.length ? (
        <ul className="sum-list">
          {issues.map((x, i) => (
            <li key={i}>
              <WarnIcon /> {x}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Nothing. Every channel has people talking and listening.</p>
      )}
    </>
  )
}

export default function PlanSummary({ model, selection, onSelect, onEdit, onResetPtt }: Props) {
  if (selection?.kind === 'person') {
    const p = model.people.find((x) => x.id === selection.id)
    if (p) {
      return (
        <PersonSummary
          p={p}
          model={model}
          onSelect={onSelect}
          onEdit={() => onEdit(p.id)}
          onResetPtt={() => onResetPtt(p.id)}
        />
      )
    }
  }
  if (selection?.kind === 'channel') {
    const ch = model.channels.find((c) => c.channel.id === selection.id)
    if (ch) return <ChannelSummary ch={ch} model={model} onSelect={onSelect} />
  }
  return <Overview model={model} onSelect={onSelect} />
}
