import { useState, type CSSProperties, type ReactNode } from 'react'
import { Icon } from './Icon'

export function CollapsibleSection({
  title,
  count,
  defaultOpen = false,
  style,
  children,
}: {
  title: string
  count?: number
  defaultOpen?: boolean
  style?: CSSProperties
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <>
      <button
        type="button"
        className={`sec sec-toggle${open ? ' open' : ''}`}
        style={style}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="sec-l">
          <Icon name="chev" size={13} className="sec-chev" />
          {title}
        </span>
        {count != null && <span className="sec-count">{count}</span>}
      </button>
      {open && children}
    </>
  )
}
