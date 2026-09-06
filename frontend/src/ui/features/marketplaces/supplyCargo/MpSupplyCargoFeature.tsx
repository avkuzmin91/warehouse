import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  addMpCargoOrder,
  advanceMpSupply,
  closeMpCargoUnit,
  createMpCargoUnit,
  deleteMpCargoUnit,
  getMpCargoLabels,
  getMpCargoUnits,
  getMpSupplyPackView,
  MARKETPLACE_LABELS,
  marketplaceTone,
  MP_CARGO_KIND_LABELS,
  MP_CARGO_QR_PREFIX,
  MP_CARGO_STATUS_LABELS,
  MP_SUPPLY_STATUS_LABELS,
  mpSupplyStatusTone,
  removeMpCargoOrder,
  reopenMpCargoUnit,
} from '../../../../api/marketplacesApi'
import type { MpCargoKind, MpCargoUnit } from '../../../../api/marketplacesApi'
import { useApi } from '../../../../hooks/useApi'
import { useCurrentUser } from '../../../../hooks/useCurrentUser'
import { Badge } from '../../../primitives/Badge'
import { EmptyState } from '../../../primitives/EmptyState'
import { Icon } from '../../../primitives/Icon'
import { useConfirm } from '../../../feedback/ConfirmDialog'
import { useToast } from '../../../feedback/Toast'
import { openQrLabelSheet, POPUP_BLOCKED_HINT } from '../../../../utils/qrLabelSheet'

/** Грузовые места FBS-поставки: короба и палеты, которые уезжают на площадку.
 *
 * Сценарий кладовщика: завести ГМ и напечатать его этикетку, выбрать ГМ, сканировать
 * этикетки заказов (штрих-код стикера площадки), закрыть ГМ. Скан QR «wms:gm:…»
 * в то же поле переключает активное ГМ. Когда все упакованные заказы лежат в закрытых
 * ГМ, менеджер жмёт «Передана площадке».
 */
export function MpSupplyCargoFeature({ supplyId }: { supplyId: string }) {
  const navigate = useNavigate()
  const toast = useToast()
  const confirm = useConfirm()
  const { user } = useCurrentUser()
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((n) => n + 1), [])
  const { data, loading, error } = useApi(
    async (signal) => {
      const [view, cargo] = await Promise.all([
        getMpSupplyPackView(supplyId, signal), getMpCargoUnits(supplyId, signal),
      ])
      return { view, cargo_units: cargo.items }
    },
    [supplyId, tick],
  )

  const [activeId, setActiveId] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [scanError, setScanError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!data) return
    if (activeId && data.cargo_units.some((u) => u.id === activeId)) return
    const open = data.cargo_units.find((u) => u.status === 'open') ?? null
    setActiveId(open ? open.id : null)
  }, [data, activeId])

  useEffect(() => { inputRef.current?.focus() }, [activeId, busy])

  if (loading && !data) return <div className="page"><EmptyState title="Загрузка…" /></div>
  if (error || !data) {
    return <div className="page"><EmptyState title="Не удалось загрузить" sub={error?.message} /></div>
  }
  const doc = data.view
  const editable = doc.status === 'packing' || doc.status === 'handover'
  const units = data.cargo_units
  const active = units.find((u) => u.id === activeId) ?? null
  const selected = doc.orders
  const packed = selected.filter((o) => o.packed_at)
  const loose = packed.filter((o) => !o.cargo_unit_id)
  const openUnits = units.filter((u) => u.status === 'open')
  const canHandover = doc.status === 'handover' && loose.length === 0 && openUnits.length === 0 && units.length > 0
  const isManager = user?.role === 'admin' || user?.role === 'manager'

  const print = async (ids: string[]) => {
    try {
      const res = await getMpCargoLabels(ids)
      const ok = openQrLabelSheet(res.items.map((l) => ({
        qr_svg: l.qr_svg, code: l.doc_number, sub: `${l.kind_label} · ${l.supply_number}`,
      })))
      if (!ok) toast(POPUP_BLOCKED_HINT, 'error')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось получить этикетки', 'error')
    }
  }

  const create = async (kind: MpCargoKind) => {
    setBusy(true)
    try {
      const unit = await createMpCargoUnit(supplyId, kind)
      setActiveId(unit.id)
      toast(`Заведено ${unit.doc_number}`, 'success')
      reload()
      await print([unit.id])
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось завести грузовое место', 'error')
    } finally {
      setBusy(false)
    }
  }

  const submitScan = async () => {
    const raw = code.trim()
    if (!raw || busy) return
    setBusy(true)
    setScanError('')
    try {
      if (raw.startsWith(MP_CARGO_QR_PREFIX) || /^gm-\d+$/i.test(raw)) {
        const id = raw.startsWith(MP_CARGO_QR_PREFIX) ? raw.slice(MP_CARGO_QR_PREFIX.length) : null
        const unit = units.find((u) => (id ? u.id === id : u.doc_number.toLowerCase() === raw.toLowerCase()))
        if (!unit) throw new Error(`Грузовое место «${raw}» не принадлежит этой поставке`)
        if (unit.id === activeId && unit.status === 'open') {
          // Повторный скан активного ГМ = закрыть его, как на ТСД.
          await closeMpCargoUnit(unit.id)
          toast(`${unit.doc_number} закрыто`, 'success')
        } else {
          setActiveId(unit.id)
        }
        setCode('')
        reload()
        return
      }
      if (!active) throw new Error('Сначала выберите или отсканируйте грузовое место')
      const res = await addMpCargoOrder(active.id, raw)
      toast(res.already ? `Заказ ${res.external_id} уже в ${active.doc_number}` : `Заказ ${res.external_id} → ${active.doc_number}`, res.already ? 'info' : 'success')
      setCode('')
      reload()
    } catch (e) {
      setScanError(e instanceof Error ? e.message : 'Скан не принят')
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  const run = async (fn: () => Promise<unknown>, okMsg?: string) => {
    setBusy(true)
    try {
      await fn()
      if (okMsg) toast(okMsg, 'success')
      reload()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось выполнить', 'error')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (unit: MpCargoUnit) => {
    const ok = await confirm({
      title: `Удалить ${unit.doc_number}?`,
      body: 'Пустое грузовое место будет удалено, его этикетка станет недействительной.',
      danger: true,
      confirmLabel: 'Удалить',
    })
    if (!ok) return
    await run(() => deleteMpCargoUnit(unit.id), `${unit.doc_number} удалено`)
  }

  const handover = async () => {
    const ok = await confirm({
      title: 'Передать площадке?',
      body: `Поставка ${doc.doc_number}: ${units.length} грузовых мест, ${packed.length} заказ(ов). `
        + 'Собранное спишется со склада; у Wildberries короба зарегистрируются и поставка уйдёт в доставку.',
      confirmLabel: 'Передать',
    })
    if (!ok) return
    setBusy(true)
    try {
      await advanceMpSupply(supplyId)
      toast('Поставка передана площадке', 'success')
      navigate(`/marketplaces/supplies/${supplyId}`)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось передать', 'error')
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="row gap-8" style={{ alignItems: 'center' }}>
            <button className="btn ghost sm icon" onClick={() => navigate(-1)} title="Назад">
              <Icon name="arrowLeft" size={15} />
            </button>
            <h1 className="page-title" style={{ margin: 0 }}>Грузовые места · {doc.doc_number}</h1>
            <Badge tone={mpSupplyStatusTone(doc.status)}>{MP_SUPPLY_STATUS_LABELS[doc.status]}</Badge>
            <Badge tone={marketplaceTone(doc.marketplace)}>{MARKETPLACE_LABELS[doc.marketplace]}</Badge>
          </div>
          <div className="page-subtitle">
            {doc.account_name}{doc.client_name ? ` · ${doc.client_name}` : ''}
            {doc.external_supply_id ? ` · поставка площадки ${doc.external_supply_id}` : ''}
            {isManager && <>{' · '}<Link to={`/marketplaces/supplies/${supplyId}`}>карточка поставки</Link></>}
          </div>
        </div>
        <div className="row gap-8">
          <span className="t-sub" style={{ fontSize: 12.5 }}>
            Уложено <b>{packed.length - loose.length}</b> из {packed.length} упакованных · ГМ {units.length}
          </span>
          {editable && (
            <>
              <button className="btn" disabled={busy} onClick={() => create('box')}>
                <Icon name="plus" size={13} />Короб
              </button>
              <button className="btn" disabled={busy} onClick={() => create('pallet')}>
                <Icon name="plus" size={13} />Палета
              </button>
            </>
          )}
          {units.length > 0 && (
            <button className="btn" disabled={busy} onClick={() => print(units.map((u) => u.id))}>
              <Icon name="print" size={13} />Этикетки ({units.length})
            </button>
          )}
          {isManager && doc.status === 'handover' && (
            <button
              className="btn primary"
              disabled={busy}
              onClick={canHandover ? handover : () => toast(
                [loose.length ? `Не уложено в ГМ: ${loose.length} заказ(ов)` : '',
                  openUnits.length ? `Не закрыто ГМ: ${openUnits.map((u) => u.doc_number).join(', ')}` : '',
                  units.length === 0 ? 'Нет ни одного грузового места' : ''].filter(Boolean).join(' · '), 'error',
              )}
            >
              <Icon name="truckOut" size={14} />Передана площадке
            </button>
          )}
        </div>
      </div>

      {doc.status === 'packing' && (
        <div className="card" style={{ padding: '10px 14px', marginBottom: 12, fontSize: 12.5, color: 'var(--c-text-muted)' }}>
          Поставка ещё на упаковке: в грузовые места ложатся только упакованные заказы с этикеткой.
          {' '}<Link to={`/marketplaces/supplies/${supplyId}/pack`}>Станция упаковки</Link>
        </div>
      )}

      {editable && (
        <form onSubmit={(e) => { e.preventDefault(); void submitScan() }} className="card row gap-8" style={{ padding: 12, marginBottom: 12, alignItems: 'center' }}>
          <Icon name="qr" size={18} />
          <span style={{ fontSize: 12.5, color: 'var(--c-text-muted)', minWidth: 190 }}>
            {active ? <>Активное ГМ: <b className="mono">{active.doc_number}</b></> : 'ГМ не выбрано'}
          </span>
          <input
            ref={inputRef}
            className="input"
            style={{ flex: 1, fontFamily: 'ui-monospace, monospace' }}
            placeholder="Скан: этикетка заказа → в активное ГМ · QR грузового места → выбрать / закрыть"
            value={code}
            disabled={busy}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="off"
          />
          <button className="btn" type="submit" disabled={busy || !code.trim()}>Уложить</button>
          {scanError && <span style={{ fontSize: 12.5, color: 'var(--c-danger)' }}><Icon name="alert" size={13} /> {scanError}</span>}
        </form>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 16, alignItems: 'start' }}>
        <div>
          {units.length === 0 ? (
            <EmptyState title="Грузовых мест пока нет" sub="Заведите короб или палету и напечатайте этикетку." />
          ) : units.map((u) => {
            const isActive = u.id === activeId
            return (
              <div
                key={u.id}
                className="card"
                style={{ padding: 12, marginBottom: 10, borderColor: isActive ? 'var(--c-accent)' : undefined, cursor: editable ? 'pointer' : 'default' }}
                onClick={() => editable && setActiveId(u.id)}
              >
                <div className="row gap-8" style={{ alignItems: 'center' }}>
                  <Icon name={u.kind === 'pallet' ? 'layers' : 'box'} size={16} />
                  <span className="mono" style={{ fontWeight: 700 }}>{u.doc_number}</span>
                  <span style={{ fontSize: 12.5, color: 'var(--c-text-muted)' }}>{MP_CARGO_KIND_LABELS[u.kind]}</span>
                  <Badge tone={u.status === 'closed' ? 'success' : 'warning'}>{MP_CARGO_STATUS_LABELS[u.status]}</Badge>
                  {u.external_id && <Badge tone="info">площадка: {u.external_id}</Badge>}
                  <span style={{ flex: 1 }} />
                  <span className="num" style={{ fontSize: 12.5, color: 'var(--c-text-muted)' }}>
                    {u.orders_count} заказ(ов) · {u.items_qty} шт.
                  </span>
                  <button className="btn ghost sm icon" title="Этикетка" onClick={(e) => { e.stopPropagation(); void print([u.id]) }}>
                    <Icon name="print" size={13} />
                  </button>
                  {editable && u.status === 'open' && (
                    <button className="btn sm" disabled={busy} onClick={(e) => { e.stopPropagation(); void run(() => closeMpCargoUnit(u.id), `${u.doc_number} закрыто`) }}>
                      Закрыть
                    </button>
                  )}
                  {editable && u.status === 'closed' && !u.external_id && (
                    <button className="btn ghost sm" disabled={busy} onClick={(e) => { e.stopPropagation(); void run(() => reopenMpCargoUnit(u.id)) }}>
                      Открыть
                    </button>
                  )}
                  {editable && u.status === 'open' && u.orders_count === 0 && (
                    <button className="btn ghost sm icon" title="Удалить" disabled={busy} onClick={(e) => { e.stopPropagation(); void remove(u) }}>
                      <Icon name="trash" size={13} />
                    </button>
                  )}
                </div>
                {u.orders.length > 0 && (
                  <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {u.orders.map((o) => (
                      <span key={o.order_id} className="mono" style={{ fontSize: 12, padding: '2px 8px', borderRadius: 'var(--r-lg)', background: 'var(--c-bg-sunken)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        {o.external_id}
                        {editable && u.status === 'open' && (
                          <button
                            className="btn ghost sm icon"
                            style={{ padding: 0, height: 16, width: 16 }}
                            title="Изъять"
                            disabled={busy}
                            onClick={(e) => { e.stopPropagation(); void run(() => removeMpCargoOrder(u.id, o.order_id)) }}
                          >
                            <Icon name="x" size={11} />
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="card" style={{ padding: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-text-subtle)', marginBottom: 8 }}>
            Не уложено <span className="tab-count">{loose.length}</span>
          </div>
          {loose.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--c-text-muted)' }}>
              {packed.length === 0 ? 'Упакованных заказов пока нет.' : 'Все упакованные заказы лежат в грузовых местах.'}
            </div>
          ) : loose.map((o) => (
            <div key={o.order_id} className="row gap-8" style={{ fontSize: 12.5, padding: '4px 0', alignItems: 'center' }}>
              <span className="mono" style={{ fontWeight: 600 }}>{o.external_id}</span>
              <span style={{ color: 'var(--c-text-subtle)', flex: 1 }}>{o.need_qty} шт.</span>
              {!o.label_url && <Badge tone="warning">без этикетки</Badge>}
            </div>
          ))}
          {selected.length > packed.length && (
            <div style={{ fontSize: 12, color: 'var(--c-text-subtle)', marginTop: 8 }}>
              Не упаковано: {selected.length - packed.length} заказ(ов)
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
