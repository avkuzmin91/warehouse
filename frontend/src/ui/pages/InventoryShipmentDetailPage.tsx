import { useState, useEffect, useCallback } from 'react'
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
} from '../../api/shipmentsApi'
import type { ShipmentDetail, ShipmentStatus, ShipmentCargoType, ShipmentOp, ShipmentLine } from '../../api/shipmentsApi'
import { getBalances } from '../../api/balancesApi'
import type { BalanceItem } from '../../api/balancesApi'
import { ShipmentStepper } from '../features/inventory/ShipmentStepper'
import { Badge } from '../primitives/Badge'
import { Icon } from '../primitives/Icon'
import { Avatar, getInitials } from '../primitives/Avatar'
import { EmptyState } from '../primitives/EmptyState'
import { useConfirm } from '../feedback/ConfirmDialog'
import { Combobox } from '../data/Combobox'
import { DatePicker } from '../primitives/DatePicker'
import { Field } from '../primitives/Input'
import { getInventoryCarriers, getInventoryWarehouses } from '../../api/inventoryLookupsApi'
import type { DictionaryItem } from '../../api/domainTypes'

type EditableShipmentLine = ShipmentLine & { _key: string; available: number }
type LineDraft = { qty: number }

function fmtDate(s: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

function fmtDateTime(s: string) {
  return new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function balanceKey(item: Pick<ShipmentLine, 'product_id' | 'color_id' | 'size_id'>) {
  return `${item.product_id}__${item.color_id ?? ''}__${item.size_id ?? ''}`
}

function lineAvailable(line: ShipmentLine, balances: BalanceItem[], cargoType: ShipmentCargoType) {
  const matched = balances.find((b) => balanceKey(b) === balanceKey(line))
  if (!matched) return line.qty
  return cargoType === 'defect' ? matched.defect : matched.good
}

const OP_LABELS: Record<string, string> = {
  doc_create: 'Документ создан',
  doc_update: 'Документ изменён',
  advance: 'Переход на следующий этап',
  revert: 'Возврат на предыдущий этап',
  cancel: 'Аннулирован',
}

const OP_ICONS: Record<string, string> = {
  doc_create: 'plus',
  doc_update: 'edit',
  advance: 'arrowRight',
  revert: 'arrowLeft',
  cancel: 'x',
}

const OP_TONES: Record<string, string> = {
  doc_create: 'accent',
  doc_update: '',
  advance: 'success',
  revert: 'warning',
  cancel: 'danger',
}

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

  // Info form state (used when status === 'packing')
  const [infoWarehouses, setInfoWarehouses] = useState<DictionaryItem[]>([])
  const [infoCarriers, setInfoCarriers] = useState<DictionaryItem[]>([])
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

  useEffect(() => {
    getInventoryWarehouses().then(setInfoWarehouses).catch(() => {})
    getInventoryCarriers().then(setInfoCarriers).catch(() => {})
  }, [])

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
  }, [doc?.id]) // only on doc load, not every re-render

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

  const loadBalances = useCallback(async () => {
    if (!doc?.client_id || !isEditable) {
      setBalances([])
      return
    }
    const res = await getBalances({
      limit: 200,
      only_positive: true,
      client_id: doc.client_id,
      has_defect: doc.cargo_type === 'defect' ? true : undefined,
    })
    setBalances(res.items.filter((b) => doc.cargo_type === 'defect' ? b.defect > 0 : b.good > 0))
  }, [doc?.client_id, doc?.cargo_type, isEditable])

  useEffect(() => {
    loadBalances().catch(() => {})
  }, [loadBalances])

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
  }

  async function handleAddLine(item: BalanceItem) {
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
        qty: 1,
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

  const shipChecks = [
    { ok: !!infoClientId,        error: 'Укажите клиента' },
    { ok: !!infoDestinationName, error: 'Укажите назначение' },
    { ok: !!infoShipDate,        error: 'Укажите дату отгрузки' },
    { ok: !(infoShipDate && infoShipDate > today), error: 'Дата отгрузки не может быть в будущем' },
    { ok: !!infoCarrierName,     error: 'Укажите перевозчика' },
    { ok: !!infoLogisticsCost,   error: 'Укажите стоимость логистики' },
    { ok: !hasOverflow,          error: 'Количество товара в некоторых строках превышает доступный остаток' },
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
          <div style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
            <button className="btn ghost icon sm" onClick={() => navigate('/inventory/shipments')}>
              <Icon name="arrowLeft" size={14} />
            </button>
            <Badge tone={SHIPMENT_STATUS_TONES[status!] as any} dot>
              {SHIPMENT_STATUS_LABELS[status!]}
            </Badge>
            <span style={{ fontSize: 11.5, color: 'var(--c-text-subtle)' }}>
              {doc.doc_number} · {doc.client_name ?? '—'}
            </span>
          </div>
          <div className="page-title">{doc.doc_number}</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          <div style={{ display: 'flex', gap: 8 }}>
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
            <div style={{ fontSize: 12, color: 'var(--c-danger)', textAlign: 'right', lineHeight: 1.5 }}>
              {(isReady ? shipBlockReasons : advanceBlockReasons).map((reason, index) => (
                <div key={index}>— {reason}</div>
              ))}
            </div>
          )}
        </div>
      </div>

      <ShipmentStepper status={status!} ops={doc.ops} style={{ marginTop: -10 }} />

      {hasOverflow && isEditable && (
        <div style={{
          padding: '10px 14px', marginBottom: 14,
          background: 'var(--c-warning-bg)', color: 'var(--c-warning)',
          border: '1px solid #ead1a3', borderRadius: 'var(--r-md)',
          display: 'flex', alignItems: 'center', gap: 10, fontSize: 13,
        }}>
          <Icon name="alert" size={15} />
          <span style={{ fontWeight: 500 }}>В некоторых строках указано больше, чем доступно по остатку.</span>
        </div>
      )}

      {error && (
        <div style={{
          padding: '10px 14px', marginBottom: 16,
          background: 'color-mix(in oklab, var(--c-danger) 10%, transparent)',
          border: '1px solid color-mix(in oklab, var(--c-danger) 30%, transparent)',
          borderRadius: 'var(--r-md)', color: 'var(--c-danger)', fontSize: 13,
        }}>{error}</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 20, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card">
            <div className="card-head">
              <Icon name="file" size={15} style={{ color: 'var(--c-accent)' }} />
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
                  <span>{fmtDate(doc.ship_date)}</span>
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
              <Icon name="boxes" size={15} style={{ color: 'var(--c-accent)' }} />
              <div className="card-head-title">Состав отгрузки</div>
              {doc.lines.length > 0 && (
                <span className="badge accent" style={{ marginLeft: 6 }}>{doc.lines.length}</span>
              )}
              {isEditable && (
                <div style={{ marginLeft: 'auto' }}>
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
                    <th style={{ textAlign: 'right', width: isEditable ? 160 : 90 }}>Кол-во</th>
                    {isEditable && <th style={{ width: 32 }} />}
                  </tr>
                </thead>
                <tbody>
                  {editableLines.map((line, i) => {
                    const draft = getDraft(line)
                    const isSaving = saving[line.id] ?? false
                    const hasDraftChange = draft.qty !== line.qty
                    const over = isEditable && draft.qty > line.available
                    return (
                      <tr key={line.id} style={over ? { background: 'var(--c-warning-bg)' } : {}}>
                        <td><span className="mono" style={{ color: 'var(--c-text-faint)', fontSize: 11 }}>{i + 1}</span></td>
                        <td>
                          <div style={{ fontWeight: 450 }}>{line.product_name}</div>
                          <div className="t-sub mono">{[line.product_sku, line.color_name, line.size_name].filter(Boolean).join(' · ')}</div>
                        </td>
                        {isEditable && (
                          <td className="num" style={{ color: 'var(--c-success)', fontWeight: 500 }}>{line.available}</td>
                        )}
                        <td className="num" style={{ fontWeight: 500 }}>
                          {isEditable ? (
                            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6 }}>
                              <NumberStep value={draft.qty} onChange={(qty) => setDraftQty(line.id, qty)} disabled={acting || isSaving} />
                              {over && <Icon name="alert" size={13} style={{ color: 'var(--c-warning)' }} />}
                            </div>
                          ) : (
                            line.qty
                          )}
                        </td>
                        {isEditable && (
                          <td>
                            <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                              {hasDraftChange && (
                                <button
                                  className="btn ghost icon sm"
                                  title="Сохранить количество"
                                  disabled={acting || isSaving || over}
                                  onClick={() => { void handleSaveQty(line) }}
                                >
                                  <Icon name="save" size={13} />
                                </button>
                              )}
                              <button className="btn ghost icon sm" disabled={acting || isSaving} onClick={() => { void handleDeleteLine(line.id) }}>
                                <Icon name="trash" size={13} />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background: 'var(--c-bg-sunken)' }}>
                    <td colSpan={isEditable ? 3 : 2} style={{ padding: '10px 12px', fontWeight: 500, fontSize: 12.5 }}>
                      Итого: {doc.lines.length} SKU
                    </td>
                    <td className="num" style={{ padding: '10px 12px', fontWeight: 600, fontSize: 14 }}>{doc.total_qty}</td>
                    {isEditable && <td />}
                  </tr>
                </tfoot>
              </table>
            )}
          </div>

        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card">
            <div className="card-head">
              <Icon name="chart" size={15} style={{ color: 'var(--c-accent)' }} />
              <div className="card-head-title">Итого</div>
            </div>
            <div style={{ padding: '14px 16px', display: 'grid', gridTemplateColumns: 'auto 1fr', rowGap: 10, columnGap: 12, fontSize: 13 }}>
              <span style={{ color: 'var(--c-text-muted)' }}>SKU</span>
              <span className="mono" style={{ textAlign: 'right' }}>{doc.sku_count}</span>
              <span style={{ color: 'var(--c-text-muted)' }}>Кол-во</span>
              <span className="mono" style={{ textAlign: 'right', fontWeight: 500, fontSize: 14 }}>{doc.total_qty}</span>
            </div>
          </div>

          <div
            className="card"
            style={{
              position: 'sticky', top: 16, alignSelf: 'flex-start', width: '100%',
              maxHeight: 'calc(100vh - 220px)',
              display: 'flex', flexDirection: 'column',
            }}
          >
            <div className="card-head" style={{ borderBottom: '1px solid var(--c-border)', flexShrink: 0 }}>
              <Icon name="layers" size={15} style={{ color: 'var(--c-accent)' }} />
              <span className="card-head-title">Журнал операций</span>
              <Badge tone="accent" style={{ marginLeft: 6 } as React.CSSProperties}>{doc.ops.length}</Badge>
            </div>

            <div style={{ flex: '1 1 auto', overflow: 'auto', padding: '4px 0' }}>
              {doc.ops.length === 0 ? (
                <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--c-text-muted)', fontSize: 13 }}>
                  Нет операций
                </div>
              ) : (
                <div style={{ position: 'relative' }}>
                  <div style={{ position: 'absolute', left: 22, top: 12, bottom: 12, width: 1, background: 'var(--c-border)' }} />
                  {doc.ops.map((op) => (
                    <OpEntry key={op.id} op={op} />
                  ))}
                </div>
              )}
            </div>

            <div style={{
              padding: '8px 12px',
              borderTop: '1px solid var(--c-border)',
              background: 'var(--c-bg-sunken)',
              fontSize: 11,
              color: 'var(--c-text-subtle)',
              display: 'flex', alignItems: 'center', gap: 6,
              flexShrink: 0,
            }}>
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
          onAdd={(item) => { void handleAddLine(item) }}
          onClose={() => setShowPicker(false)}
        />
      )}

    </div>
  )
}

function OpEntry({ op }: { op: ShipmentOp }) {
  const tone = OP_TONES[op.op_type] ?? ''
  const iconName = OP_ICONS[op.op_type] ?? 'layers'
  const label = OP_LABELS[op.op_type] ?? op.op_type

  const bgMap: Record<string, string> = {
    accent: 'var(--c-accent-bg)',
    success: 'var(--c-success-bg)',
    warning: 'color-mix(in oklab, var(--c-warning) 18%, var(--c-bg))',
    info: 'color-mix(in oklab, var(--c-info, #3b82f6) 15%, var(--c-bg))',
    danger: 'color-mix(in oklab, var(--c-danger) 12%, var(--c-bg))',
    '': 'var(--c-bg-sunken)',
  }
  const borderMap: Record<string, string> = {
    accent: 'var(--c-accent-border)',
    success: 'color-mix(in oklab, var(--c-success) 35%, transparent)',
    warning: 'color-mix(in oklab, var(--c-warning) 40%, transparent)',
    info: 'color-mix(in oklab, var(--c-info, #3b82f6) 35%, transparent)',
    danger: 'color-mix(in oklab, var(--c-danger) 35%, transparent)',
    '': 'var(--c-border)',
  }
  const colorMap: Record<string, string> = {
    accent: 'var(--c-accent)',
    success: 'var(--c-success)',
    warning: 'var(--c-warning)',
    info: 'var(--c-info, #3b82f6)',
    danger: 'var(--c-danger)',
    '': 'var(--c-text-muted)',
  }

  const email = op.created_by_email || op.created_by || ''
  const initials = email ? getInitials(email.split('@')[0]) : '?'

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr', padding: '8px 12px 8px 0', position: 'relative' }}>
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: 2 }}>
        <div style={{
          width: 22, height: 22, borderRadius: '50%',
          background: bgMap[tone] ?? bgMap[''],
          border: `1px solid ${borderMap[tone] ?? borderMap['']}`,
          color: colorMap[tone] ?? colorMap[''],
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative', zIndex: 1, flexShrink: 0,
        }}>
          <Icon name={iconName as never} size={11} />
        </div>
      </div>
      <div style={{ minWidth: 0, paddingTop: 1 }}>
        <div style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 2 }}>{label}</div>
        {op.comment && (
          <div style={{ fontSize: 11.5, color: 'var(--c-text-muted)', marginBottom: 3, lineHeight: 1.45 }}>{op.comment}</div>
        )}
        <div style={{ display: 'flex', gap: 6, fontSize: 11, color: 'var(--c-text-subtle)', alignItems: 'center' }}>
          {email && <Avatar initials={initials} />}
          {email && <span>{email}</span>}
          {email && <span>·</span>}
          <span className="mono">{fmtDateTime(op.created_at)}</span>
        </div>
      </div>
    </div>
  )
}

function CargoTypeDisplay({ value }: { value: ShipmentCargoType }) {
  const options: { key: ShipmentCargoType; label: string; icon: string; accent: string; bg: string; desc: string }[] = [
    { key: 'good',   label: 'Годный товар', icon: '✓', accent: 'var(--c-success)', bg: 'var(--c-success-bg, #f0faf4)', desc: 'Отгрузка из остатков без дефектов' },
    { key: 'defect', label: 'Брак',         icon: '!', accent: 'var(--c-warning)',  bg: 'var(--c-warning-bg)',          desc: 'Отгрузка бракованного товара' },
  ]
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      {options.map((opt) => {
        const active = value === opt.key
        return (
          <div
            key={opt.key}
            style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 14px',
              borderRadius: 'var(--r-lg)',
              border: `2px solid ${active ? opt.accent : 'var(--c-border)'}`,
              background: active ? opt.bg : 'var(--c-bg)',
              opacity: active ? 1 : 0.55,
            }}
          >
            <div style={{
              width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: active ? opt.accent : 'var(--c-bg-sunken)',
              color: active ? '#fff' : 'var(--c-text-muted)',
              fontWeight: 700, fontSize: 15,
            }}>
              {opt.icon}
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13, color: active ? opt.accent : 'var(--c-text)' }}>{opt.label}</div>
              <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', marginTop: 1 }}>{opt.desc}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function NumberStep({ value, onChange, disabled = false }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', border: '1px solid var(--c-border-strong)', borderRadius: 'var(--r-md)', height: 26, width: 110, background: 'var(--c-bg-elev)' }}>
      <button
        className="btn ghost icon sm"
        style={{ height: 24, width: 24, border: 0, borderRight: '1px solid var(--c-border)', flexShrink: 0 }}
        onClick={() => onChange(value - 1)}
        disabled={disabled || value <= 1}
      >
        <Icon name="minus" size={10} />
      </button>
      <input
        inputMode="numeric"
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const next = parseInt(e.target.value.replace(/\D/g, '')) || 0
          onChange(next)
        }}
        style={{ flex: 1, border: 0, outline: 'none', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, fontVariantNumeric: 'tabular-nums', fontFeatureSettings: "'zero' 0", background: 'transparent', minWidth: 0 }}
      />
      <button
        className="btn ghost icon sm"
        style={{ height: 24, width: 24, border: 0, borderLeft: '1px solid var(--c-border)', flexShrink: 0 }}
        onClick={() => onChange(value + 1)}
        disabled={disabled}
      >
        <Icon name="plus" size={10} />
      </button>
    </div>
  )
}

function BalancePicker({ clientId, cargoType, selectedKeys, onAdd, onClose }: {
  clientId: string | null
  cargoType: ShipmentCargoType
  selectedKeys: string[]
  onAdd: (b: BalanceItem) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const [items, setItems] = useState<BalanceItem[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getBalances({
        limit: 200,
        search: search || undefined,
        only_positive: true,
        client_id: clientId || undefined,
        has_defect: cargoType === 'defect' ? true : undefined,
      })
      setItems(res.items.filter((b) => cargoType === 'defect' ? b.defect > 0 : b.good > 0))
    } finally {
      setLoading(false)
    }
  }, [search, clientId, cargoType])

  useEffect(() => { load() }, [load])

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 400 }} onClick={onClose} />
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 520,
        background: 'var(--c-bg-elev)', boxShadow: '-4px 0 24px rgba(0,0,0,.18)',
        zIndex: 401, display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid var(--c-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 15 }}>Подобрать товар</div>
              <div style={{ fontSize: 12.5, color: 'var(--c-text-subtle)' }}>
                {cargoType === 'defect' ? 'Только брак' : 'Только годный товар'}
                {clientId ? ' · по выбранному клиенту' : ''}
              </div>
            </div>
            <button className="btn ghost icon" onClick={onClose}><Icon name="x" size={16} /></button>
          </div>
          <div style={{ position: 'relative' }}>
            <Icon name="search" size={14} style={{ position: 'absolute', left: 10, top: 8, color: 'var(--c-text-subtle)', pointerEvents: 'none' }} />
            <input
              className="input"
              style={{ paddingLeft: 32 }}
              placeholder="SKU, название, цвет, размер…"
              value={search}
              autoFocus
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {loading ? (
            <div style={{ color: 'var(--c-text-muted)', fontSize: 13, padding: 12 }}>Загрузка…</div>
          ) : items.length === 0 ? (
            <EmptyState title="Ничего не найдено" sub="Нет остатков по заданному запросу" />
          ) : (
            items.map((item) => {
              const key = balanceKey(item)
              const added = selectedKeys.includes(key)
              return (
                <div
                  key={key}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                    borderRadius: 8, border: `1px solid ${added ? 'var(--c-accent)' : 'var(--c-border)'}`,
                    cursor: added ? 'default' : 'pointer',
                    background: added ? 'var(--c-accent-bg)' : undefined,
                    opacity: added ? 0.75 : 1,
                  }}
                  onClick={() => { if (!added) onAdd(item) }}
                >
                  <div style={{ width: 34, height: 34, borderRadius: 6, background: 'var(--c-bg-sunken)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon name="box" size={14} style={{ color: 'var(--c-text-muted)' }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{item.product_name}</div>
                    <div className="t-sub mono">{[item.product_sku, item.color_name, item.size_name].filter(Boolean).join(' · ')}</div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div className="mono" style={{ color: cargoType === 'defect' ? 'var(--c-warning)' : 'var(--c-success)', fontWeight: 500, fontSize: 13 }}>
                      {cargoType === 'defect' ? item.defect : item.good}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--c-text-subtle)' }}>доступно</div>
                  </div>
                  <Icon name={added ? 'check' : 'plus'} size={14} style={{ color: 'var(--c-accent)', flexShrink: 0 }} />
                </div>
              )
            })
          )}
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--c-border)' }}>
          <button className="btn" style={{ width: '100%' }} onClick={onClose}>Готово</button>
        </div>
      </div>
    </>
  )
}
