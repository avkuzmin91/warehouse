interface BrandProps {
  size?: number
  color?: string
}

export function Brand({ size = 22, color }: BrandProps) {
  const c = color ?? 'var(--c-accent)'
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flex: `0 0 ${size}px` }}>
      {/* Pac-Man body: full circle minus the mouth wedge */}
      <path
        d="M12 12 L21.5 7.2 A10 10 0 1 0 21.5 16.8 Z"
        fill={c}
      />
      {/* Eye */}
      <circle cx="12" cy="7.5" r="1.4" fill="white" opacity="0.9" />
    </svg>
  )
}

export function BrandWord() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8 }}>
      <Brand size={20} />
      <span style={{ fontWeight: 600, fontSize: 15, letterSpacing: '-0.01em' }}>pack-men</span>
    </span>
  )
}
