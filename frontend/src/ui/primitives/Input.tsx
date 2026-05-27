import type { CSSProperties, InputHTMLAttributes, TextareaHTMLAttributes, ReactNode } from 'react'

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  inputSize?: 'sm' | 'md'
}

export function Input({ inputSize, className = '', ...rest }: InputProps) {
  return (
    <input
      className={['input', inputSize === 'sm' ? 'sm' : '', className].filter(Boolean).join(' ')}
      {...rest}
    />
  )
}

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>

export function Textarea({ className = '', ...rest }: TextareaProps) {
  return (
    <textarea
      className={['input', className].filter(Boolean).join(' ')}
      style={{ height: 'auto', paddingTop: 8, paddingBottom: 8, resize: 'vertical' }}
      {...rest}
    />
  )
}

interface FieldProps {
  label?: string
  help?: string
  error?: string
  required?: boolean
  hint?: string
  style?: CSSProperties
  children: ReactNode
}

export function Field({ label, help, error, required, hint, style, children }: FieldProps) {
  return (
    <div className="field" style={style}>
      {label && (
        <label
          className="label"
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <span>
            {label}
            {required && <span style={{ color: 'var(--c-danger)', marginLeft: 3 }}>*</span>}
          </span>
          {hint && <span style={{ fontSize: 11.5, color: 'var(--c-text-faint)' }}>{hint}</span>}
        </label>
      )}
      {children}
      {help && !error && <div className="help">{help}</div>}
      {error && <div className="help" style={{ color: 'var(--c-danger)' }}>{error}</div>}
    </div>
  )
}
