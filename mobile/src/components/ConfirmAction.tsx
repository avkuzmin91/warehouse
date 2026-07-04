import type { ReactNode } from 'react'

// Двухшаговое inline-подтверждение необратимого действия (в мобилке нет useConfirm):
// первый тап показывает вопрос с кнопками «Нет / Да…» на месте исходной кнопки.
export function ConfirmAction({
  label,
  prompt,
  confirmLabel,
  saving,
  open,
  onOpen,
  onClose,
  onConfirm,
  danger,
}: {
  label: ReactNode
  prompt: string
  confirmLabel: string
  saving: boolean
  open: boolean
  onOpen: () => void
  onClose: () => void
  onConfirm: () => void
  danger?: boolean
}) {
  if (!open) {
    return (
      <button className={danger ? 'btn ghost danger' : 'btn ghost'} disabled={saving} onClick={onOpen}>
        {label}
      </button>
    )
  }
  return (
    <>
      <div className="line-sub" style={{ textAlign: 'center', margin: '2px 0' }}>{prompt}</div>
      <div className="line-row" style={{ marginTop: 0 }}>
        <button className="btn ghost" style={{ flex: 1 }} disabled={saving} onClick={onClose}>Нет</button>
        <button className={danger ? 'btn danger' : 'btn'} style={{ flex: 1 }} disabled={saving} onClick={onConfirm}>
          {saving ? <span className="spin spin-sm" /> : confirmLabel}
        </button>
      </div>
    </>
  )
}
