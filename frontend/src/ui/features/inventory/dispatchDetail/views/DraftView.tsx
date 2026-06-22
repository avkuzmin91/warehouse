import { useEffect, useState } from 'react'
import type { DispatchDetail, DispatchLine } from '../../../../../api/dispatchApi'
import type { PlannableItem } from '../../../../../api/balancesApi'
import { getInventoryClientStores } from '../../../../../api/inventoryLookupsApi'
import type { ClientStoreItem } from '../../../../../api/domainTypes'
import { updateProduct } from '../../../../../api/adminApi'
import { Combobox } from '../../../../data/Combobox'
import type { ComboboxOption } from '../../../../data/Combobox'
import { Icon } from '../../../../primitives/Icon'
import { Field } from '../../../../primitives/Input'
import { DatePicker } from '../../../../primitives/DatePicker'
import { EmptyState } from '../../../../primitives/EmptyState'
import { PhaseBlock } from '../../../shared/process/PhaseBlock'
import { Panel, ReadRow, RailPanel, LockedGrid } from '../components/processUI'
import { BalancePicker } from '../../shared/BalancePicker'
import { AssignSkuDrawer } from '../../shared/AssignSkuDrawer'
import { NumberStep } from '../../shared/NumberStep'
import { fmtYmdAsDmy } from '../../../../../utils/format'
import { canViewCosts } from '../../../../../utils/access'
import { useCurrentUser } from '../../../../../hooks/useCurrentUser'

type LineDraft = { qty: number; siteUrl: string; storeId: string; storeName: string | null }

type Props = {
  doc: DispatchDetail
  canEdit: boolean
  acting: boolean
  onAddLine: (item: PlannableItem, qty: number) => Promise<void>
  onUpdateLine: (lineId: string, body: { qty?: number; site_url?: string | null; store_id?: string | null; store_name?: string | null }) => Promise<boolean>
  onDeleteLine: (lineId: string) => Promise<void>
  onUpdateDoc: (body: { client_id?: string | null; client_name?: string | null; ship_date?: string | null; logistics_cost?: number | null }) => Promise<boolean>
  onReload: () => Promise<void>
}

function draftFromLine(line: DispatchLine): LineDraft {
  return {
    qty:       line.qty,
    siteUrl:   line.site_url ?? '',
    storeId:   line.store_id ?? '',
    storeName: line.store_name ?? null,
  }
}

export function DraftView({ doc, canEdit, acting, onAddLine, onUpdateLine, onDeleteLine, onUpdateDoc, onReload }: Props) {
  const { user } = useCurrentUser()
  const showCosts = canViewCosts(user)
  const isDefectCargo = doc.cargo_type === 'defect'

  const [showPicker, setShowPicker] = useState(false)
  const [skuLine, setSkuLine] = useState<DispatchLine | null>(null)
  const [clientStores, setClientStores] = useState<ClientStoreItem[]>([])
  const [savingLine, setSavingLine] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>({})

  const [shipDate, setShipDate] = useState(doc.ship_date ?? '')
  const [logisticsCost, setLogisticsCost] = useState(doc.logistics_cost != null ? String(doc.logistics_cost) : '')
  const [infoSaving, setInfoSaving] = useState(false)
  const [infoSaved, setInfoSaved] = useState(false)
  const [infoDirty, setInfoDirty] = useState(false)

  useEffect(() => {
    setShipDate(doc.ship_date ?? '')
    setLogisticsCost(doc.logistics_cost != null ? String(doc.logistics_cost) : '')
    setInfoDirty(false)
  }, [doc])

  useEffect(() => {
    setDrafts((prev) => {
      const next: Record<string, LineDraft> = {}
      for (const line of doc.lines) next[line.id] = prev[line.id] ?? draftFromLine(line)
      return next
    })
  }, [doc])

  useEffect(() => {
    if (!doc.client_id) { setClientStores([]); return }
    const ctrl = new AbortController()
    getInventoryClientStores(doc.client_id, ctrl.signal)
      .then(setClientStores)
      .catch(() => setClientStores([]))
    return () => ctrl.abort()
  }, [doc.client_id])

  const storeOptions: ComboboxOption[] = clientStores.map((s) => ({ value: s.id, label: s.name }))

  function getDraft(line: DispatchLine): LineDraft {
    return drafts[line.id] ?? draftFromLine(line)
  }

  function setDraft(lineId: string, patch: Partial<LineDraft>) {
    setDrafts((prev) => ({ ...prev, [lineId]: { ...(prev[lineId] ?? { qty: 1, siteUrl: '', storeId: '', storeName: null }), ...patch } }))
  }

  function lineDirty(line: DispatchLine): boolean {
    const d = getDraft(line)
    return d.qty !== line.qty
      || d.siteUrl !== (line.site_url ?? '')
      || d.storeId !== (line.store_id ?? '')
      || d.storeName !== (line.store_name ?? null)
  }

  async function saveLine(line: DispatchLine) {
    const d = getDraft(line)
    setSavingLine(line.id)
    try {
      await onUpdateLine(line.id, {
        qty:        d.qty,
        site_url:   d.siteUrl.trim() || null,
        store_id:   d.storeId || null,
        store_name: d.storeId ? d.storeName : null,
      })
    } finally {
      setSavingLine(null)
    }
  }

  async function handleInfoSave() {
    setInfoSaving(true)
    const costNum = Number(logisticsCost)
    const costFilled = logisticsCost.trim() !== '' && Number.isFinite(costNum) && costNum >= 0
    const ok = await onUpdateDoc({
      ship_date: shipDate || null,
      ...(showCosts ? { logistics_cost: costFilled ? costNum : null } : {}),
    })
    setInfoSaving(false)
    if (ok) {
      setInfoDirty(false)
      setInfoSaved(true)
      setTimeout(() => setInfoSaved(false), 2000)
    }
  }

  async function handleAssignSku(line: DispatchLine, skuBase: string) {
    await updateProduct(line.product_id, { sku_base: skuBase })
    await onReload()
  }

  const totalQty = doc.lines.reduce((s, l) => s + l.qty, 0)
  const skuCount = new Set(doc.lines.map((l) => l.product_sku)).size
  const hasPendingSku = doc.lines.some((l) => l.sku_pending)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 332px', gap: 18, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

        <PhaseBlock
          icon="file"
          title="Основная информация"
          role="manager"
          state="active"
          hint={canEdit ? 'План можно править до передачи в ожидание рейса' : undefined}
          right={canEdit && infoSaved ? (
            <span style={{ fontSize: 12, color: 'var(--c-success)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <Icon name="check" size={12} />Сохранено
            </span>
          ) : canEdit && infoDirty ? (
            <button className="btn sm" disabled={infoSaving} onClick={() => void handleInfoSave()}>
              <Icon name="save" size={12} />Сохранить
            </button>
          ) : undefined}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="Клиент" style={{ marginBottom: 0 }}>
              <input className="input" value={doc.client_name ?? '—'} readOnly style={{ cursor: 'default' }} />
            </Field>
            <Field label="Дата отгрузки (план)" required style={{ marginBottom: 0 }}>
              {canEdit ? (
                <DatePicker value={shipDate} onChange={(v) => { setShipDate(v); setInfoDirty(true) }} />
              ) : (
                <input className="input" value={fmtYmdAsDmy(doc.ship_date)} readOnly style={{ cursor: 'default' }} />
              )}
            </Field>
            {showCosts && (
              <Field label="Стоимость логистики для клиента, ₽" required style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
                {canEdit ? (
                  <input
                    className="input"
                    type="number"
                    min={0}
                    step={0.01}
                    value={logisticsCost}
                    onChange={(e) => { setLogisticsCost(e.target.value); setInfoDirty(true) }}
                    placeholder="0.00"
                  />
                ) : (
                  <input className="input" value={doc.logistics_cost != null ? doc.logistics_cost.toLocaleString('ru-RU') : '—'} readOnly style={{ cursor: 'default' }} />
                )}
              </Field>
            )}
          </div>
        </PhaseBlock>

        <PhaseBlock
          icon="boxes"
          title="Состав отгрузки"
          role="manager"
          state="active"
          hint="Товар на остатках и в пути"
          right={canEdit ? (
            <button className="btn sm primary" onClick={() => setShowPicker(true)} disabled={acting || !doc.client_id}>
              <Icon name="plus" size={12} />Добавить товар
            </button>
          ) : undefined}
        >
          {doc.lines.length === 0 ? (
            <div style={{ padding: '32px 0' }}>
              <EmptyState title="Состав пуст" sub={canEdit ? 'Добавьте товар — остатки и товар в пути' : 'Нет позиций'} />
            </div>
          ) : (
            <table className="t">
              <thead>
                <tr>
                  <th style={{ width: 32 }} />
                  <th>Товар · вариант</th>
                  <th style={{ width: 160 }}>Магазин</th>
                  <th style={{ width: 200 }}>Ссылка на сайт</th>
                  <th style={{ textAlign: 'right', width: 150 }}>План</th>
                  <th style={{ width: 64 }} />
                </tr>
              </thead>
              <tbody>
                {doc.lines.map((l) => {
                  const d = getDraft(l)
                  const dirty = lineDirty(l)
                  return (
                    <tr key={l.id}>
                      <td>
                        <div style={{ width: 26, height: 26, borderRadius: 4, background: 'var(--c-bg-sunken)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Icon name="box" size={12} style={{ color: 'var(--c-text-muted)' }} />
                        </div>
                      </td>
                      <td>
                        <div style={{ fontWeight: 500, fontSize: 13 }}>{l.product_name}</div>
                        <div className="t-sub mono">{[l.product_sku, l.color_name, l.size_name].filter(Boolean).join(' · ')}</div>
                        {l.sku_pending && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                            <span className="badge warning">Без SKU</span>
                            {canEdit && (
                              <button className="btn ghost sm" onClick={() => setSkuLine(l)}>
                                <Icon name="edit" size={12} />Указать SKU
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                      <td>
                        <div className="store-cell-combobox">
                          <Combobox
                            value={d.storeId || null}
                            placeholder="Без магазина"
                            options={storeOptions}
                            disabled={!canEdit}
                            onChange={(v, opt) => setDraft(l.id, { storeId: String(v ?? ''), storeName: opt?.label ?? null })}
                            clearable
                          />
                        </div>
                      </td>
                      <td>
                        <input
                          className="input sm"
                          placeholder="https://…"
                          value={d.siteUrl}
                          readOnly={!canEdit}
                          onChange={(e) => setDraft(l.id, { siteUrl: e.target.value })}
                          style={{ width: '100%' }}
                        />
                      </td>
                      <td>
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                          <NumberStep
                            value={d.qty}
                            disabled={!canEdit}
                            tone={dirty ? 'accent' : 'normal'}
                            onChange={(v) => setDraft(l.id, { qty: Math.max(1, v) })}
                          />
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4 }}>
                          {canEdit && dirty && (
                            <button
                              className="btn ghost icon sm"
                              title="Сохранить позицию"
                              disabled={savingLine === l.id}
                              onClick={() => void saveLine(l)}
                            >
                              <Icon name={savingLine === l.id ? 'refresh' : 'save'} size={13} style={savingLine === l.id ? { animation: 'spin 0.7s linear infinite' } : undefined} />
                            </button>
                          )}
                          {canEdit && (
                            <button className="btn ghost icon sm" disabled={acting} onClick={() => void onDeleteLine(l.id)}>
                              <Icon name="trash" size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: 'var(--c-bg-sunken)' }}>
                  <td colSpan={4} style={{ padding: '10px 12px', fontWeight: 500, fontSize: 12.5 }}>
                    Итого: {skuCount} SKU
                  </td>
                  <td className="num" style={{ padding: '10px 12px', fontWeight: 600, fontSize: 14 }}>{totalQty}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          )}
        </PhaseBlock>

        <PhaseBlock icon="truckOut" title="Рейс и отгрузка" role="manager" state="locked"
          hint="Привязка к рейсу и списание — после передачи в ожидание рейса">
          <LockedGrid labels={['Рейсы', 'Отгружено']} />
        </PhaseBlock>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <RailPanel status="draft" ops={doc.ops} />
        <Panel icon="chart" title="Итого">
          <div style={{ padding: '0 2px' }}>
            <ReadRow label="SKU" mono>{skuCount}</ReadRow>
            <ReadRow label="Кол-во" mono strong>{totalQty} шт</ReadRow>
            {showCosts && (
              <ReadRow label="Логистика" mono>{doc.logistics_cost != null ? `${doc.logistics_cost.toLocaleString('ru-RU')} ₽` : '—'}</ReadRow>
            )}
            {hasPendingSku && (
              <div style={{ marginTop: 8 }}>
                <span className="badge warning">Есть товары без SKU</span>
              </div>
            )}
          </div>
        </Panel>
      </div>

      {showPicker && (
        <BalancePicker
          clientId={doc.client_id}
          cargoType={isDefectCargo ? 'defect' : 'good'}
          onAdd={(item, qty) => { void onAddLine(item, qty); setShowPicker(false) }}
          onClose={() => setShowPicker(false)}
        />
      )}

      {skuLine && (
        <AssignSkuDrawer
          productName={skuLine.product_name}
          variantLabel={[skuLine.color_name, skuLine.size_name].filter(Boolean).join(' · ') || null}
          currentSku={skuLine.sku_pending ? null : skuLine.product_sku}
          onSubmit={(skuBase) => handleAssignSku(skuLine, skuBase)}
          onClose={() => setSkuLine(null)}
        />
      )}
    </div>
  )
}
