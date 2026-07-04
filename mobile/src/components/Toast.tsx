import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from './Icon'

type ToastKind = 'success' | 'error'
type ToastState = { id: number; kind: ToastKind; text: string }
type ToastFn = (text: string, kind?: ToastKind) => void

const ToastCtx = createContext<ToastFn | null>(null)

const TOAST_MS = 3500

/** Снекбар над таб-баром: короткое подтверждение действия, автоскрытие 3.5 с. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = useCallback<ToastFn>((text, kind = 'success') => {
    if (timer.current) clearTimeout(timer.current)
    setToast({ id: Date.now(), kind, text })
    timer.current = setTimeout(() => setToast(null), TOAST_MS)
  }, [])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  return (
    <ToastCtx.Provider value={show}>
      {children}
      {toast && (
        <div key={toast.id} className={`toast ${toast.kind}`} role="status">
          <Icon name={toast.kind === 'success' ? 'check' : 'alert'} size={16} />
          <span>{toast.text}</span>
        </div>
      )}
    </ToastCtx.Provider>
  )
}

export function useToast(): ToastFn {
  const ctx = useContext(ToastCtx)
  if (!ctx) throw new Error('useToast вне ToastProvider')
  return ctx
}
