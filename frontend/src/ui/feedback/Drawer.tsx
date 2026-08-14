import { useEffect, type ReactNode } from 'react'
import { Icon } from '../primitives/Icon'

interface DrawerProps {
  open: boolean
  onClose: () => void
  title?: string
  subtitle?: string
  width?: number
  footer?: ReactNode
  closeOnBackdrop?: boolean
  /** false — контент без внутренних отступов и скролла: children сами управляют раскладкой (шапка/список/футер). */
  padded?: boolean
  children: ReactNode
}

export function Drawer({ open, onClose, title, subtitle, width = 480, footer, closeOnBackdrop = false, padded = true, children }: DrawerProps) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])

  if (!open) return null

  const handleBackdropClick = () => {
    if (closeOnBackdrop) onClose()
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 60,
        background: 'var(--c-overlay)',
        display: 'flex', alignItems: 'stretch', justifyContent: 'flex-end',
        backdropFilter: 'blur(2px)',
      }}
      onClick={handleBackdropClick}
    >
      <div
        style={{
          width, maxWidth: '92vw',
          background: 'var(--c-bg-elev)',
          borderLeft: '1px solid var(--c-border)',
          boxShadow: 'var(--sh-3)',
          display: 'flex', flexDirection: 'column',
          animation: 'sheetIn 220ms cubic-bezier(.2,.7,.2,1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div style={{
            padding: '16px 20px', borderBottom: '1px solid var(--c-border)',
            display: 'flex', alignItems: 'flex-start', gap: 10,
            flexShrink: 0,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}>{title}</div>
              {subtitle && <div style={{ fontSize: 12.5, color: 'var(--c-text-subtle)', marginTop: 3 }}>{subtitle}</div>}
            </div>
            <button className="btn ghost icon sm" onClick={onClose}>
              <Icon name="x" size={14} />
            </button>
          </div>
        )}
        <div style={padded
          ? { flex: 1, overflowY: 'auto', overflowX: 'visible', padding: '18px 20px' }
          : { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {children}
        </div>
        {footer && (
          <div style={{
            padding: '12px 20px', borderTop: '1px solid var(--c-border)',
            display: 'flex', gap: 8, justifyContent: 'flex-end',
            background: 'var(--c-bg-sunken)', flexShrink: 0,
          }}>
            {footer}
          </div>
        )}
      </div>
      <style>{`
        @keyframes sheetIn { from { transform: translateX(24px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
      `}</style>
    </div>
  )
}
