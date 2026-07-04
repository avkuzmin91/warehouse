import { useState, type ReactNode } from 'react'
import { sheetDismissAction } from './sheetGuard'
import { useHardwareBack } from '../nav/backHandlers'

/**
 * Нижний лист (bottom sheet): backdrop + grip + dirty-guard. Тап по backdrop
 * закрывает чистую шторку сразу; если форма «грязная» (dirty) — сначала
 * подтверждение «Закрыть без сохранения?». Пока идёт сохранение (locked),
 * backdrop не реагирует.
 */
export function Sheet({
  onClose,
  dirty = false,
  locked = false,
  children,
}: {
  onClose: () => void
  dirty?: boolean
  locked?: boolean
  children: ReactNode
}) {
  const [confirmClose, setConfirmClose] = useState(false)

  function onBackdrop() {
    const action = sheetDismissAction({ dirty, locked })
    if (action === 'close') onClose()
    else if (action === 'confirm') setConfirmClose(true)
  }

  useHardwareBack(() => {
    if (confirmClose) setConfirmClose(false)
    else onBackdrop()
  })

  return (
    <div className="sheet-backdrop" onClick={onBackdrop}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        {children}
      </div>
      {confirmClose && (
        <div className="sheet-confirm" onClick={(e) => e.stopPropagation()}>
          <div className="sheet-confirm-card">
            <h3>Закрыть без сохранения?</h3>
            <p className="line-sub" style={{ marginTop: 4 }}>Введённые данные будут потеряны.</p>
            <div className="line-row" style={{ marginTop: 14 }}>
              <button className="btn ghost" style={{ flex: 1 }} onClick={() => setConfirmClose(false)}>
                Отмена
              </button>
              <button className="btn danger" style={{ flex: 1 }} onClick={onClose}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
