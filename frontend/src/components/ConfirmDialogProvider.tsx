import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { ConfirmDialog } from './ModalDialog'

export type ConfirmOptions = {
  message: ReactNode
  ariaLabel?: string
  confirmLabel?: string
  cancelLabel?: string
  confirmVariant?: 'danger' | 'primary'
}

export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

/**
 * Глобальное подтверждение через общий `ConfirmDialog` (стили `confirm-modal`).
 * Оборачивает приложение один раз; из любого компонента: `const confirm = useConfirm()`.
 */
export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const resolverRef = useRef<((value: boolean) => void) | null>(null)
  const [open, setOpen] = useState(false)
  const [payload, setPayload] = useState<ConfirmOptions | null>(null)

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      resolverRef.current = resolve
      setPayload(options)
      setOpen(true)
    })
  }, [])

  const finish = useCallback((result: boolean) => {
    setOpen(false)
    setPayload(null)
    resolverRef.current?.(result)
    resolverRef.current = null
  }, [])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmDialog
        open={open && payload != null}
        ariaLabel={payload?.ariaLabel ?? 'Подтверждение'}
        message={payload?.message ?? ''}
        confirmLabel={payload?.confirmLabel ?? 'ОК'}
        cancelLabel={payload?.cancelLabel ?? 'Отмена'}
        confirmVariant={payload?.confirmVariant ?? 'danger'}
        onCancel={() => finish(false)}
        onConfirm={() => finish(true)}
      />
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext)
  if (!ctx) {
    throw new Error('useConfirm должен вызываться внутри ConfirmDialogProvider')
  }
  return ctx
}
