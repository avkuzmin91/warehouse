import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties, ReactNode } from 'react'
import { Icon } from '../../../primitives/Icon'
import type { IconName } from '../../../primitives/Icon'
import { DatePicker } from '../../../primitives/DatePicker'
import { datePart, timePart, combineDateTime, shiftHours } from './dateTimeValue'

function ctrlStyle(empty: boolean, invalid?: boolean): CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 8, width: '100%', height: 34,
    padding: '0 10px', borderRadius: 'var(--r-md)', cursor: 'pointer',
    border: `1px solid ${invalid ? 'var(--c-danger)' : 'var(--c-border-strong)'}`,
    background: invalid ? 'var(--c-danger-bg)' : 'var(--c-bg-elev)',
    fontSize: 13, color: empty ? 'var(--c-text-subtle)' : 'var(--c-text)', textAlign: 'left',
  }
}

export function FieldLabel({ children, required }: { children: ReactNode; required?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--c-text-muted)' }}>{children}</span>
      {required && (
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--c-text-faint)' }}>
          обяз.
        </span>
      )}
    </div>
  )
}

export type SelectOption = { id: string; name: string; icon?: IconName }

/** Селект-кнопка с поповером (опции + иконки). Заменяет голый <select>. */
export function SelectField({ value, options, placeholder = 'Выбрать', leadIcon, invalid, onChange }: {
  value: string
  options: SelectOption[]
  placeholder?: string
  leadIcon?: IconName
  invalid?: boolean
  onChange?: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties>({})
  const containerRef = useRef<HTMLDivElement>(null)
  const sel = options.find((o) => o.id === value)
  const label = sel?.name ?? null

  const updateDropdownPosition = () => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return

    const gap = 4
    const viewportGap = 8
    const desiredHeight = 240
    const spaceBelow = window.innerHeight - rect.bottom - viewportGap
    const spaceAbove = rect.top - viewportGap

    if (spaceBelow < 140 && spaceAbove > spaceBelow) {
      setDropdownStyle({
        position: 'fixed',
        bottom: window.innerHeight - rect.top + gap,
        left: rect.left,
        width: Math.max(rect.width, 200),
        maxHeight: Math.min(desiredHeight, Math.max(120, spaceAbove - gap)),
      })
      return
    }

    setDropdownStyle({
      position: 'fixed',
      top: rect.bottom + gap,
      left: rect.left,
      width: Math.max(rect.width, 200),
      maxHeight: Math.min(desiredHeight, Math.max(120, spaceBelow - gap)),
    })
  }

  useEffect(() => {
    if (!open) return
    updateDropdownPosition()
    window.addEventListener('resize', updateDropdownPosition)
    window.addEventListener('scroll', updateDropdownPosition, true)
    return () => {
      window.removeEventListener('resize', updateDropdownPosition)
      window.removeEventListener('scroll', updateDropdownPosition, true)
    }
  }, [open])

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button type="button" style={ctrlStyle(!label, invalid)} onClick={() => { updateDropdownPosition(); setOpen((o) => !o) }}>
        {leadIcon && <Icon name={sel?.icon ?? leadIcon} size={14} style={{ color: 'var(--c-text-subtle)', flexShrink: 0 }} />}
        <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label ?? placeholder}</span>
        <Icon name="chevDown" size={13} style={{ color: 'var(--c-text-faint)', flexShrink: 0 }} />
      </button>
      {open && createPortal(
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onClick={() => setOpen(false)} />
          <div style={{
            ...dropdownStyle, zIndex: 9999,
            background: 'var(--c-bg-elev)', border: '1px solid var(--c-border)', borderRadius: 'var(--r-md)',
            boxShadow: 'var(--sh-3)', padding: 4, overflowY: 'auto',
          }}>
            {options.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => { onChange?.(o.id); setOpen(false) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 8px', border: 0,
                  borderRadius: 'var(--r-sm)', background: o.id === value ? 'var(--c-bg-hover)' : 'transparent',
                  fontSize: 12.5, color: 'var(--c-text)', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--c-bg-hover)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = o.id === value ? 'var(--c-bg-hover)' : 'transparent' }}
              >
                {o.icon && <Icon name={o.icon} size={14} style={{ color: 'var(--c-text-subtle)' }} />}
                <span style={{ flex: 1 }}>{o.name}</span>
                {o.id === value && <Icon name="check" size={13} style={{ color: 'var(--c-accent)' }} />}
              </button>
            ))}
          </div>
        </>,
        document.body
      )}
    </div>
  )
}

/** Поле даты/времени — стилизованный контрол с иконкой календаря. */
export function TimeField({ value, placeholder = 'Выбрать дату', onClick }: {
  value?: string | null
  placeholder?: string
  onClick?: () => void
}) {
  return (
    <button type="button" style={ctrlStyle(!value)} onClick={onClick}>
      <Icon name="calendar" size={14} style={{ color: 'var(--c-text-subtle)', flexShrink: 0 }} />
      <span className={value ? 'mono' : ''} style={{ flex: 1, fontSize: value ? 12.5 : 13 }}>{value || placeholder}</span>
    </button>
  )
}

function dtfChipStyle(active: boolean): CSSProperties {
  return {
    padding: '3px 9px', borderRadius: 'var(--r-sm)', cursor: 'pointer',
    border: `1px solid ${active ? 'var(--c-accent)' : 'var(--c-border-strong)'}`,
    background: active ? 'var(--c-accent)' : 'var(--c-bg-elev)',
    color: active ? '#fff' : 'var(--c-text-muted)',
    fontSize: 11.5, fontWeight: 600, fontFamily: 'inherit', lineHeight: 1.4,
  }
}

/**
 * Поле «дата + время»: DatePicker + ручной ввод чч:мм. Значение — `YYYY-MM-DD[THH:mm]`.
 * `hourPresets` рисует чипы «+N ч» от `presetBase` (или от текущего момента, если он пуст).
 */
export function DateTimeField({ value, invalid, onChange, hourPresets, presetBase }: {
  value: string
  invalid?: boolean
  onChange: (value: string) => void
  hourPresets?: number[]
  presetBase?: string
}) {
  const date = datePart(value)
  const time = timePart(value)
  return (
    <div className="dtf-field" style={{
      ...(invalid ? { padding: 2, margin: -2, borderRadius: 'var(--r-md)', border: '1px solid var(--c-danger)', background: 'var(--c-danger-bg)' } : null),
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 88px', gap: 8 }}>
        <DatePicker value={date} onChange={(v) => onChange(combineDateTime(v, time))} />
        <input
          className="input sm mono"
          value={time}
          placeholder="чч:мм"
          inputMode="numeric"
          maxLength={5}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^\d:]/g, '').slice(0, 5)
            const normalized = raw.length === 2 && !raw.includes(':') ? `${raw}:` : raw
            onChange(combineDateTime(date, normalized))
          }}
          onBlur={(e) => {
            const m = e.target.value.match(/^(\d{1,2}):?(\d{2})$/)
            if (!m || !date) return
            const hh = Math.min(23, Number(m[1]))
            const mm = Math.min(59, Number(m[2]))
            onChange(combineDateTime(date, `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`))
          }}
          style={{ width: '100%', textAlign: 'center' }}
        />
      </div>
      {hourPresets && hourPresets.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
          {hourPresets.map((h) => (
            <button
              key={`h${h}`}
              type="button"
              style={dtfChipStyle(false)}
              onClick={() => onChange(shiftHours(presetBase ?? '', h))}
            >
              +{h} ч
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Денежное поле — ввод с ₽-суффиксом, табличные цифры, по правому краю. */
export function MoneyField({ value, onChange, placeholder = '0', invalid }: {
  value: string
  onChange?: (v: string) => void
  placeholder?: string
  invalid?: boolean
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', height: 34, padding: '0 10px', borderRadius: 'var(--r-md)',
      border: `1px solid ${invalid ? 'var(--c-danger)' : 'var(--c-border-strong)'}`,
      background: invalid ? 'var(--c-danger-bg)' : 'var(--c-bg-elev)',
    }}>
      <input
        value={value}
        placeholder={placeholder}
        inputMode="numeric"
        onChange={(e) => onChange?.(e.target.value.replace(/[^\d]/g, ''))}
        style={{
          flex: 1, border: 0, outline: 'none', background: 'transparent', fontFamily: 'var(--font-num)',
          fontSize: 13, fontWeight: 400, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontFeatureSettings: "'tnum' 1", minWidth: 0,
          color: 'var(--c-text)',
        }}
      />
      <span style={{ marginLeft: 6, color: 'var(--c-text-subtle)', fontSize: 13 }}>₽</span>
    </div>
  )
}

/** Read-only пара «ключ → значение» для завершённых фаз и леджера. */
export function ReadRow({ label, children, mono, strong }: {
  label: ReactNode
  children: ReactNode
  mono?: boolean
  strong?: boolean
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, padding: '5px 0' }}>
      <span style={{ fontSize: 12.5, color: 'var(--c-text-muted)' }}>{label}</span>
      <span className={mono ? 'mono' : ''} style={{ fontSize: mono ? 12.5 : 13, fontWeight: strong ? 600 : 500, color: 'var(--c-text)', textAlign: 'right' }}>
        {children}
      </span>
    </div>
  )
}

export type SegmentTone = 'success' | 'warning'
export type SegmentOption<T extends string> = { value: T; label: string; icon?: IconName; tone?: SegmentTone }

export function segmentToneColors(tone: SegmentTone): { color: string; background: string } {
  return tone === 'success'
    ? { color: 'var(--c-success)', background: 'var(--c-success-bg)' }
    : { color: 'var(--c-warning)', background: 'var(--c-warning-bg)' }
}

/** Сегментированный переключатель (загруженность, состояния). */
export function Segmented<T extends string>({ value, options, invalid, onChange }: {
  value: T
  options: SegmentOption<T>[]
  invalid?: boolean
  onChange?: (v: T) => void
}) {
  return (
    <div style={{
      display: 'inline-flex', gap: 3, padding: 3, borderRadius: 8,
      background: invalid ? 'var(--c-danger-bg)' : 'var(--c-bg-sunken)',
      boxShadow: invalid ? 'inset 0 0 0 1px var(--c-danger)' : 'none',
    }}>
      {options.map((o) => {
        const on = o.value === value
        const toneColors = on && o.tone ? segmentToneColors(o.tone) : null
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange?.(o.value)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', border: 0, cursor: 'pointer',
              borderRadius: 6, fontSize: 12.5, fontWeight: 500, fontFamily: 'inherit',
              background: toneColors?.background ?? (on ? 'var(--c-bg-elev)' : 'transparent'),
              color: toneColors?.color ?? (on ? 'var(--c-text)' : 'var(--c-text-muted)'),
              boxShadow: on ? 'var(--sh-1)' : 'none',
            }}
          >
            {o.icon && <Icon name={o.icon} size={13} />}{o.label}
          </button>
        )
      })}
    </div>
  )
}
