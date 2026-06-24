import { useLayoutEffect, useRef } from 'react'

/**
 * Многострочное текстовое поле, которое само растёт по высоте под содержимое.
 * Высота не меньше minRows строк, дальше расширяется построчно (без скролла).
 */
export function TextArea({
  value,
  onChange,
  placeholder,
  invalid,
  minRows = 3,
  maxRows,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  invalid?: boolean
  minRows?: number
  maxRows?: number
  disabled?: boolean
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  function fit(el: HTMLTextAreaElement) {
    el.style.height = 'auto'
    let h = el.scrollHeight
    if (maxRows != null) {
      const cs = getComputedStyle(el)
      const line = parseFloat(cs.lineHeight) || 21
      const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
      const max = line * maxRows + pad
      if (h > max) {
        h = max
        el.style.overflowY = 'auto'
      } else {
        el.style.overflowY = 'hidden'
      }
    }
    el.style.height = `${h}px`
  }

  useLayoutEffect(() => {
    if (ref.current) fit(ref.current)
  }, [value])

  return (
    <textarea
      ref={ref}
      className={`input textarea${invalid ? ' invalid' : ''}`}
      rows={minRows}
      placeholder={placeholder}
      value={value}
      disabled={disabled}
      onChange={(e) => {
        onChange(e.target.value)
        fit(e.target)
      }}
    />
  )
}
