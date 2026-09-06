import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  finishMpPacking,
  getMpSupplyPackView,
  MARKETPLACE_LABELS,
  marketplaceTone,
  MP_SUPPLY_STATUS_LABELS,
  mpSupplyStatusTone,
  packMpOrder,
  pushMpOrder,
  registerMpPackScan,
  undoMpPackScan,
  unpackMpOrder,
} from '../../../../api/marketplacesApi'
import type { MpPackOrder, MpPackScanResult, MpSupplyPackView } from '../../../../api/marketplacesApi'
import { resolvePublicUploadSrc } from '../../../../api/constants'
import { useApi } from '../../../../hooks/useApi'
import { useCurrentUser } from '../../../../hooks/useCurrentUser'
import { Badge } from '../../../primitives/Badge'
import { EmptyState } from '../../../primitives/EmptyState'
import { Icon } from '../../../primitives/Icon'
import { Table, Td } from '../../../data/Table'
import { useConfirm } from '../../../feedback/ConfirmDialog'
import { useToast } from '../../../feedback/Toast'
import { openOrderLabel, POPUP_BLOCKED_HINT } from '../../../../utils/qrLabelSheet'
import { cutoffTime } from '../supplyBoard/waves'

type LastScan = { packId: string; label: string; cis: string | null }

function orderTone(o: MpPackOrder): { label: string; tone: 'success' | 'warning' | 'danger' | 'info' | '' } {
  if (!o.packed_at) return o.complete ? { label: 'укомплектован', tone: 'info' } : { label: 'упаковка', tone: '' }
  if (o.mp_error) return { label: 'ошибка площадки', tone: 'danger' }
  if (!o.label_url) return { label: 'ждёт этикетку', tone: 'warning' }
  return { label: 'этикетка', tone: 'success' }
}

/** Станция упаковки FBS-поставки: ПК с принтером этикеток.
 *
 * Слева заказы, справа активный заказ и поле скана (сканер-клавиатура шлёт код и Enter).
 * Каждый скан — единица товара в заказ: ШК варианта или код маркировки «Честный знак».
 * «Заказ упакован» закрывает заказ, собирает отправление на площадке и печатает этикетку.
 */
export function MpSupplyPackStationFeature({ supplyId }: { supplyId: string }) {
  const navigate = useNavigate()
  const toast = useToast()
  const confirm = useConfirm()
  const { user } = useCurrentUser()
  const isManager = user?.role === 'admin' || user?.role === 'manager'
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((n) => n + 1), [])
  const { data, loading, error } = useApi((signal) => getMpSupplyPackView(supplyId, signal), [supplyId, tick])

  const [activeId, setActiveId] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [lastScan, setLastScan] = useState<LastScan | null>(null)
  const [scanError, setScanError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Активный заказ: первый неупакованный, пока человек не выбрал сам.
  useEffect(() => {
    if (!data) return
    if (activeId && data.orders.some((o) => o.order_id === activeId)) return
    const first = data.orders.find((o) => !o.packed_at) ?? data.orders[0] ?? null
    setActiveId(first ? first.order_id : null)
  }, [data, activeId])

  useEffect(() => { inputRef.current?.focus() }, [activeId, busy])

  if (loading && !data) return <div className="page"><EmptyState title="Загрузка…" /></div>
  if (error || !data) {
    return <div className="page"><EmptyState title="Не удалось загрузить" sub={error?.message} /></div>
  }
  const view: MpSupplyPackView = data
  const packing = view.status === 'packing'
  const active = view.orders.find((o) => o.order_id === activeId) ?? null

  const submitScan = async () => {
    const raw = code.trim()
    if (!raw || !active || busy) return
    setBusy(true)
    setScanError('')
    try {
      const res: MpPackScanResult = await registerMpPackScan(supplyId, active.order_id, raw)
      const title = [res.product_name, res.color_name, res.size_name].filter(Boolean).join(' · ')
      setLastScan({ packId: res.pack_id, label: `${title} · ${res.packed_qty}/${res.need_qty}`, cis: res.cis_serial })
      setCode('')
      reload()
    } catch (e) {
      setScanError(e instanceof Error ? e.message : 'Скан не принят')
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  const undo = async () => {
    if (!lastScan || busy) return
    setBusy(true)
    try {
      await undoMpPackScan(supplyId, lastScan.packId)
      setLastScan(null)
      reload()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось отменить скан', 'error')
    } finally {
      setBusy(false)
    }
  }

  const showLabel = (url: string | null) => {
    if (!url) return
    if (!openOrderLabel(resolvePublicUploadSrc(url))) toast(POPUP_BLOCKED_HINT, 'error')
  }

  const pack = async () => {
    if (!active || busy) return
    setBusy(true)
    try {
      const res = await packMpOrder(supplyId, active.order_id)
      if (res.ok) {
        toast(`Заказ ${active.external_id} упакован, этикетка получена`, 'success')
        showLabel(res.label_url)
      } else {
        toast(`Заказ упакован, но площадка ответила ошибкой: ${res.error ?? ''}`, 'error')
      }
      setLastScan(null)
      reload()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось закрыть заказ', 'error')
    } finally {
      setBusy(false)
    }
  }

  const push = async (order: MpPackOrder) => {
    setBusy(true)
    try {
      const res = await pushMpOrder(supplyId, order.order_id)
      if (res.ok) {
        toast('Этикетка получена', 'success')
        showLabel(res.label_url)
      } else {
        toast(res.error ?? 'Площадка ответила ошибкой', 'error')
      }
      reload()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось отправить', 'error')
    } finally {
      setBusy(false)
    }
  }

  const unpack = async (order: MpPackOrder) => {
    const ok = await confirm({
      title: 'Открыть заказ заново?',
      body: `Заказ ${order.external_id} вернётся в упаковку: сканы сохранятся, их можно откатить и уложить заново.`,
      confirmLabel: 'Открыть',
    })
    if (!ok) return
    setBusy(true)
    try {
      await unpackMpOrder(supplyId, order.order_id)
      reload()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось открыть заказ', 'error')
    } finally {
      setBusy(false)
    }
  }

  const finish = async () => {
    if (!view.can_finish) {
      toast(view.blockers.join('; '), 'error')
      return
    }
    const ok = await confirm({
      title: 'Завершить упаковку?',
      body: `Все ${view.orders_total} заказ(ов) упакованы и с этикетками. Поставка ${view.doc_number} уйдёт на передачу: дальше грузовые места.`,
      confirmLabel: 'Завершить',
    })
    if (!ok) return
    setBusy(true)
    try {
      await finishMpPacking(supplyId)
      toast('Упаковка завершена', 'success')
      navigate(`/marketplaces/supplies/${supplyId}/cargo`)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось завершить упаковку', 'error')
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
            <h1 className="page-title" style={{ margin: 0 }}>Станция упаковки · {view.doc_number}</h1>
            <Badge tone={mpSupplyStatusTone(view.status)}>{MP_SUPPLY_STATUS_LABELS[view.status]}</Badge>
            <Badge tone={marketplaceTone(view.marketplace)}>{MARKETPLACE_LABELS[view.marketplace]}</Badge>
            {view.overdue && <Badge tone="danger">просрочено</Badge>}
          </div>
          <div className="page-subtitle">
            {view.account_name}{view.client_name ? ` · ${view.client_name}` : ''}
            {view.cutoff_at ? ` · отсечка ${cutoffTime(view.cutoff_at)}` : ''}
            {view.picker_name ? ` · упаковывает ${view.picker_name}` : ''}
            {isManager && <>{' · '}<Link to={`/marketplaces/supplies/${supplyId}`}>карточка поставки</Link></>}
          </div>
        </div>
        <div className="row gap-8">
          <span className="t-sub" style={{ fontSize: 12.5 }}>
            Упаковано <b>{view.orders_packed}</b> из {view.orders_total} · этикеток {view.orders_labeled}
          </span>
          {packing && (
            <button className="btn primary" disabled={busy} onClick={finish}>
              <Icon name="check" size={14} />Упаковка завершена
            </button>
          )}
        </div>
      </div>

      {!packing && (
        <div className="card" style={{ padding: '10px 14px', marginBottom: 12, fontSize: 12.5, color: 'var(--c-text-muted)' }}>
          Поставка не на упаковке — станция в режиме просмотра.
        </div>
      )}
      {packing && view.blockers.length > 0 && (
        <div className="card" style={{ padding: '10px 14px', marginBottom: 12, fontSize: 12.5, color: 'var(--c-text-muted)' }}>
          До завершения: {view.blockers.join(' · ')}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '300px minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '10px 12px', fontSize: 12, fontWeight: 600, color: 'var(--c-text-subtle)', borderBottom: '1px solid var(--c-border)' }}>
            Заказы
          </div>
          {view.orders.length === 0 && <div style={{ padding: 14 }}><EmptyState title="Заказов нет" /></div>}
          {view.orders.map((o) => {
            const t = orderTone(o)
            const isActive = o.order_id === activeId
            return (
              <button
                key={o.order_id}
                onClick={() => { setActiveId(o.order_id); setScanError(''); setLastScan(null) }}
                style={{
                  display: 'flex', width: '100%', alignItems: 'center', gap: 8, textAlign: 'left',
                  padding: '9px 12px', border: 0, borderBottom: '1px solid var(--c-border)',
                  background: isActive ? 'var(--c-accent-bg)' : 'transparent', cursor: 'pointer',
                  color: 'var(--c-text)',
                }}
              >
                <span className="mono" style={{ fontWeight: 600, fontSize: 12.5, flex: 1 }}>{o.external_id}</span>
                <span className="num" style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>{o.packed_qty}/{o.need_qty}</span>
                <Badge tone={t.tone}>{t.label}</Badge>
              </button>
            )
          })}
        </div>

        <div style={{ minWidth: 0 }}>
          {!active ? (
            <EmptyState title="Выберите заказ" />
          ) : (
            <>
              <div className="card" style={{ padding: 14, marginBottom: 12 }}>
                <div className="row gap-8" style={{ alignItems: 'center', marginBottom: 10 }}>
                  <span className="mono" style={{ fontWeight: 700, fontSize: 16 }}>{active.external_id}</span>
                  <Badge tone={orderTone(active).tone}>{orderTone(active).label}</Badge>
                  {active.cargo_unit_number && <Badge tone="info">в {active.cargo_unit_number}</Badge>}
                  <span style={{ flex: 1 }} />
                  {active.label_url && (
                    <button className="btn sm" onClick={() => showLabel(active.label_url)}>
                      <Icon name="print" size={13} />Этикетка{active.label_barcode ? ` · ${active.label_barcode}` : ''}
                    </button>
                  )}
                  {packing && active.packed_at && (!active.label_url || active.mp_error) && (
                    <button className="btn sm" disabled={busy} onClick={() => push(active)}>
                      <Icon name="refresh" size={13} />Повторить отправку
                    </button>
                  )}
                  {/* У WB отметка «на площадке» стоит и до упаковки — заданием,
                      попавшим в поставку продавца ради ленты этикеток; переложить
                      коробку это не мешает. Необратима только сборка отправления Ozon. */}
                  {packing && active.packed_at
                    && (view.marketplace !== 'ozon' || !active.mp_shipped_at) && (
                    <button className="btn ghost sm" disabled={busy} onClick={() => unpack(active)}>Открыть заново</button>
                  )}
                </div>
                {active.mp_error && (
                  <div style={{ fontSize: 12.5, color: 'var(--c-danger)', marginBottom: 8 }}>
                    <Icon name="alert" size={13} /> {active.mp_error}
                  </div>
                )}

                {packing && !active.packed_at && (
                  <form
                    onSubmit={(e) => { e.preventDefault(); void submitScan() }}
                    className="row gap-8"
                    style={{ alignItems: 'center' }}
                  >
                    <Icon name="barcode" size={18} />
                    <input
                      ref={inputRef}
                      className="input"
                      style={{ flex: 1, fontFamily: 'ui-monospace, monospace' }}
                      placeholder="Скан: штрих-код товара или код маркировки «Честный знак»"
                      value={code}
                      disabled={busy}
                      onChange={(e) => setCode(e.target.value)}
                      autoComplete="off"
                    />
                    <button className="btn" type="submit" disabled={busy || !code.trim()}>Уложить</button>
                    <button
                      className="btn primary"
                      type="button"
                      disabled={busy || !active.complete}
                      onClick={pack}
                      title={active.complete ? '' : 'Сначала уложите весь состав заказа'}
                    >
                      <Icon name="check" size={13} />Заказ упакован
                    </button>
                  </form>
                )}
                {scanError && (
                  <div style={{ fontSize: 12.5, color: 'var(--c-danger)', marginTop: 8 }}>
                    <Icon name="alert" size={13} /> {scanError}
                  </div>
                )}
                {lastScan && packing && !active.packed_at && (
                  <div className="row gap-8" style={{ marginTop: 8, fontSize: 12.5, color: 'var(--c-text-muted)', alignItems: 'center' }}>
                    <span>Уложено: {lastScan.label}{lastScan.cis ? ` · КИЗ …${lastScan.cis.slice(-6)}` : ''}</span>
                    <button className="btn ghost sm" disabled={busy} onClick={undo}>
                      <Icon name="refresh" size={12} />Отменить
                    </button>
                  </div>
                )}
              </div>

              <Table>
                <thead>
                  <tr>
                    <th style={{ width: 110 }}>Артикул</th>
                    <th>Товар</th>
                    <th style={{ width: 150 }}>Цвет / размер</th>
                    <th style={{ width: 90, textAlign: 'right' }}>Нужно</th>
                    <th style={{ width: 90, textAlign: 'right' }}>Уложено</th>
                  </tr>
                </thead>
                <tbody>
                  {active.lines.map((l) => {
                    const done = l.linked && l.packed_qty >= l.need_qty
                    return (
                      <tr key={l.line_id} style={done ? { opacity: 0.6 } : undefined}>
                        <Td className="mono" style={{ color: 'var(--c-text-muted)' }}>{l.product_sku ?? l.offer_id ?? '—'}</Td>
                        <Td>
                          {l.product_name ?? '—'}
                          {!l.linked && <Badge tone="danger" style={{ marginLeft: 6 }}>не связан</Badge>}
                        </Td>
                        <Td style={{ color: 'var(--c-text-muted)' }}>
                          {[l.color_name, l.size_name].filter(Boolean).join(' / ') || '—'}
                        </Td>
                        <Td className="num" style={{ textAlign: 'right' }}>{l.need_qty}</Td>
                        <Td className="num" style={{ textAlign: 'right', fontWeight: 600, color: done ? 'var(--c-success)' : 'var(--c-text)' }}>
                          {l.packed_qty}
                        </Td>
                      </tr>
                    )
                  })}
                </tbody>
              </Table>
            </>
          )}

          <div style={{ marginTop: 16, fontSize: 12, fontWeight: 600, color: 'var(--c-text-subtle)', marginBottom: 6 }}>
            Стол: собрано по позициям
          </div>
          <Table>
            <thead>
              <tr>
                <th>Товар</th>
                <th style={{ width: 150 }}>Цвет / размер</th>
                <th style={{ width: 90, textAlign: 'right' }}>Собрано</th>
                <th style={{ width: 90, textAlign: 'right' }}>Уложено</th>
                <th style={{ width: 100, textAlign: 'right' }}>На столе</th>
              </tr>
            </thead>
            <tbody>
              {view.table.map((t) => (
                <tr key={t.variant_id}>
                  <Td>{t.product_name ?? '—'} <span className="mono" style={{ color: 'var(--c-text-subtle)', fontSize: 11.5 }}>{t.product_sku ?? ''}</span></Td>
                  <Td style={{ color: 'var(--c-text-muted)' }}>{[t.color_name, t.size_name].filter(Boolean).join(' / ') || '—'}</Td>
                  <Td className="num" style={{ textAlign: 'right' }}>{t.picked_qty}</Td>
                  <Td className="num" style={{ textAlign: 'right' }}>{t.packed_qty}</Td>
                  <Td className="num" style={{ textAlign: 'right', fontWeight: 600, color: t.on_table_qty > 0 ? 'var(--c-warning)' : 'var(--c-text-subtle)' }}>
                    {t.on_table_qty}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </div>
    </div>
  )
}
