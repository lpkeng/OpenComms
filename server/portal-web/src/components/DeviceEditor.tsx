// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from 'react'
import { api, type Run } from '../api'
import { channelColor } from '../plan'
import type { Device, KeyConfig, KeyMode, OcEvent, Plan } from '../types'

interface Props {
  deviceId: string
  /** The event whose plan is edited: the active event (pushed live) or a draft. */
  event: OcEvent | null
  onClose: () => void
  run: Run
}

const MODES: { value: KeyMode; label: string }[] = [
  { value: 'latch', label: 'Talk & listen: latch (tap on/off, hold = momentary)' },
  { value: 'momentary', label: 'Talk & listen: momentary (hold to talk)' },
  { value: 'listen_only', label: 'Listen only' },
  { value: 'off', label: 'Off' },
]

const isTalk = (m: KeyMode) => m === 'latch' || m === 'momentary'

export default function DeviceEditor({ deviceId, event, onClose, run }: Props) {
  const [device, setDevice] = useState<Device | null>(null)
  const [name, setName] = useState('')
  const [label, setLabel] = useState('')
  const [keys, setKeys] = useState<KeyConfig[]>([])
  const [ptt, setPtt] = useState<number[]>([])
  const [callCh, setCallCh] = useState<number | null>(null)
  const [micGain, setMicGain] = useState(52)
  const [sidetone, setSidetone] = useState(20)
  const [saving, setSaving] = useState(false)
  const eventId = event?.id ?? null

  // Keyed on the event id (not the object) so live reloads don't overwrite unsaved edits.
  useEffect(() => {
    void run(async () => {
      const [d, plan] = await Promise.all([
        api.get<Device>(`/devices/${deviceId}`),
        eventId == null ? Promise.resolve(null) : api.get<Plan>(`/events/${eventId}/plan`),
      ])
      setDevice(d)
      setName(d.name)
      setLabel(d.label)
      const entry = plan?.devices.find((x) => x.device_id === deviceId)
      if (entry) {
        setKeys(entry.keys)
        setPtt(entry.ptt_channel_ids)
        setCallCh(entry.call_channel_id)
        setMicGain(entry.mic_gain_db)
        setSidetone(entry.sidetone)
      }
    })
  }, [deviceId, eventId, run])

  const channels = event?.channels ?? []
  const talkIds = keys.flatMap((k) => (k.channel_id != null && isTalk(k.mode) ? [k.channel_id] : []))
  const memberIds = keys.flatMap((k) => (k.channel_id != null && k.mode !== 'off' ? [k.channel_id] : []))
  const pttChannels = channels.filter((c) => talkIds.includes(c.id))
  const callChannels = channels.filter((c) => memberIds.includes(c.id))
  const callValue = callCh != null && memberIds.includes(callCh) ? callCh : null

  const setKey = (i: number, patch: Partial<KeyConfig>) =>
    setKeys(keys.map((k, j) => (j === i ? { ...k, ...patch } : k)))
  // A channel can only be on one key, so choosing one that's already on another key moves it here.
  const assign = (i: number, channelId: number | null) =>
    setKeys(
      keys.map((k, j) =>
        j === i ? { ...k, channel_id: channelId } : channelId != null && k.channel_id === channelId ? { ...k, channel_id: null } : k,
      ),
    )

  const save = async () => {
    if (!device || eventId == null) return
    setSaving(true)
    const ok = await run(() =>
      api.put(`/events/${eventId}/plan/${deviceId}`, {
        name,
        label,
        keys,
        ptt_channel_ids: ptt.filter((c) => talkIds.includes(c)),
        call_channel_id: callValue,
        mic_gain_db: micGain,
        sidetone,
      }),
    )
    setSaving(false)
    if (ok) onClose()
  }

  const unclaim = async () => {
    if (!confirm(`Remove ${device?.name || deviceId} from this organisation? Its config will be cleared.`)) return
    if (await run(() => api.del(`/devices/${deviceId}`))) onClose()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>
            Edit <code>{deviceId}</code>
          </h2>
          <button className="ghost" onClick={onClose}>
            ✕
          </button>
        </header>

        {!device ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            <div className="grid2">
              <label>
                Name
                <input value={name} maxLength={50} onChange={(e) => setName(e.target.value)} />
              </label>
              <label>
                User label
                <input
                  value={label}
                  maxLength={50}
                  placeholder="e.g. Crew Chief"
                  onChange={(e) => setLabel(e.target.value)}
                />
              </label>
            </div>

            <h3>
              Keys{' '}
              {event ? (
                <span className="muted small">
                  for {event.name}{' '}
                  {event.active ? (
                    <span className="badge ok">Live</span>
                  ) : (
                    <span className="badge info" title="Saved now, sent to the beltpack when the event is activated">
                      Draft
                    </span>
                  )}
                </span>
              ) : (
                <span className="muted small">(no active event)</span>
              )}
            </h3>
            <table className="compact keys-table">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Channel</th>
                  <th>Mode</th>
                  <th>Default volume</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k, i) => (
                  <tr key={k.key}>
                    <td>
                      <b>{k.key}</b>
                    </td>
                    <td>
                      <select
                        value={k.channel_id ?? ''}
                        style={{ borderLeft: `4px solid ${channelColor(event, k.channel_id) ?? 'transparent'}` }}
                        onChange={(e) => assign(i, e.target.value ? Number(e.target.value) : null)}
                      >
                        <option value="">— unassigned —</option>
                        {channels.map((c) => {
                          const elsewhere = keys.find((x, j) => j !== i && x.channel_id === c.id)
                          return (
                            <option key={c.id} value={c.id}>
                              {c.name}
                              {elsewhere ? ` (on key ${elsewhere.key}, moves here)` : ''}
                            </option>
                          )
                        })}
                      </select>
                    </td>
                    <td>
                      <select value={k.mode} onChange={(e) => setKey(i, { mode: e.target.value as KeyMode })}>
                        {MODES.map((m) => (
                          <option key={m.value} value={m.value}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="range">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={k.volume}
                        onChange={(e) => setKey(i, { volume: Number(e.target.value) })}
                      />
                      <span>{k.volume}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="grid2">
              <fieldset>
                <legend>Headset PTT talks on</legend>
                {pttChannels.length === 0 && (
                  <span className="muted small">Put a key on a talk &amp; listen channel first.</span>
                )}
                {pttChannels.map((c) => (
                  <label key={c.id} className="check">
                    <input
                      type="checkbox"
                      checked={ptt.includes(c.id)}
                      onChange={(e) => setPtt(e.target.checked ? [...ptt, c.id] : ptt.filter((x) => x !== c.id))}
                    />
                    {c.name}
                  </label>
                ))}
              </fieldset>
              <div>
                <label>
                  Call button alerts
                  <select
                    value={callValue ?? ''}
                    onChange={(e) => setCallCh(e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">— nobody —</option>
                    {callChannels.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="range">
                  Mic gain <span>{micGain} dB</span>
                  <input
                    type="range"
                    min={0}
                    max={59}
                    value={micGain}
                    onChange={(e) => setMicGain(Number(e.target.value))}
                  />
                </label>
                <label className="range">
                  Sidetone <span>{sidetone}</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={sidetone}
                    onChange={(e) => setSidetone(Number(e.target.value))}
                  />
                </label>
              </div>
            </div>

            <footer>
              <button className="danger ghost" onClick={() => void unclaim()}>
                Remove device
              </button>
              <span className="muted small">
                {event?.active
                  ? `Config v${device.config_version} · device has v${device.applied_version ?? '–'}`
                  : 'Draft: sent when the event is activated'}
              </span>
              <button onClick={onClose}>Cancel</button>
              <button className="primary" disabled={saving || !event} onClick={() => void save()}>
                {saving ? 'Saving…' : event?.active ? 'Save & push' : 'Save draft'}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  )
}
