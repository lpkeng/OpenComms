// SPDX-License-Identifier: AGPL-3.0-or-later
// Small line icons (drawn for OpenComms) that inherit the text colour.

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export function MicIcon({ size = 14, muted = false }: { size?: number; muted?: boolean }) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true" className="icon">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M6 11a6 6 0 0 0 12 0" />
      <path d="M12 17v4M9 21h6" />
      {muted && <path d="M4 4l16 16" />}
    </svg>
  )
}

export function HeadphonesIcon({ size = 14 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true" className="icon">
      <path d="M4 15v-3a8 8 0 0 1 16 0v3" />
      <rect x="3" y="14" width="4" height="7" rx="1.5" />
      <rect x="17" y="14" width="4" height="7" rx="1.5" />
    </svg>
  )
}

export function WarnIcon({ size = 14 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size} aria-hidden="true" className="icon">
      <path d="M12 3 2 20h20L12 3z" />
      <path d="M12 10v4M12 17v.5" />
    </svg>
  )
}
