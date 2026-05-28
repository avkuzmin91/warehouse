import type { ShipmentCargoType } from '../../../../api/shipmentsApi'

type Option = {
  key: ShipmentCargoType
  label: string
  icon: string
  accent: string
  bg: string
  desc: string
}

const OPTIONS: Option[] = [
  { key: 'good',   label: 'Годный товар', icon: '✓', accent: 'var(--c-success)', bg: 'var(--c-success-bg, #f0faf4)', desc: 'Отгрузка из остатков без дефектов' },
  { key: 'defect', label: 'Брак',         icon: '!', accent: 'var(--c-warning)',  bg: 'var(--c-warning-bg)',          desc: 'Отгрузка бракованного товара' },
]

/**
 * Read-only отображение типа груза (good / defect): два таила, активный подсвечен.
 */
export function CargoTypeDisplay({ value }: { value: ShipmentCargoType }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      {OPTIONS.map((opt) => {
        const active = value === opt.key
        return (
          <div
            key={opt.key}
            style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 14px',
              borderRadius: 'var(--r-lg)',
              border: `2px solid ${active ? opt.accent : 'var(--c-border)'}`,
              background: active ? opt.bg : 'var(--c-bg)',
              opacity: active ? 1 : 0.55,
            }}
          >
            <div style={{
              width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: active ? opt.accent : 'var(--c-bg-sunken)',
              color: active ? '#fff' : 'var(--c-text-muted)',
              fontWeight: 700, fontSize: 15,
            }}>
              {opt.icon}
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13, color: active ? opt.accent : 'var(--c-text)' }}>{opt.label}</div>
              <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', marginTop: 1 }}>{opt.desc}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
