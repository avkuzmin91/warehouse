import { useEffect, type ReactNode } from 'react'
import { Icon } from '../primitives/Icon'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  subtitle?: string
  width?: number
  footer?: ReactNode
  closeOnBackdrop?: boolean
  children: ReactNode
}

export function Modal({ open, onClose, title, subtitle, width = 480, footer, closeOnBackdrop = false, children }: ModalProps) {
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
        background: 'rgba(20,20,15,0.32)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(2px)',
        padding: 16,
      }}
      onClick={handleBackdropClick}
    >
      <div
        style={{
          width, maxWidth: '100%',
          background: 'var(--c-bg-elev)',
          border: '1px solid var(--c-border)',
          borderRadius: 'var(--r-xl)',
          boxShadow: 'var(--sh-3)',
          display: 'flex', flexDirection: 'column',
          animation: 'modalIn 180ms cubic-bezier(.2,.7,.2,1)',
          maxHeight: 'calc(100vh - 64px)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div style={{
            padding: '16px 20px', borderBottom: '1px solid var(--c-border)',
            display: 'flex', alignItems: 'flex-start', gap: 10,
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
        <div style={{ flex: 1, overflow: 'auto', padding: '18px 20px' }}>{children}</div>
        {footer && (
          <div style={{
            padding: '12px 20px', borderTop: '1px solid var(--c-border)',
            display: 'flex', gap: 8, justifyContent: 'flex-end',
            background: 'var(--c-bg-sunken)',
          }}>
            {footer}
          </div>
        )}
      </div>
      <style>{`
        @keyframes modalIn { from { transform: scale(0.96); opacity: 0; } to { transform: scale(1); opacity: 1; } }
      `}</style>
    </div>
  )
}
