// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useMemo, useState } from 'react'
import { api, type Run } from '../api'
import { HeadphonesIcon, MicIcon } from '../icons'
import { buildModel, type Selection } from '../plan'
import type { Device, OcEvent, Plan, PlanEntry, Role } from '../types'
import PlanBoard from './PlanBoard'
import PlanFlow from './PlanFlow'
import PlanMatrix from './PlanMatrix'
import PlanSummary from './PlanSummary'

/** Puts a person on a channel (or takes them off with "none"). `moveFrom` moves them from another channel. */
export type SetRole = (deviceId: string, channelId: number, role: Role | 'none', moveFrom?: number) => Promise<boolean>

type View = 'board' | 'matrix' | 'flow'
const VIEWS: { id: View; label: string; hint: string }[] = [
  { id: 'board', label: 'Board', hint: 'Drag people onto channels' },
  { id: 'matrix', label: 'Matrix', hint: 'Everyone against every channel' },
  { id: 'flow', label: 'Audio flow', hint: 'Who is heard by whom' },
]
const VIEW_KEY = 'opencomms.planView'

function savedView(): View {
  const v = localStorage.getItem(VIEW_KEY)
  return VIEWS.some((x) => x.id === v) ? (v as View) : 'board'
}

const sameSelection = (a: Selection, b: Selection) => !!a && !!b && a.kind === b.kind && a.id === b.id

interface Props {
  events: OcEvent[]
  devices: Device[]
  eventId: number | null
  onEventChange: (eventId: number) => void
  refreshKey: number
  onEdit: (deviceId: string, eventId: number) => void
  run: Run
}

export default function CommsPlan({ events, devices, eventId, onEventChange, refreshKey, onEdit, run }: Props) {
  const [plan, setPlan] = useState<Plan | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [view, setView] = useState<View>(savedView)
  const [selection, setSelection] = useState<Selection>(null)

  useEffect(() => {
    if (eventId == null) return
    let stale = false
    api.get<Plan>(`/events/${eventId}/plan`).then(
      (p) => {
        if (stale) return
        setPlan(p)
        setLoadError(null)
      },
      (err: Error) => {
        if (!stale) setLoadError(err.message)
      },
    )
    return () => {
      stale = true
    }
  }, [eventId, refreshKey])

  const model = useMemo(
    () => (plan && plan.event.id === eventId ? buildModel(plan, devices) : null),
    [plan, devices, eventId],
  )
  const event = events.find((e) => e.id === eventId) ?? null

  const setRole: SetRole = (deviceId, channelId, role, moveFrom) =>
    run(async () => {
      const entry = await api.put<PlanEntry>(`/events/${eventId}/plan/${deviceId}/channels/${channelId}`, {
        role,
        move_from_channel_id: moveFrom ?? null,
      })
      setPlan((p) =>
        p && p.event.id === eventId
          ? { ...p, devices: p.devices.map((d) => (d.device_id === deviceId ? entry : d)) }
          : p,
      )
    })

  const onSelect = (s: Selection) => setSelection((cur) => (sameSelection(cur, s) ? null : s))

  if (events.length === 0) return <section className="card muted">No events yet. Create one under Events &amp; channels.</section>

  return (
    <div className="plan">
      <div className="plan-toolbar">
        <label className="inline">
          Event
          <select value={eventId ?? ''} onChange={(e) => onEventChange(Number(e.target.value))}>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
                {e.active ? ' (active)' : ''}
              </option>
            ))}
          </select>
        </label>
        <div className="segmented" role="tablist" aria-label="Comms plan view">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              role="tab"
              aria-selected={view === v.id}
              className={view === v.id ? 'on' : ''}
              title={v.hint}
              onClick={() => {
                setView(v.id)
                localStorage.setItem(VIEW_KEY, v.id)
              }}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="legend">
          <span>
            <MicIcon /> Talk &amp; listen
          </span>
          <span>
            <HeadphonesIcon /> Listen only
          </span>
          <span>
            <span className="ptt-badge">PTT</span> Headset PTT
          </span>
          <span>
            <span className="talking-swatch" /> Talking now
          </span>
        </div>
      </div>

      {event &&
        (event.active ? (
          <div className="plan-banner live">
            <span className="dot on" /> <b>Live.</b> {event.name} is the active event, so changes go to the beltpacks
            straight away.
          </div>
        ) : (
          <div className="plan-banner draft">
            <b>Draft.</b> {event.name} isn't active. Changes are saved and sent to the beltpacks when you activate it.
            <button
              onClick={() => {
                if (confirm(`Activate "${event.name}"? All devices switch to its channels and comms plan.`))
                  void run(() => api.post(`/events/${event.id}/activate`))
              }}
            >
              Activate now
            </button>
          </div>
        ))}

      {loadError && <div className="error">Couldn't load the comms plan: {loadError}</div>}

      {!model ? (
        <section className="card muted">Loading…</section>
      ) : (
        <div className="plan-layout">
          <section className="card plan-main">
            {model.people.length === 0 && (
              <p className="muted">No devices yet. Claim beltpacks on the Devices tab, then put them on channels here.</p>
            )}
            {view === 'board' && (
              <PlanBoard model={model} selection={selection} onSelect={onSelect} setRole={setRole} run={run} />
            )}
            {view === 'matrix' && (
              <PlanMatrix model={model} selection={selection} onSelect={onSelect} setRole={setRole} />
            )}
            {view === 'flow' && <PlanFlow model={model} selection={selection} onSelect={onSelect} />}
          </section>
          <aside className="card plan-aside">
            <PlanSummary
              model={model}
              selection={selection}
              onSelect={setSelection}
              onEdit={(deviceId) => onEdit(deviceId, model.event.id)}
            />
          </aside>
        </div>
      )}
    </div>
  )
}
