// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState } from 'react'
import { api, type Run } from '../api'
import { channelColor } from '../plan'
import type { Channel, OcEvent } from '../types'
import InlineName from './InlineName'

interface Props {
  events: OcEvent[]
  onPlan: (eventId: number) => void
  run: Run
}

function ChannelRow({ ch, event, run }: { ch: Channel; event: OcEvent; run: Run }) {
  return (
    <li>
      <span className="swatch" style={{ background: channelColor(event, ch.id) }} />
      <InlineName value={ch.name} onSave={(name) => void run(() => api.patch(`/channels/${ch.id}`, { name }))} />
      <span className="spacer" />
      {event.active && (
        <button
          title="Alert everyone with this channel on a key"
          onClick={() => void run(() => api.post(`/channels/${ch.id}/call`))}
        >
          Call
        </button>
      )}
      <button
        className="danger ghost"
        onClick={() => {
          if (confirm(`Delete channel "${ch.name}"? Keys assigned to it become unassigned.`))
            void run(() => api.del(`/channels/${ch.id}`))
        }}
      >
        Delete
      </button>
    </li>
  )
}

function EventCard({ event, onPlan, run }: { event: OcEvent; onPlan: (eventId: number) => void; run: Run }) {
  const [newChannel, setNewChannel] = useState('')
  return (
    <section className={`card event ${event.active ? 'active' : ''}`}>
      <header>
        <h3>
          <InlineName value={event.name} onSave={(name) => void run(() => api.patch(`/events/${event.id}`, { name }))} />
        </h3>
        <button onClick={() => onPlan(event.id)} title="Who is on which channel, and who can talk">
          Comms plan
        </button>
        {event.active ? (
          <span className="badge ok">Active</span>
        ) : (
          <>
            <button
              onClick={() => {
                if (confirm(`Activate "${event.name}"? All devices switch to its channels and key mappings.`))
                  void run(() => api.post(`/events/${event.id}/activate`))
              }}
            >
              Activate
            </button>
            <button
              className="danger ghost"
              onClick={() => {
                if (confirm(`Delete event "${event.name}" and its channels?`)) void run(() => api.del(`/events/${event.id}`))
              }}
            >
              Delete
            </button>
          </>
        )}
      </header>
      <ul className="channels">
        {event.channels.map((c) => (
          <ChannelRow key={c.id} ch={c} event={event} run={run} />
        ))}
      </ul>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault()
          void run(() => api.post(`/events/${event.id}/channels`, { name: newChannel.trim() })).then((ok) => {
            if (ok) setNewChannel('')
          })
        }}
      >
        <input placeholder="New channel name" value={newChannel} onChange={(e) => setNewChannel(e.target.value)} />
        <button type="submit" disabled={!newChannel.trim()}>
          Add channel
        </button>
      </form>
    </section>
  )
}

export default function EventsView({ events, onPlan, run }: Props) {
  const [name, setName] = useState('')
  const [copy, setCopy] = useState(true)
  const active = events.find((e) => e.active)
  return (
    <>
      <div className="events-grid">
        {events.map((e) => (
          <EventCard key={e.id} event={e} onPlan={onPlan} run={run} />
        ))}
      </div>
      <section className="card">
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault()
            const body = { name: name.trim(), copy_from_event_id: copy && active ? active.id : null }
            void run(() => api.post('/events', body)).then((ok) => {
              if (ok) setName('')
            })
          }}
        >
          <input placeholder="New event name, e.g. Bathurst 1000" value={name} onChange={(e) => setName(e.target.value)} />
          {active && (
            <label className="check inline">
              <input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} />
              Copy channels &amp; comms plan from {active.name}
            </label>
          )}
          <button type="submit" disabled={!name.trim()}>
            Create event
          </button>
        </form>
        <p className="muted small">
          Each event has its own channels and comms plan. Plans for inactive events are drafts; activating an event pushes
          its plan to every device.
        </p>
      </section>
    </>
  )
}
