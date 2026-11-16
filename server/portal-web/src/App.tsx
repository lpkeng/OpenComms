// SPDX-License-Identifier: AGPL-3.0-or-later
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, useLiveSocket, type Run } from './api'
import type { Device, Discovered, OcEvent, Org, WsMessage } from './types'
import CommsPlan from './components/CommsPlan'
import DevicesView from './components/DevicesView'
import DeviceEditor from './components/DeviceEditor'
import EventsView from './components/EventsView'
import MapView from './components/MapView'

type Tab = 'devices' | 'plan' | 'events' | 'map'
const TABS: { id: Tab; label: string }[] = [
  { id: 'devices', label: 'Devices' },
  { id: 'plan', label: 'Comms plan' },
  { id: 'events', label: 'Events & channels' },
  { id: 'map', label: 'Map' },
]

function tabFromHash(): Tab {
  const h = location.hash.slice(1)
  return TABS.some((t) => t.id === h) ? (h as Tab) : 'devices'
}

export default function App() {
  const [org, setOrg] = useState<Org | null>(null)
  const [events, setEvents] = useState<OcEvent[]>([])
  const [devices, setDevices] = useState<Device[]>([])
  const [discovered, setDiscovered] = useState<Discovered[]>([])
  const [tab, setTab] = useState<Tab>(tabFromHash)
  const [planEventId, setPlanEventId] = useState<number | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [editing, setEditing] = useState<{ deviceId: string; eventId: number | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const known = useRef(new Set<string>())

  useEffect(() => {
    const onHash = () => setTab(tabFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const reload = useCallback(async () => {
    try {
      const [o, e, d, disc] = await Promise.all([
        api.get<Org>('/org'),
        api.get<OcEvent[]>('/events'),
        api.get<Device[]>('/devices'),
        api.get<Discovered[]>('/devices/discovered'),
      ])
      setOrg(o)
      setEvents(e)
      setDevices(d)
      setDiscovered(disc)
      setRefreshKey((k) => k + 1)
      known.current = new Set([...d.map((x) => x.id), ...disc.map((x) => x.id)])
      setConnected(true)
    } catch (err) {
      setConnected(false)
      setError(`Can't reach the portal API: ${(err as Error).message}`)
    }
  }, [])

  const onLive = useCallback(
    (msg: WsMessage) => {
      if (msg.type === 'changed') {
        void reload()
        return
      }
      const { id, live } = msg
      if (!known.current.has(id)) {
        known.current.add(id)
        void reload()
        return
      }
      setDevices((prev) =>
        prev.map((d) => {
          if (d.id !== id) return d
          const applied = live.state?.config_version ?? d.applied_version
          return { ...d, ...live, applied_version: applied, in_sync: applied === d.config_version }
        }),
      )
      setDiscovered((prev) => prev.map((d) => (d.id === id ? { ...d, online: live.online } : d)))
    },
    [reload],
  )
  // Data is (re)loaded whenever the live socket connects.
  useLiveSocket(onLive, reload)

  // Wraps an action and shows API errors; live updates refresh the data.
  const run = useCallback<Run>(async (fn) => {
    setError(null)
    try {
      await fn()
      return true
    } catch (err) {
      setError((err as Error).message)
      return false
    }
  }, [])

  const activeEvent = events.find((e) => e.active) ?? null
  const planEvent = events.find((e) => e.id === planEventId) ?? activeEvent
  const online = devices.filter((d) => d.online).length
  const openPlan = (eventId: number) => {
    setPlanEventId(eventId)
    location.hash = 'plan'
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">◉</span> OpenComms <span className="muted">Portal</span>
        </div>
        <div className="org">{org?.name}</div>
        <label className="event-switch">
          Active event
          <select
            value={activeEvent?.id ?? ''}
            onChange={(e) => {
              const ev = events.find((x) => x.id === Number(e.target.value))
              if (ev && confirm(`Switch all devices to "${ev.name}"? Their channels and keys will change.`)) {
                void run(() => api.post(`/events/${ev.id}/activate`))
              }
            }}
          >
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <div className={`conn ${connected ? 'ok' : 'bad'}`}>
          {connected ? `${online}/${devices.length} online` : 'API offline'}
        </div>
      </header>

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? 'active' : ''}
            onClick={() => {
              location.hash = t.id
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {error && (
        <div className="error" onClick={() => setError(null)}>
          {error} <span className="muted">(click to dismiss)</span>
        </div>
      )}

      <main>
        {tab === 'devices' && (
          <DevicesView
            devices={devices}
            discovered={discovered}
            activeEvent={activeEvent}
            onEdit={(deviceId) => setEditing({ deviceId, eventId: activeEvent?.id ?? null })}
            run={run}
          />
        )}
        {tab === 'plan' && (
          <CommsPlan
            events={events}
            devices={devices}
            eventId={planEvent?.id ?? null}
            onEventChange={setPlanEventId}
            refreshKey={refreshKey}
            onEdit={(deviceId, eventId) => setEditing({ deviceId, eventId })}
            run={run}
          />
        )}
        {tab === 'events' && <EventsView events={events} onPlan={openPlan} run={run} />}
        {tab === 'map' && <MapView devices={devices} />}
      </main>

      {editing && (
        <DeviceEditor
          deviceId={editing.deviceId}
          event={events.find((e) => e.id === editing.eventId) ?? null}
          onClose={() => setEditing(null)}
          run={run}
        />
      )}
    </div>
  )
}
