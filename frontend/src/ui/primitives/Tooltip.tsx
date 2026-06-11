import { useState, type ReactNode } from 'react'

interface TooltipProps {
  content: string
  children: ReactNode
  /** Для длинных подсказок: ограничивает ширину и включает перенос строк. */
  maxWidth?: number
}

export function Tooltip({ content, children, maxWidth }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  return (
    <span
      style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && (
        <span style={{
          position: 'absolute',
          bottom: 'calc(100% + 6px)',
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#1a1a18',
          color: 'white',
          padding: '4px 8px',
          borderRadius: 4,
          fontSize: 11.5,
          whiteSpace: maxWidth ? 'normal' : 'nowrap',
          width: maxWidth ? 'max-content' : undefined,
          maxWidth,
          pointerEvents: 'none',
          zIndex: 50,
        }}>
          {content}
        </span>
      )}
    </span>
  )
}
