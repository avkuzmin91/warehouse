import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

interface ToastItem {
  id: number
  message: string
  type?: 'success' | 'error' | 'info'
}

type ShowToast = (message: string, type?: ToastItem['type']) => void

const ToastCtx = createContext<ShowToast>(() => {})

export function useToast(): ShowToast {
  return useContext(ToastCtx)
}

let _counter = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const show = useCallback((message: string, type: ToastItem['type'] = 'info') => {
    const id = ++_counter
    setToasts((prev) => [...prev, { id, message, type }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 3500)
  }, [])

  const bg: Record<string, string> = {
    success: 'var(--c-success)',
    error: 'var(--c-danger)',
    info: '#1a1a18',
  }

  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 100, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
        {toasts.map((t) => (
          <div
            key={t.id}
            className="toast"
            style={{ background: bg[t.type ?? 'info'], position: 'relative', transform: 'none', left: 'auto', bottom: 'auto' }}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
