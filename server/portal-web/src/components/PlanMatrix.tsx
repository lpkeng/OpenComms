// SPDX-License-Identifier: AGPL-3.0-or-later
import type { CSSProperties } from 'react'
import { HeadphonesIcon, MicIcon, WarnIcon } from '../icons'
import {
  channelWarning,
  displayName,
  freeKeys,
  headsetPtt,
  membershipOn,
  talkingOn,
  type PlanModel,
  type Selection,
} from '../plan'
import type { Role } from '../types'
import type { SetRole } from './CommsPlan'
import PttBadge from './PttBadge'

interface Props {
  model: PlanModel
  selection: Selection
  onSelect: (s: Selection) => void
  setRole: SetRole
}

// Explicit choices rather than click-to-cycle: on the active event every click is pushed to the beltpacks.
const CHOICES: { role: Role | 'none'; label: string }[] = [
  { role: 'none', label: 'Not on this channel' },
  { role: 'listen', label: 'Listen only' },
  { role: 'talk', label: 'Talk & listen' },
]

export default function PlanMatrix({ model, selection, onSelect, setRole }: Props) {
  const selectedPerson = selection?.kind === 'person' ? selection.id : null
  const selectedChannel = selection?.kind === 'channel' ? selection.id : null
  return (
    <>
      <p className="muted small hint">
        One row per person, one column per channel. Hover a cell and choose: <b>–</b> not on it,{' '}
        <HeadphonesIcon size={12} /> listen only, or <MicIcon size={12} /> talk &amp; listen.
      </p>
      <div className="matrix-wrap">
        <table className="matrix">
          <thead>
            <tr>
              <th className="corner">Person</th>
              {model.channels.map((ch) => {
                const warning = channelWarning(ch)
                return (
                  <th
                    key={ch.channel.id}
                    className={selectedChannel === ch.channel.id ? 'selected' : ''}
                    style={{ '--ch': ch.color } as CSSProperties}
                  >
                    <button className="ch-button" onClick={() => onSelect({ kind: 'channel', id: ch.channel.id })}>
                      <span className="swatch" /> {ch.channel.name}
                    </button>
                    <div className="small muted">
                      {ch.talkers.length} talk · {ch.listeners.length} listen
                    </div>
                    {warning && (
                      <div className="small warn-text">
                        <WarnIcon size={12} /> {warning}
                      </div>
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {model.people.map((p) => {
              const free = freeKeys(p)
              const name = displayName(p.device)
              const ptt = headsetPtt(model, p)
              return (
                <tr key={p.id} className={selectedPerson === p.id ? 'selected' : ''}>
                  <th scope="row">
                    <button className="person-button" onClick={() => onSelect({ kind: 'person', id: p.id })}>
                      <span className={`dot ${p.device.online ? 'on' : ''}`} /> {name}
                    </button>
                    {p.device.label && <div className="small muted">{p.device.label}</div>}
                    <div className="small muted">
                      {free === 0 ? `All ${p.entry.keys.length} keys used` : `${free} of ${p.entry.keys.length} keys free`}
                    </div>
                  </th>
                  {model.channels.map((ch) => {
                    const m = membershipOn(p, ch.channel.id)
                    const role = m?.role ?? 'none'
                    const full = !m && free === 0
                    const cls = ['cell', role, talkingOn(model, p, ch.channel.id) && 'talking']
                    if (selectedChannel === ch.channel.id) cls.push('col-selected')
                    return (
                      <td
                        key={ch.channel.id}
                        className={cls.filter(Boolean).join(' ')}
                        style={{ '--ch': ch.color } as CSSProperties}
                      >
                        <div className="seg" role="group" aria-label={`${name} on ${ch.channel.name}`}>
                          {CHOICES.map((c) => (
                            <button
                              key={c.role}
                              className={`${c.role} ${role === c.role ? 'on' : ''}`}
                              aria-pressed={role === c.role}
                              disabled={full && c.role !== 'none'}
                              title={full && c.role !== 'none' ? `${name} has no free keys` : c.label}
                              onClick={() => {
                                if (role !== c.role) void setRole(p.id, ch.channel.id, c.role)
                              }}
                            >
                              {c.role === 'talk' ? (
                                <MicIcon muted={p.device.muted} />
                              ) : c.role === 'listen' ? (
                                <HeadphonesIcon />
                              ) : (
                                '–'
                              )}
                            </button>
                          ))}
                        </div>
                        {m && (
                          <div className="cell-meta">
                            Key {m.key}
                            {ptt.channelId === ch.channel.id && <PttBadge model={model} ptt={ptt} />}
                          </div>
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
