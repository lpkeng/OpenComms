// SPDX-License-Identifier: AGPL-3.0-or-later
import 'leaflet/dist/leaflet.css'
import { CircleMarker, MapContainer, TileLayer, Tooltip } from 'react-leaflet'
import type { Device } from '../types'

const DEFAULT_CENTER: [number, number] = [-33.8037, 150.8705]

export default function MapView({ devices }: { devices: Device[] }) {
  const located = devices.filter((d) => d.state?.gps?.fix)
  const center: [number, number] = located.length
    ? [
        located.reduce((s, d) => s + d.state!.gps.lat, 0) / located.length,
        located.reduce((s, d) => s + d.state!.gps.lon, 0) / located.length,
      ]
    : DEFAULT_CENTER

  return (
    <section className="card map-card">
      <MapContainer center={center} zoom={17} className="map">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {located.map((d) => {
          const s = d.state!
          const color = !d.online ? '#777' : s.talk.length ? '#e5484d' : s.alert ? '#f5a524' : '#30a46c'
          return (
            <CircleMarker
              key={d.id}
              center={[s.gps.lat, s.gps.lon]}
              radius={9}
              pathOptions={{ color: '#111', weight: 2, fillColor: color, fillOpacity: 0.9 }}
            >
              <Tooltip permanent direction="right" offset={[10, 0]}>
                <b>{d.name || d.id}</b>
                {d.label && ` · ${d.label}`}
                <br />
                {d.online ? `${s.battery_pct}% · ${s.rssi_dbm} dBm${s.talk.length ? ' · talking' : ''}` : 'offline'}
              </Tooltip>
            </CircleMarker>
          )
        })}
      </MapContainer>
      <p className="muted small">
        Green = online, red = talking, amber = call alert, grey = offline (last known position).
        {located.length === 0 && ' No GPS positions reported yet.'}
      </p>
    </section>
  )
}
