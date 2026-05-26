import type { SelectHTMLAttributes } from 'react'
import { Icon } from './Icon'
import type { IconName } from './Icon'

export interface SelectOption {
  value: string | number
  label: string
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  options: (SelectOption | string)[]
  placeholder?: string
  prefix?: IconName
  onChange?: (value: string) => void
}

export function Select({ options, placeholder, prefix, onChange, className = '', ...rest }: SelectProps) {
  return (
    <div style={{ position: 'relative' }}>
      {prefix && (
        <Icon
          name={prefix}
          size={14}
          style={{ position: 'absolute', left: 10, top: 8, color: 'var(--c-text-subtle)', pointerEvents: 'none' }}
        />
      )}
      <select
        className={['input', className].filter(Boolean).join(' ')}
        style={{ paddingLeft: prefix ? 32 : 10, appearance: 'none', paddingRight: 30, cursor: 'pointer' }}
        onChange={(e) => onChange?.(e.target.value)}
        {...rest}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => {
          const v = typeof o === 'object' ? String(o.value) : o
          const l = typeof o === 'object' ? o.label : o
          return <option key={v} value={v}>{l}</option>
        })}
      </select>
      <Icon
        name="chevDown"
        size={13}
        style={{ position: 'absolute', right: 8, top: 8, color: 'var(--c-text-subtle)', pointerEvents: 'none' }}
      />
    </div>
  )
}
