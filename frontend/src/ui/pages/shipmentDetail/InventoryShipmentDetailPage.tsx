import { useState, useEffect, useCallback, Fragment } from 'react'
import type React from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  getShipment,
  advanceShipment,
  deleteShipment,
  cancelShipment,
  addShipmentLine,
  updateShipmentLine,
  updateShipment,
  deleteShipmentLine,
  SHIPMENT_STATUS_LABELS,
  SHIPMENT_STATUS_TONES,
} from '../../../api/shipmentsApi'
import type { ShipmentDetail, ShipmentStatus, ShipmentCargoType, ShipmentLine } from '../../../api/shipmentsApi'
import { getBalances, getBalancesByZone } from '../../../api/balancesApi'
import type { BalanceItem } from '../../../api/balancesApi'
import { ShipmentStepper } from '../../features/inventory/ShipmentStepper'
import { Badge } from '../../primitives/Badge'
import type { BadgeTone } from '../../primitives/Badge'
import { Icon } from '../../primitives/Icon'
import { Alert } from '../../primitives/Alert'
import { EmptyState } from '../../primitives/EmptyState'
import { useConfirm } from '../../feedback/ConfirmDialog'
import { Combobox } from '../../data/Combobox'
import { DatePicker } from '../../primitives/DatePicker'
import { Field } from '../../primitives/Input'
import { fmtDateLong } from '../../../utils/format'
import { useLookups } from '../../../hooks/useLookups'
import { balanceKey } from '../../../utils/balanceKey'
import { BalancePicker } from '../../features/inventory/shared/BalancePicker'
import { NumberStep } from '../../features/inventory/shared/NumberStep'
import { CargoTypeDisplay } from './components/CargoTypeDisplay'
import { OpEntry } from './components/OpEntry'
import { ZoneAllocationEditor } from './components/ZoneAllocationEditor'
import { lineAvailable } from './shared/opLabels'

type EditableShipmentLine = ShipmentLine & { _key: string; available: number }
type LineDraft = { qty: number }

export function InventoryShipmentDetailPage() {
  const { docId } = useParams<{ docId: string }>()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const [doc, setDoc] = useState<ShipmentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [acting, setActing] = useState(false)
  const [showBlockReasons, setShowBlockReasons] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [balances, setBalances] = useState<BalanceItem[]>([])
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})

  const today = new Date().toISOString().slice(0, 10)

  const { warehouses: infoWarehouses, carriers: infoCarriers, unloadingZones } = useLookups()
  const storageZones = unloadingZones.filter((z) => z.is_active && !z.is_deleted)

  // Доступный годный остаток по зонам: balanceKey(line) → { zoneId: qty }. '' = без зоны.
  const [zoneAvail, setZoneAvail] = useState<Record<string, Record<string, number>>>({})
  const [expandedZones, setExpandedZones] = useState<Record<string, boolean>>({})

  // Info form state (used when status === 'packing')
  const [infoClientId, setInfoClientId] = useState<string | null>(null)
  const [infoClientName, setInfoClientName] = useState<string | null>(null)
  const [infoDestinationName, setInfoDestinationName] = useState<string | null>(null)
  const [infoCarrierName, setInfoCarrierName] = useState<string | null>(null)
  const [infoShipDate, setInfoShipDate] = useState('')
  const [infoLogisticsCost, setInfoLogisticsCost] = useState('')
  const [infoComment, setInfoComment] = useState('')
  const [infoSaving, setInfoSaving] = useState(false)
  const [infoSaved, setInfoSaved] = useState(false)
  const [infoDirty, setInfoDirty] = useState(false)

  // Sync form when doc loads
  useEffect(() => {
    if (!doc) return
    setInfoClientId(doc.client_id ?? null)
    setInfoClientName(doc.client_name ?? null)
    setInfoDestinationName(doc.destination ?? null)
    setInfoCarrierName(doc.carrier ?? null)
    setInfoShipDate(doc.ship_date ?? '')
    setInfoLogisticsCost(doc.logistics_cost != null ? String(doc.logistics_cost) : '')
    setInfoComment(doc.comment ?? '')
    setInfoDirty(false)
  }, [doc])

  const load = useCallback(async () => {
    if (!docId) return
    setLoading(true)
    try {
      setDoc(await getShipment(docId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }, [docId])

  useEffect(() => { load() }, [load])

  async function handleInfoSave() {
    if (!docId) return
    setInfoSaving(true)
    setError('')
    try {
      await updateShipment(docId, {
        client_id:      infoClientId,
        client_name:    infoClientName,
        destination:    infoDestinationName || null,
        carrier:        infoCarrierName || null,
        ship_date:      infoShipDate || null,
        logistics_cost: infoLogisticsCost ? parseFloat(infoLogisticsCost) : null,
        comment:        infoComment || null,
      })
      await load()
      setInfoDirty(false)
      setInfoSaved(true)
      setTimeout(() => setInfoSaved(false), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setInfoSaving(false)
    }
  }

  const status = doc?.status as ShipmentStatus | undefined
  const isPlanned = status === 'packing'
  const isReady = status === 'ready'
  const isEditable = isPlanned || isReady

  const shipmentClientId = doc?.client_id ?? null
  const shipmentCargoType = doc?.cargo_type

  const loadBalances = useCallback(async () => {
    if (!shipmentClientId || !isEditable) {
      setBalances([])
      return
    }
    const res = await getBalances({
      limit: 200,
      only_positive: true,
      client_id: shipmentClientId,
      has_defect: shipmentCargoType === 'defect' ? true : undefined,
    })
    setBalances(res.items.filter((b) => shipmentCargoType === 'defect' ? b.defect > 0 : b.good > 0))
  }, [shipmentClientId, shipmentCargoType, isEditable])

  useEffect(() => {
    loadBalances().catch(() => {})
  }, [loadBalances])

  const loadZoneBalances = useCallback(async () => {
    if (!shipmentClientId || !isEditable || shipmentCargoType !== 'good') {
      setZoneAvail({})
      return
    }
    const res = await getBalancesByZone({ client_id: shipmentClientId })
    const map: Record<string, Record<string, number>> = {}
    for (const item of res.items) {
      if (item.status !== 'good' || item.qty <= 0) continue
      const key = balanceKey(item)
      const zoneId = item.location_id ?? ''
      ;(map[key] ??= {})[zoneId] = item.qty
    }
    setZoneAvail(map)
  }, [shipmentClientId, shipmentCargoType, isEditable])

  useEffect(() => {
    loadZoneBalances().catch(() => {})
  }, [loadZoneBalances])

  useEffect(() => {
    if (!doc) {
      setDrafts({})
      return
    }
    const next: Record<string, LineDraft> = {}
    for (const line of doc.lines) {
      next[line.id] = { qty: line.qty }
    }
    setDrafts(next)
  }, [doc])

  async function act(fn: () => Promise<unknown>, redirectAfter?: string) {
    setActing(true)
    setError('')
    try {
      await fn()
      if (redirectAfter) navigate(redirectAfter)
      else await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setActing(false)
    }
  }

  const editableLines: EditableShipmentLine[] = doc
    ? doc.lines.map((line) => ({
        ...line,
        _key: balanceKey(line),
        available: lineAvailable(line, balances, doc.cargo_type as ShipmentCargoType),
      }))
    : []

  function getDraft(line: ShipmentLine): LineDraft {
    return drafts[line.id] ?? { qty: line.qty }
  }

  function setDraftQty(lineId: string, value: number) {
    setDrafts((prev) => ({
      ...prev,
      [lineId]: { qty: Math.max(1, Number.isFinite(value) ? value : 1) },
    }))
  }

  const hasOverflow = editableLines.some((line) => getDraft(line).qty > line.available)
  const hasUnsavedLineChanges = editableLines.some((line) => getDraft(line).qty !== line.qty)

  const advanceChecks = [
    {
      ok: (doc?.lines.length ?? 0) > 0,
      error: 'Добавьте хотя бы одну строку в отгрузку',
    },
    {
      ok: doc?.lines.every((line) => getDraft(line).qty >= 1) ?? false,
      error: 'Проверьте количество: в каждой строке должно быть не меньше 1 шт',
    },
    {
      ok: !hasOverflow,
      error: 'Уменьшите количество в строках, где запрошено больше доступного остатка',
    },
    {
      ok: !hasUnsavedLineChanges,
      error: 'Сохраните изменения в строках отгрузки перед началом сборки',
    },
  ]
  const advanceBlockReasons = status === 'draft' || status === 'packing'
    ? advanceChecks.filter((check) => !check.ok).map((check) => check.error)
    : []

  async function refreshAfterLineChange() {
    await load()
    await loadBalances()
    await loadZoneBalances()
  }

  async function handleAddLine(item: BalanceItem, qty: number) {
    if (!docId) return
    await act(async () => {
      await addShipmentLine(docId, {
        product_id: item.product_id,
        product_name: item.product_name,
        product_sku: item.product_sku,
        color_id: item.color_id,
        color_name: item.color_name,
        size_id: item.size_id,
        size_name: item.size_name,
        qty,
      })
      await refreshAfterLineChange()
      setShowPicker(false)
    })
  }

  async function handleSaveQty(line: ShipmentLine) {
    if (!docId) return
    const draft = getDraft(line)
    setSaving((prev) => ({ ...prev, [line.id]: true }))
    try {
      await updateShipmentLine(docId, line.id, {
        product_id: line.product_id,
        product_name: line.product_name,
        product_sku: line.product_sku,
        color_id: line.color_id,
        color_name: line.color_name,
        size_id: line.size_id,
        size_name: line.size_name,
        qty: draft.qty,
      })
      await refreshAfterLineChange()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setSaving((prev) => ({ ...prev, [line.id]: false }))
    }
  }

  async function handleDeleteLine(lineId: string) {
    if (!docId) return
    const ok = await confirm({
      title: 'Удалить товар из отгрузки?',
      body: 'Строка будет удалена из состава отгрузки. Это действие можно отменить только добавив товар заново.',
      danger: true,
      confirmLabel: 'Удалить',
    })
    if (!ok) return
    await act(async () => {
      await deleteShipmentLine(docId, lineId)
      await refreshAfterLineChange()
    })
  }

  function handleAdvanceClick() {
    if (advanceBlockReasons.length > 0) {
      setShowBlockReasons(true)
      return
    }
    setShowBlockReasons(false)
    void act(() => advanceShipment(docId!))
  }

  async function handleCancel() {
    const ok = await confirm({
      title: 'Аннулировать отгрузку?',
      body: 'Отгрузка будет аннулирована. Это действие нельзя отменить.',
      danger: true,
      confirmLabel: 'Аннулировать',
    })
    if (!ok) return
    await act(() => cancelShipment(docId!), '/inventory/shipments')
  }

  const allLinesAllocated =
    doc?.cargo_type !== 'good' ||
    (doc?.lines ?? []).every((line) => line.zones.reduce((s, z) => s + z.qty, 0) === line.qty)

  const shipChecks = [
    { ok: !!infoClientId,        error: 'Укажите клиента' },
    { ok: !!infoDestinationName, error: 'Укажите назначение' },
    { ok: !!infoShipDate,        error: 'Укажите дату отгрузки' },
    { ok: !(infoShipDate && infoShipDate > today), error: 'Дата отгрузки не может быть в будущем' },
    { ok: !!infoCarrierName,     error: 'Укажите перевозчика' },
    { ok: !!infoLogisticsCost,   error: 'Укажите стоимость логистики' },
    { ok: !hasOverflow,          error: 'Количество товара в некоторых строках превышает доступный остаток' },
    { ok: allLinesAllocated,     error: 'Распределите все строки по зонам хранения' },
  ]
  const shipBlockReasons = shipChecks.filter((c) => !c.ok).map((c) => c.error)

  async function handleShipClick() {
    if (shipBlockReasons.length > 0) {
      setShowBlockReasons(true)
      return
    }
    setShowBlockReasons(false)
    await act(async () => {
      const changed =
        infoCarrierName !== (doc?.carrier ?? '') ||
        infoShipDate    !== (doc?.ship_date ?? '') ||
        infoDestinationName !== (doc?.destination ?? '') ||
        (infoLogisticsCost ? parseFloat(infoLogisticsCost) : null) !== doc?.logistics_cost
      if (changed) {
        await updateShipment(docId!, {
          carrier:        infoCarrierName || null,
          ship_date:      infoShipDate || null,
          destination:    infoDestinationName || null,
          logistics_cost: infoLogisticsCost ? parseFloat(infoLogisticsCost) : null,
        })
      }
      await advanceShipment(docId!)
    })
  }

  if (loading) {
    return (
      <div className="page">
        <div style={{ padding: '80px 0', textAlign: 'center', color: 'var(--c-text-subtle)' }}>Загрузка…</div>
      </div>
    )
  }

  if (error || !doc) {
    return (
      <div className="page">
        <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--c-danger)' }}>
          {error || 'Документ не найден'}
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="detail-status-row">
            <button className="btn ghost icon sm" onClick={() => navigate('/inventory/shipments')}>
              <Icon name="arrowLeft" size={14} />
            </button>
            <Badge tone={SHIPMENT_STATUS_TONES[status!] as BadgeTone} dot>
              {SHIPMENT_STATUS_LABELS[status!]}
            </Badge>
            <span className="detail-meta">
              {doc.doc_number} · {doc.client_name ?? '—'}
            </span>
          </div>
          <div className="page-title">{doc.doc_number}</div>
        </div>

        <div className="detail-actions">
          <div className="detail-actions-row">
            {isEditable && infoDirty && (
              <button className="btn" disabled={infoSaving || acting} onClick={() => { void handleInfoSave() }}>
                <Icon name="save" size={14} />Сохранить изменения
              </button>
            )}
            {status === 'draft' && (
              <button className="btn ghost" disabled={acting} onClick={() => act(() => deleteShipment(docId!), '/inventory/shipments')}>
                <Icon name="trash" size={14} />Удалить
              </button>
            )}
            {status === 'draft' && (
              <button className="btn primary" disabled={acting} onClick={handleAdvanceClick}>
                <Icon name="arrowRight" size={14} />Запланировать
              </button>
            )}
            {status === 'packing' && (
              <button className="btn ghost danger" disabled={acting} onClick={handleCancel}>
                <Icon name="x" size={14} />Аннулировать
              </button>
            )}
            {status === 'packing' && (
              <button className="btn primary" disabled={acting} onClick={handleAdvanceClick}>
                <Icon name="check" size={14} />Начать сборку
              </button>
            )}
            {status === 'ready' && (
              <button className="btn primary" disabled={acting} onClick={handleShipClick}>
                <Icon name="arrowRight" size={14} />Отправить
              </button>
            )}
          </div>
          {showBlockReasons && (advanceBlockReasons.length > 0 || shipBlockReasons.length > 0) && (
            <div className="block-reasons">
              {(isReady ? shipBlockReasons : advanceBlockReasons).map((reason, index) => (
                <div key={index}>— {reason}</div>
              ))}
            </div>
          )}
        </div>
      </div>

      <ShipmentStepper status={status!} ops={doc.ops} style={{ marginTop: -10 }} />

      {hasOverflow && isEditable && (
        <Alert tone="warning" style={{ marginBottom: 14 }}>
          <span style={{ fontWeight: 500 }}>В некоторых строках указано больше, чем доступно по остатку.</span>
        </Alert>
      )}

      {error && (
        <Alert tone="danger" icon={false} style={{ marginBottom: 16 }}>{error}</Alert>
      )}

      <div className="split-360">
        <div className="col gap-16">
          <div className="card">
            <div className="card-head">
              <Icon name="file" size={15} className="ic-accent" />
              <div className="card-head-title">Основная информация</div>
              {isEditable && infoSaved && (
                <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--c-success)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Icon name="check" size={12} />Сохранено
                </span>
              )}
            </div>
            {isEditable ? (
              <div className="card-body">
                <CargoTypeDisplay value={doc.cargo_type as ShipmentCargoType} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 16 }}>
                  <Field label="Клиент">
                    <div className="input" style={{ background: 'var(--c-bg-sunken)', color: 'var(--c-text-muted)', cursor: 'default' }}>
                      {doc.client_name ?? '—'}
                    </div>
                  </Field>
                  <Field label="Назначение" required>
                    <Combobox
                      value={infoDestinationName}
                      onChange={(val, opt) => { setInfoDestinationName(opt?.label ?? (val ? String(val) : null)); setInfoDirty(true) }}
                      options={infoWarehouses.map((w) => ({ value: w.name, label: w.name }))}
                      placeholder="Выберите назначение…"
                      clearable
                    />
                  </Field>
                  <Field label="Дата отгрузки" required>
                    <DatePicker value={infoShipDate} onChange={(v) => { setInfoShipDate(v); setInfoDirty(true) }} />
                  </Field>
                  <Field label="Перевозчик" required>
                    <Combobox
                      value={infoCarrierName}
                      onChange={(val, opt) => { setInfoCarrierName(opt?.label ?? (val ? String(val) : null)); setInfoDirty(true) }}
                      options={infoCarriers.map((c) => ({ value: c.name, label: c.name }))}
                      placeholder="Выберите перевозчика…"
                      clearable
                    />
                  </Field>
                  <Field label="Стоимость логистики" required>
                    <input
                      className="input"
                      type="number"
                      min={0}
                      step={0.01}
                      value={infoLogisticsCost}
                      onChange={(e) => { setInfoLogisticsCost(e.target.value); setInfoDirty(true) }}
                      placeholder="0.00"
                    />
                  </Field>
                </div>
                <Field label="Инструкции для сборки" style={{ marginTop: 14 }}>
                  <textarea
                    className="input"
                    style={{ height: 60, paddingTop: 8, paddingBottom: 8, resize: 'vertical' }}
                    value={infoComment}
                    onChange={(e) => { setInfoComment(e.target.value); setInfoDirty(true) }}
                    placeholder="Необязательно"
                  />
                </Field>
              </div>
            ) : (
              <div style={{ padding: '12px 16px' }}>
                <CargoTypeDisplay value={doc.cargo_type as ShipmentCargoType} />
                <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', rowGap: 10, columnGap: 16, fontSize: 13, marginTop: 14 }}>
                  <span style={{ color: 'var(--c-text-muted)' }}>Клиент</span>
                  <span>{doc.client_name ?? '—'}</span>
                  <span style={{ color: 'var(--c-text-muted)' }}>Назначение</span>
                  <span>{doc.destination ?? '—'}</span>
                  <span style={{ color: 'var(--c-text-muted)' }}>Перевозчик</span>
                  <span>{doc.carrier ?? '—'}</span>
                  {doc.logistics_cost != null && (
                    <>
                      <span style={{ color: 'var(--c-text-muted)' }}>Стоимость логистики</span>
                      <span className="mono">{doc.logistics_cost.toLocaleString()}</span>
                    </>
                  )}
                  <span style={{ color: 'var(--c-text-muted)' }}>Дата отгрузки</span>
                  <span>{fmtDateLong(doc.ship_date)}</span>
                  {doc.comment && (
                    <>
                      <span style={{ color: 'var(--c-text-muted)' }}>Инструкции</span>
                      <span style={{ whiteSpace: 'pre-wrap' }}>{doc.comment}</span>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-head">
              <Icon name="boxes" size={15} className="ic-accent" />
              <div className="card-head-title">Состав отгрузки</div>
              {doc.lines.length > 0 && (
                <span className="badge accent" style={{ marginLeft: 6 }}>{doc.lines.length}</span>
              )}
              {isEditable && (
                <div className="right">
                  <button className="btn sm primary" onClick={() => setShowPicker(true)} disabled={acting || !doc.client_id}>
                    <Icon name="plus" size={12} />Добавить товар
                  </button>
                </div>
              )}
            </div>
            {doc.lines.length === 0 ? (
              <div style={{ padding: '32px 0' }}>
                <EmptyState
                  title="Состав пуст"
                  sub={isEditable ? 'Добавьте товар из остатков, чтобы запланировать отгрузку' : 'Нет позиций'}
                />
              </div>
            ) : (
              <table className="t">
                <thead>
                  <tr>
                    <th style={{ width: 30 }}>#</th>
                    <th>Товар · вариант</th>
                    {isEditable && <th style={{ textAlign: 'right', width: 90 }}>Доступно</th>}
                    <th style={{ textAlign: 'right', width: isEditable ? 160 : 90 }}>К отгрузке</th>
                    {isEditable && <th style={{ width: 68 }} />}
                  </tr>
                </thead>
                <tbody>
                  {editableLines.map((line, i) => {
                    const draft = getDraft(line)
                    const isSaving = saving[line.id] ?? false
                    const hasDraftChange = draft.qty !== line.qty
                    const over = isEditable && draft.qty > line.available
                    const isGood = doc.cargo_type === 'good'
                    const allocated = line.zones.reduce((s, z) => s + z.qty, 0)
                    const zoneOk = line.zones.length > 0 && allocated === line.qty
                    const expanded = expandedZones[line.id] ?? false
                    return (
                      <Fragment key={line.id}>
                      <tr style={over ? { background: 'var(--c-warning-bg)' } : {}}>
                        <td><span className="mono" style={{ color: 'var(--c-text-faint)', fontSize: 11 }}>{i + 1}</span></td>
                        <td>
                          <div style={{ fontWeight: 450 }}>{line.product_name}</div>
                          <div className="t-sub mono">{[line.product_sku, line.color_name, line.size_name].filter(Boolean).join(' · ')}</div>
                        </td>
                        {isEditable && (
                          <td className="num" style={{ color: 'var(--c-success)', fontWeight: 500 }}>{line.available}</td>
                        )}
                        <td className="num">
                          {isEditable ? (
                            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6 }}>
                              <NumberStep value={draft.qty} onChange={(qty) => setDraftQty(line.id, qty)} disabled={acting || isSaving} />
                              {over && <Icon name="alert" size={13} style={{ color: 'var(--c-warning)' }} />}
                            </div>
                          ) : (
                            <span className="mono" style={{ fontWeight: 600, fontSize: 14 }}>{line.qty}</span>
                          )}
                        </td>
                        {isEditable && (
                          <td>
                            <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                              <button
                                className="btn ghost icon sm"
                                style={{ width: 28, height: 28, visibility: hasDraftChange ? 'visible' : 'hidden', pointerEvents: hasDraftChange ? undefined : 'none' }}
                                title="Сохранить количество"
                                disabled={!hasDraftChange || acting || isSaving || over}
                                onClick={() => { if (hasDraftChange) void handleSaveQty(line) }}
                                aria-hidden={!hasDraftChange}
                                tabIndex={hasDraftChange ? 0 : -1}
                              >
                                <Icon name="save" size={13} />
                              </button>
                              <button className="btn ghost icon sm" disabled={acting || isSaving} onClick={() => { void handleDeleteLine(line.id) }}>
                                <Icon name="trash" size={13} />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                      {isEditable && isGood && (
                        <tr>
                          <td colSpan={5} style={{ paddingTop: 0, paddingBottom: 0, background: 'var(--c-bg-sunken)' }}>
                            <button
                              className="btn ghost sm"
                              style={{ color: zoneOk ? 'var(--c-success)' : 'var(--c-warning)' }}
                              onClick={() => setExpandedZones((prev) => ({ ...prev, [line.id]: !expanded }))}
                            >
                              <Icon name={zoneOk ? 'check' : 'alert'} size={12} />
                              {zoneOk
                                ? `Зоны распределены (${line.zones.map((z) => `${z.storage_zone_name ?? 'без зоны'} · ${z.qty}`).join(', ')})`
                                : `Распределите по зонам (${allocated} из ${line.qty})`}
                              <Icon name="chev" size={12} style={{ transform: expanded ? 'rotate(180deg)' : 'none' }} />
                            </button>
                            {expanded && (
                              <ZoneAllocationEditor
                                docId={docId!}
                                line={line}
                                zoneOptions={storageZones.map((z) => ({ id: z.id, name: z.name }))}
                                available={zoneAvail[balanceKey(line)] ?? {}}
                                disabled={acting}
                                onSaved={refreshAfterLineChange}
                              />
                            )}
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="sum">
                    <td colSpan={isEditable ? 3 : 2}>Итого: {doc.lines.length} SKU</td>
                    <td className="num">{doc.total_qty}</td>
                    {isEditable && <td />}
                  </tr>
                </tfoot>
              </table>
            )}
          </div>

        </div>

        <div className="col gap-16">
          <div className="card">
            <div className="card-head">
              <Icon name="chart" size={15} className="ic-accent" />
              <div className="card-head-title">Итого</div>
            </div>
            <div className="totals-grid">
              <span className="key">SKU</span>
              <span className="val mono">{doc.sku_count}</span>
              <span className="key">Кол-во</span>
              <span className="val mono" style={{ fontWeight: 500, fontSize: 14 }}>{doc.total_qty}</span>
            </div>
          </div>

          <div className="card ops-card" style={{ maxHeight: 'calc(100vh - 220px)' }}>
            <div className="card-head">
              <Icon name="layers" size={15} className="ic-accent" />
              <span className="card-head-title">Журнал операций</span>
              <Badge tone="accent" style={{ marginLeft: 6 } as React.CSSProperties}>{doc.ops.length}</Badge>
            </div>

            <div className="ops-card-body">
              {doc.ops.length === 0 ? (
                <div className="ops-card-empty">Нет операций</div>
              ) : (
                <div className="ops-timeline">
                  {doc.ops.map((op) => (
                    <OpEntry key={op.id} op={op} />
                  ))}
                </div>
              )}
            </div>

            <div className="ops-card-foot">
              <Icon name="shield" size={11} />
              <span>Журнал операций не редактируется.</span>
            </div>
          </div>
        </div>
      </div>

      {showPicker && (
        <BalancePicker
          clientId={doc.client_id}
          cargoType={doc.cargo_type as ShipmentCargoType}
          selectedKeys={editableLines.map((line) => line._key)}
          onAdd={(item, qty) => { void handleAddLine(item, qty) }}
          onClose={() => setShowPicker(false)}
        />
      )}

    </div>
  )
}
