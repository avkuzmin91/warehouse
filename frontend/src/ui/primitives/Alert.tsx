import type { CSSProperties, ReactNode } from 'react'
import { Icon } from './Icon'

export type AlertTone = 'danger' | 'warning' | 'info' | 'success'

type Props = {
  tone: AlertTone
  children: ReactNode
  /** Иконка слева. По умолчанию 'alert'. Пропусти `false` чтобы выключить. */
  icon?: string | false
  style?: CSSProperties
  className?: string
}

const DANGER_STYLE: CSSProperties = {
  background: 'color-mix(in oklab, var(--c-danger) 10%, transparent)',
  border: '1px solid color-mix(in oklab, var(--c-danger) 30%, transparent)',
  color: 'var(--c-danger)',
}

const WARNING_STYLE: CSSProperties = {
  background: 'var(--c-warning-bg)',
  border: '1px solid #ead1a3',
  color: 'var(--c-warning)',
}

const INFO_STYLE: CSSProperties = {
  background: 'var(--c-info-bg)',
  border: '1px solid color-mix(in oklab, var(--c-info) 25%, transparent)',
  color: 'var(--c-info)',
}

const SUCCESS_STYLE: CSSProperties = {
  background: 'var(--c-success-bg)',
  border: '1px solid color-mix(in oklab, var(--c-success) 25%, transparent)',
  color: 'var(--c-success)',
}

function toneStyle(tone: AlertTone): CSSProperties {
  switch (tone) {
    case 'danger':  return DANGER_STYLE
    case 'warning': return WARNING_STYLE
    case 'info':    return INFO_STYLE
    case 'success': return SUCCESS_STYLE
  }
}

/**
 * Inline-уведомление: цветная плашка с опциональной иконкой.
 * Заменяет ad-hoc divы с inline-стилями для error/warning блоков.
 */
export function Alert({ tone, children, icon, style, className }: Props) {
  const showIcon = icon !== false
  const iconName = typeof icon === 'string' ? icon : 'alert'
  return (
    <div
      className={className}
      style={{
        padding: '10px 14px',
        borderRadius: 'var(--r-md)',
        fontSize: 13,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        ...toneStyle(tone),
        ...style,
      }}
    >
      {showIcon && <Icon name={iconName} size={15} />}
      <span style={{ flex: 1 }}>{children}</span>
    </div>
  )
}
