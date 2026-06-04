type Props = {
  title: string
  sub?: string
  compact?: boolean
}

export function PacmanPlaceholder({ title, sub = 'Скоро подключим', compact = false }: Props) {
  const pelletCount = compact ? 3 : 5

  return (
    <div
      style={{
        minHeight: compact ? 0 : 132,
        height: compact ? '100%' : undefined,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: compact ? '16px 14px' : '22px 16px',
        textAlign: 'center',
      }}
    >
      <div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <div
            aria-hidden="true"
            style={{
              width: compact ? 30 : 36,
              height: compact ? 30 : 36,
              borderRadius: '50%',
              background: 'var(--c-accent-hover)',
              clipPath: 'polygon(0 0, 100% 0, 58% 50%, 100% 100%, 0 100%)',
              boxShadow: '0 0 0 1px var(--c-accent-bg)',
            }}
          />
          {Array.from({ length: pelletCount }).map((_, i) => (
            <span
              key={i}
              aria-hidden="true"
              style={{
                width: compact ? 5 : 6,
                height: compact ? 5 : 6,
                borderRadius: '50%',
                background: 'var(--c-accent)',
                opacity: 0.35 + i * 0.1,
              }}
            />
          ))}
        </div>
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{title}</div>
        <div className="text-xs subtle" style={{ marginTop: 4 }}>{sub}</div>
      </div>
    </div>
  )
}
