// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState } from 'react'
import { api, type Run } from '../api'
import { HeadphonesIcon, MicIcon } from '../icons'
import { channelColor } from '../plan'
import type { Command, Device, Discovered, OcEvent } from '../types'

interface Props {
  devices: Device[]
  discovered: Discovered[]
  activeEvent: OcEvent | null
  onEdit: (id: string) => void
  run: Run
}

function signalBars(dbm: number): number {
  if (dbm >= -75) return 4
  if (dbm >= -85) return 3
  if (dbm >= -95) return 2
  if (dbm >= -105) return 1
  return 0
}

function Battery({ pct, charging }: { pct: number; charging: boolean }) {
  const level = pct > 50 ? 'ok' : pct > 20 ? 'warn' : 'bad'
  return (
    <span className="battery" title={`${pct}%${charging ? ' (charging)' : ''}`}>
      <span className="battery-body">
        <span className={`battery-fill ${level}`} style={{ width: `${pct}%` }} />
      </span>
      {pct}%{charging && ' ⚡'}
    </span>
  )
}

function Signal({ dbm }: { dbm: number }) {
  const bars = signalBars(dbm)
  return (
    <span className="signal" title={`${dbm} dBm`}>
      {[1, 2, 3, 4].map((b) => (
        <span key={b} className={b <= bars ? 'on' : ''} style={{ height: `${b * 3 + 2}px` }} />
      ))}
      <span className="muted small">{dbm}</span>
    </span>
  )
}

function KeyChips({ device, activeEvent }: { device: Device; activeEvent: OcEvent | null }) {
  const names = new Map(activeEvent?.channels.map((c) => [c.id, c.name]))
  const talk = new Set(device.state?.talk ?? [])
  const listen = new Set(device.state?.listen ?? [])
  return (
    <div className="keys">
      {(device.config?.keys ?? []).map((k) => {
        const name = k.channel_id != null ? names.get(k.channel_id) : undefined
        const live = device.online ? (talk.has(k.key) ? 'talk' : listen.has(k.key) ? 'listen' : '') : ''
        const color = name ? channelColor(activeEvent, k.channel_id) : undefined
        return (
          <span
            key={k.key}
            className={`key ${live} ${name ? '' : 'unassigned'} ${k.mode === 'off' ? 'off' : ''}`}
            style={color ? { borderLeftColor: color } : undefined}
            title={`Key ${k.key}: ${name ?? 'unassigned'} (${k.mode.replace('_', ' ')}, vol ${k.volume})`}
          >
            <b>{k.key}</b>{' '}
            {name && k.mode === 'listen_only' && <HeadphonesIcon size={11} />}
            {name && (k.mode === 'latch' || k.mode === 'momentary') && <MicIcon size={11} />} {name ?? '—'}
          </span>
        )
      })}
    </div>
  )
}

function ClaimPanel({ discovered, run }: { discovered: Discovered[]; run: Run }) {
  const [codes, setCodes] = useState<Record<string, string>>({})
  const [manualId, setManualId] = useState('')
  const [manualCode, setManualCode] = useState('')

  const claim = (id: string, code: string) =>
    run(() => api.post('/devices/claim', { id: id.trim(), claim_code: code.trim() }))

  return (
    <section className="card">
      <h3>Add devices</h3>
      <p className="muted small">
        Enter the claim code from the device's label or QR code. In production the portal scans the QR code.
      </p>
      {discovered.length > 0 && (
        <table className="compact">
          <tbody>
            {discovered.map((d) => (
              <tr key={d.id}>
                <td>
                  <span className={`dot ${d.online ? 'on' : ''}`} /> <code>{d.id}</code>
                </td>
                <td className="muted small">
                  {d.kind}
                  {!d.provisioned && ' · not provisioned'}
                </td>
                <td>
                  <input
                    placeholder="Claim code"
                    value={codes[d.id] ?? ''}
                    onChange={(e) => setCodes({ ...codes, [d.id]: e.target.value })}
                  />
                </td>
                <td>
                  <button disabled={!codes[d.id]} onClick={() => void claim(d.id, codes[d.id] ?? '')}>
                    Claim
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault()
          void claim(manualId, manualCode).then((ok) => {
            if (ok) {
              setManualId('')
              setManualCode('')
            }
          })
        }}
      >
        <input placeholder="Device ID" value={manualId} onChange={(e) => setManualId(e.target.value)} />
        <input placeholder="Claim code" value={manualCode} onChange={(e) => setManualCode(e.target.value)} />
        <button type="submit" disabled={!manualId || !manualCode}>
          Claim by ID
        </button>
      </form>
    </section>
  )
}

export default function DevicesView({ devices, discovered, activeEvent, onEdit, run }: Props) {
  const cmd = (id: string, c: Command) => run(() => api.post(`/devices/${id}/cmd`, { cmd: c }))
  const admin = (id: string, body: { muted?: boolean; disabled?: boolean }) =>
    run(() => api.post(`/devices/${id}/admin`, body))

  return (
    <>
      <section className="card">
        <table className="devices">
          <thead>
            <tr>
              <th>Status</th>
              <th>Device</th>
              <th>Keys {activeEvent && <span className="muted small">({activeEvent.name})</span>}</th>
              <th>Battery</th>
              <th>Signal</th>
              <th>Config</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {devices.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  No devices yet. Claim one below, or run the device simulator.
                </td>
              </tr>
            )}
            {devices.map((d) => {
              const s = d.state
              return (
                <tr key={d.id} className={d.online ? '' : 'offline'}>
                  <td>
                    <span className={`dot ${d.online ? 'on' : ''}`} /> {d.online ? 'Online' : 'Offline'}
                    <div className="badges">
                      {d.muted && <span className="badge warn">Muted</span>}
                      {d.disabled && <span className="badge bad">Disabled</span>}
                      {d.online && s?.alert && <span className="badge call">Call</span>}
                      {d.online && s?.identify && <span className="badge info">Identify</span>}
                    </div>
                  </td>
                  <td>
                    <div className="name">{d.name || d.id}</div>
                    {d.label && <div className="small">{d.label}</div>}
                    <div className="muted small">
                      <code>{d.id}</code>
                      {s && ` · ${s.fw}`}
                    </div>
                  </td>
                  <td>
                    <KeyChips device={d} activeEvent={activeEvent} />
                  </td>
                  <td>{s ? <Battery pct={s.battery_pct} charging={s.charging} /> : '—'}</td>
                  <td>
                    {s ? (
                      <>
                        <Signal dbm={s.rssi_dbm} /> <span className="muted small">{s.net.toUpperCase()}</span>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    {d.in_sync ? (
                      <span className="ok-text">✓ In sync</span>
                    ) : (
                      <span className="warn-text" title="Waiting for the device to apply the latest config">
                        Pending v{d.applied_version ?? '–'} → v{d.config_version}
                      </span>
                    )}
                  </td>
                  <td className="actions">
                    <button onClick={() => onEdit(d.id)}>Edit</button>
                    <button onClick={() => void cmd(d.id, 'call')} disabled={!d.online}>
                      Call
                    </button>
                    <button onClick={() => void cmd(d.id, 'identify')} disabled={!d.online}>
                      Identify
                    </button>
                    <button onClick={() => void admin(d.id, { muted: !d.muted })}>
                      {d.muted ? 'Unmute' : 'Mute'}
                    </button>
                    <button
                      className={d.disabled ? '' : 'danger'}
                      onClick={() => {
                        if (d.disabled || confirm(`Disable ${d.name || d.id}? The user won't be able to talk or listen.`))
                          void admin(d.id, { disabled: !d.disabled })
                      }}
                    >
                      {d.disabled ? 'Enable' : 'Disable'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>
      <ClaimPanel discovered={discovered} run={run} />
    </>
  )
}
