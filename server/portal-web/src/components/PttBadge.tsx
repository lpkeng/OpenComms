// SPDX-License-Identifier: AGPL-3.0-or-later
import type { HeadsetPtt, PlanModel } from '../plan'

/** Marks the channel the headset PTT talks on. Dashed when the wearer remapped it on the beltpack. */
export default function PttBadge({ model, ptt }: { model: PlanModel; ptt: HeadsetPtt }) {
  const planned = model.channels.find((c) => c.channel.id === ptt.planned)?.channel.name ?? 'nothing'
  return (
    <span
      className={`ptt-badge ${ptt.remapped ? 'remapped' : ''}`}
      title={ptt.remapped ? `Headset PTT remapped here on the beltpack (plan: ${planned})` : 'Headset PTT talks here'}
    >
      PTT
    </span>
  )
}
