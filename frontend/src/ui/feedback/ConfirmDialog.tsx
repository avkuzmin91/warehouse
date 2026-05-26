import { createContext, useContext, useRef, useState, useCallback, type ReactNode } from 'react'
import { Modal } from './Modal'

interface ConfirmOptions {
  title: string
  body?: string
  danger?: boolean
  confirmLabel?: string
  cancelLabel?: string
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>

const ConfirmCtx = createContext<ConfirmFn>(() => Promise.resolve(false))

export function useConfirm(): ConfirmFn {
  return useContext(ConfirmCtx)
}

interface State extends ConfirmOptions {
  resolve: (v: boolean) => void
}

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State | null>(null)
  const resolveRef = useRef<((v: boolean) => void) | null>(null)

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      resolveRef.current = resolve
      setState({ ...opts, resolve })
    })
  }, [])

  const close = (result: boolean) => {
    state?.resolve(result)
    setState(null)
  }

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {state && (
        <Modal
          open
          onClose={() => close(false)}
          title={state.title}
          width={380}
          footer={
            <>
              <button className="btn ghost" onClick={() => close(false)}>
                {state.cancelLabel ?? 'Отмена'}
              </button>
              <button
                className={`btn ${state.danger ? 'danger' : 'primary'}`}
                onClick={() => close(true)}
              >
                {state.confirmLabel ?? (state.danger ? 'Удалить' : 'Подтвердить')}
              </button>
            </>
          }
        >
          {state.body && (
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--c-text-muted)', lineHeight: 1.55 }}>
              {state.body}
            </p>
          )}
        </Modal>
      )}
    </ConfirmCtx.Provider>
  )
}
