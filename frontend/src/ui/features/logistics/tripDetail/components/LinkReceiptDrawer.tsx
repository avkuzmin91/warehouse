import { useMemo, useState } from 'react'
import type { ReceiptListItem } from '../../../../../api/receiptsApi'
import { Icon } from '../../../../primitives/Icon'
import type { IconName } from '../../../../primitives/Icon'
import { foldCiSearch } from '../../../../../utils/foldCiSearch'
import { CandidateReceiptRow } from './CandidateReceiptRow'
import { CreateReceiptForm } from './CreateReceiptForm'
import type { CreateReceiptFormValue } from './CreateReceiptForm'

type Mode = 'link' | 'create'

const EMPTY_CREATE_FORM: CreateReceiptFormValue = {
  client_id: '', supplier_name: '', arrival_date: '', ttn: '', zone_id: '', zone_name: '', comment: '', lines: [],
}

export type LinkReceiptDrawerProps = {
  open: boolean
  onClose: () => void
  tripNumber: string
  tripOrigin: string | null
  candidates: ReceiptListItem[]
  busy?: boolean
  /** Привязать выбранные существующие поступления. */
  onLink: (receiptIds: string[]) => Promise<void>
  /** Создать новое поступление и привязать его к рейсу. Если не задано — режим «Создать новое» скрыт. */
  onCreate?: (form: CreateReceiptFormValue) => Promise<void>
}

/** Правая шторка «Поступления в рейс»: два режима — привязка существующих и создание нового. */
export function LinkReceiptDrawer({ open, onClose, tripNumber, tripOrigin, candidates, busy, onLink, onCreate }: LinkReceiptDrawerProps) {
  const [mode, setMode] = useState<Mode>('link')
  const segments: { value: Mode; icon: IconName; label: string }[] = onCreate
    ? [{ value: 'link', icon: 'inbox', label: 'Привязать существующее' }, { value: 'create', icon: 'plus', label: 'Создать новое' }]
    : [{ value: 'link', icon: 'inbox', label: 'Привязать существующее' }]
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [form, setForm] = useState<CreateReceiptFormValue>(EMPTY_CREATE_FORM)

  function reset() {
    setMode('link')
    setQuery('')
    setSelected(new Set())
    setForm(EMPTY_CREATE_FORM)
  }
  function close() {
    reset()
    onClose()
  }

  const filtered = useMemo(() => {
    const q = query.trim()
    if (!q) return candidates
    const f = foldCiSearch(q)
    return candidates.filter((r) => foldCiSearch(`${r.doc_number} ${r.client_name ?? ''}`).includes(f))
  }, [candidates, query])

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const selectedQty = useMemo(
    () => candidates.filter((r) => selected.has(r.id)).reduce((s, r) => s + r.total_planned, 0),
    [candidates, selected],
  )

  const createReady = !!form.client_id && !!form.arrival_date
  const createInvalidLine = form.lines.some((l) => !l.product_id || l.planned_qty < 1)

  async function handleLink() {
    if (selected.size === 0) return
    await onLink([...selected])
    close()
  }
  async function handleCreate() {
    if (!onCreate || !createReady || createInvalidLine) return
    await onCreate(form)
    close()
  }

  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 60,
        background: 'rgba(20,20,15,0.28)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'stretch', justifyContent: 'flex-end',
      }}
      onClick={close}
    >
      <div
        style={{
          width: 500, maxWidth: 'calc(100vw - 24px)',
          background: 'var(--c-bg-elev)', borderLeft: '1px solid var(--c-border)', boxShadow: 'var(--sh-3)',
          display: 'flex', flexDirection: 'column',
          animation: 'sheetIn 220ms cubic-bezier(.2,.7,.2,1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--c-border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11 }}>
            <div style={{
              width: 34, height: 34, borderRadius: 'var(--r-md)', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--c-accent-bg)', color: 'var(--c-accent)',
            }}>
              <Icon name="inbox" size={18} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}>Поступления в рейс</div>
              <div style={{ fontSize: 12.5, color: 'var(--c-text-subtle)', marginTop: 3 }}>
                Рейс <span className="mono" style={{ color: 'var(--c-text-muted)' }}>{tripNumber}</span> · черновик
                {tripOrigin ? ` · ${tripOrigin}` : ''}
              </div>
            </div>
            <button className="btn ghost icon sm" onClick={close}><Icon name="x" size={14} /></button>
          </div>
          {segments.length > 1 && (
            <div style={{ display: 'flex', gap: 3, padding: 3, background: 'var(--c-bg-sunken)', borderRadius: 9, marginTop: 14 }}>
              {segments.map((s) => {
                const on = mode === s.value
                return (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => setMode(s.value)}
                    style={{
                      flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                      padding: '8px 10px', border: 0, cursor: 'pointer', borderRadius: 6, fontSize: 13, fontWeight: 500, fontFamily: 'inherit',
                      background: on ? 'var(--c-bg-elev)' : 'transparent', color: on ? 'var(--c-text)' : 'var(--c-text-muted)',
                      boxShadow: on ? 'var(--sh-1)' : 'none',
                    }}
                  >
                    <Icon name={s.icon} size={14} />{s.label}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* body */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'visible', padding: '16px 20px' }}>
          {mode === 'link' ? (
            <div className="col gap-12">
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <Icon name="search" size={13} style={{ position: 'absolute', left: 10, color: 'var(--c-text-subtle)', pointerEvents: 'none' }} />
                <input
                  className="input sm"
                  style={{ paddingLeft: 30, width: '100%' }}
                  placeholder="Поиск: клиент, номер поступления…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 11.5, color: 'var(--c-text-subtle)' }}>
                <Icon name="alert" size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>Показаны поступления «В плане», ещё не привязанные к рейсам.</span>
              </div>

              {filtered.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '28px 0', color: 'var(--c-text-subtle)' }}>
                  <Icon name="inbox" size={26} style={{ color: 'var(--c-text-faint)' }} />
                  <div style={{ fontSize: 13, fontWeight: 500, marginTop: 8, color: 'var(--c-text-muted)' }}>Ничего не нашлось</div>
                  {onCreate && (
                    <button className="btn ghost sm" style={{ marginTop: 10 }} onClick={() => setMode('create')}>
                      <Icon name="plus" size={12} />Создать новое
                    </button>
                  )}
                </div>
              ) : (
                <div className="col gap-8">
                  {filtered.map((r) => (
                    <CandidateReceiptRow key={r.id} item={r} checked={selected.has(r.id)} onToggle={() => toggle(r.id)} />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="col gap-16">
              <CreateReceiptForm value={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} />
              <div style={{
                display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 12px',
                background: 'var(--c-accent-bg)', borderRadius: 'var(--r-md)', border: '1px solid var(--c-accent-border)',
                fontSize: 12, color: 'var(--c-text-muted)',
              }}>
                <Icon name="alert" size={14} style={{ color: 'var(--c-accent)', flexShrink: 0, marginTop: 1 }} />
                <span>
                  Поступление создастся в статусе «В плане» и сразу привяжется к рейсу{' '}
                  <span className="mono" style={{ color: 'var(--c-text)' }}>{tripNumber}</span>. Документ появится в разделе «Поступления».
                </span>
              </div>
            </div>
          )}
        </div>

        {/* footer */}
        <div style={{
          padding: '12px 20px', borderTop: '1px solid var(--c-border)', background: 'var(--c-bg-sunken)', flexShrink: 0,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          {mode === 'link' ? (
            <>
              <span style={{ fontSize: 12, color: 'var(--c-text-subtle)' }}>
                {selected.size > 0
                  ? <>Выбрано: <b style={{ color: 'var(--c-text)' }}>{selected.size}</b> · <span className="mono">{selectedQty}</span> шт</>
                  : 'Ничего не выбрано'}
              </span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button className="btn" onClick={close}>Отмена</button>
                <button className="btn primary" onClick={handleLink} disabled={selected.size === 0 || busy}>
                  <Icon name="plus" size={13} />Привязать ({selected.size})
                </button>
              </div>
            </>
          ) : (
            <>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: createReady ? 'var(--c-success)' : 'var(--c-text-subtle)' }}>
                <Icon name={createReady ? 'check' : 'alert'} size={13} />
                {createReady ? 'Готово к созданию' : 'Укажите клиента и дату'}
              </span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button className="btn" onClick={close}>Отмена</button>
                <button className="btn primary" onClick={handleCreate} disabled={!createReady || createInvalidLine || busy}>
                  <Icon name="check" size={13} />Создать и привязать
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      <style>{`@keyframes sheetIn { from { transform: translateX(24px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }`}</style>
    </div>
  )
}
