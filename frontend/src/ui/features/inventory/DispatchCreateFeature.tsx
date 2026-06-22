import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createDispatch, advanceDispatch } from '../../../api/dispatchApi'
import type { DispatchCargoType, DispatchLineIn } from '../../../api/dispatchApi'
import type { PlannableItem } from '../../../api/balancesApi'
import { getInventoryClientStores } from '../../../api/inventoryLookupsApi'
import type { ClientStoreItem } from '../../../api/domainTypes'
import { Combobox } from '../../data/Combobox'
import type { ComboboxOption } from '../../data/Combobox'
import { Icon } from '../../primitives/Icon'
import { Field } from '../../primitives/Input'
import { DatePicker } from '../../primitives/DatePicker'
import { Alert } from '../../primitives/Alert'
import { EmptyState } from '../../primitives/EmptyState'
import { BalancePicker } from './shared/BalancePicker'
import { AssignSkuDrawer } from './shared/AssignSkuDrawer'
import { NumberStep } from './shared/NumberStep'
import { updateProduct } from '../../../api/adminApi'
import { PhaseBlock } from '../shared/process/PhaseBlock'
import { DispHeader } from './dispatchDetail/components/DispHeader'
import { Panel, ReadRow, RailPanel, ChecklistPanel, LockedGrid } from './dispatchDetail/components/processUI'
import { PrimaryAction } from '../shared/process/PrimaryAction'
import { fmtYmdAsDmy } from '../../../utils/format'
import { canCreateDocuments, canViewCosts } from '../../../utils/access'
import { useLookups } from '../../../hooks/useLookups'
import { useCurrentUser } from '../../../hooks/useCurrentUser'

type DraftLine = DispatchLineIn & { _uid: string; onHand: number; inTransit: number; sku_pending: boolean }

export function DispatchCreateFeature({ cargoType }: { cargoType: DispatchCargoType }) {
  const navigate = useNavigate()

  const [clientId, setClientId] = useState<string | null>(null)
  const [clientName, setClientName] = useState<string | null>(null)
  const [logisticsCost, setLogisticsCost] = useState('')
  const [shipDate, setShipDate] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([])
  const [clientStores, setClientStores] = useState<ClientStoreItem[]>([])
  const [showPicker, setShowPicker] = useState(false)
  const [skuLine, setSkuLine] = useState<DraftLine | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showBlockReasons, setShowBlockReasons] = useState(false)
  const lineUidSeq = useRef(0)

  const { clients } = useLookups()
  const { user } = useCurrentUser()
  const showCosts = canViewCosts(user)
  const canCreate = canCreateDocuments(user)

  const clientOptions: ComboboxOption[] = clients.map((c) => ({ value: c.id, label: c.name }))
  const storeOptions: ComboboxOption[] = clientStores.map((s) => ({ value: s.id, label: s.name }))

  useEffect(() => {
    if (!clientId) {
      setClientStores([])
      return
    }
    const controller = new AbortController()
    getInventoryClientStores(clientId, controller.signal)
      .then(setClientStores)
      .catch(() => setClientStores([]))
    return () => controller.abort()
  }, [clientId])

  const isDefectCargo = cargoType === 'defect'
  const totalQty = lines.reduce((s, l) => s + l.qty, 0)
  // Сверх остатка готового, но в пределах «склад + в пути» — товар ещё не на готовом:
  // черновик сохранить можно, передать в ожидание рейса — только когда покрыт остаток.
  const hasInTransit = lines.some((l) => l.qty > l.onHand && l.qty <= l.onHand + l.inTransit)
  const hasOverCap = lines.some((l) => l.qty > l.onHand + l.inTransit)
  const allOnStock = lines.every((l) => l.qty <= l.onHand)
  const logisticsCostNumber = Number(logisticsCost)
  const logisticsCostFilled = logisticsCost.trim() !== '' && Number.isFinite(logisticsCostNumber) && logisticsCostNumber >= 0

  const readyChecks = [
    { ok: !!clientId, label: 'Клиент выбран', error: 'Выберите клиента' },
    { ok: !!shipDate, label: 'Дата отгрузки (план) указана', error: 'Укажите дату отгрузки' },
    ...(showCosts ? [{ ok: logisticsCostFilled, label: 'Стоимость логистики указана', error: 'Укажите стоимость логистики' }] : []),
    { ok: lines.length > 0, label: 'Добавлены строки', error: 'Добавьте хотя бы одну позицию в отгрузку' },
    { ok: lines.every((l) => !l.sku_pending), label: 'У всех товаров указан SKU', error: 'Укажите SKU для товаров без артикула (кнопка «Указать SKU» в строке)' },
    { ok: !hasOverCap, label: 'Количество в пределах остатка и товара в пути', error: 'Уменьшите количество в позициях, где запрошено больше остатка и товара в пути' },
    { ok: allOnStock, label: 'Весь товар на остатках', error: 'Часть товара ещё в пути — сохраните черновик и передайте в рейс после прихода' },
  ]
  const blockReasons = readyChecks.filter((check) => !check.ok).map((check) => check.error)

  function handleClientChange(val: string | number | null, opt?: ComboboxOption) {
    setClientId(val ? String(val) : null)
    setClientName(opt?.label ?? null)
    setLines([])
  }

  function updateQty(uid: string, qty: number) {
    setLines((ls) => ls.map((l) => l._uid === uid ? { ...l, qty: Math.max(1, qty) } : l))
  }

  function removeLine(uid: string) {
    setLines((ls) => ls.filter((l) => l._uid !== uid))
  }

  function setLineStore(uid: string, storeId: string, storeName: string | null) {
    setLines((ls) => ls.map((l) => l._uid === uid
      ? { ...l, store_id: storeId || null, store_name: storeId ? storeName : null }
      : l))
  }

  function setLineSiteUrl(uid: string, siteUrl: string) {
    setLines((ls) => ls.map((l) => l._uid === uid ? { ...l, site_url: siteUrl } : l))
  }

  function addFromBalance(b: PlannableItem, qty: number) {
    setLines((ls) => [...ls, {
      _uid:         `line-${lineUidSeq.current++}`,
      product_id:   b.product_id,
      product_name: b.product_name,
      product_sku:  b.product_sku,
      color_id:     b.color_id,
      color_name:   b.color_name,
      size_id:      b.size_id,
      size_name:    b.size_name,
      qty,
      onHand:       isDefectCargo ? b.storage_defect : b.storage_good,
      inTransit:    isDefectCargo ? 0 : b.in_transit,
      sku_pending:  !!b.sku_pending,
      site_url:     null,
      store_id:     null,
      store_name:   null,
    }])
  }

  async function handleAssignSku(line: DraftLine, skuBase: string) {
    await updateProduct(line.product_id, { sku_base: skuBase })
    setLines((ls) => ls.map((l) => l.product_id === line.product_id
      ? { ...l, sku_pending: false, product_sku: skuBase }
      : l))
  }

  async function handleSave(toAwaiting: boolean) {
    setError('')
    setSaving(true)
    try {
      const res = await createDispatch({
        cargo_type:  cargoType,
        client_id:   clientId || null,
        client_name: clientName || null,
        ...(showCosts ? { logistics_cost: logisticsCostFilled ? logisticsCostNumber : null } : {}),
        ship_date:   shipDate || null,
        lines: lines.map((line) => ({
          product_id:   line.product_id,
          product_name: line.product_name,
          product_sku:  line.product_sku,
          color_id:     line.color_id,
          color_name:   line.color_name,
          size_id:      line.size_id,
          size_name:    line.size_name,
          qty:          line.qty,
          site_url:     line.site_url || null,
          store_id:     line.store_id ?? null,
          store_name:   line.store_name ?? null,
        })),
      })
      const docId = res.message
      if (toAwaiting) await advanceDispatch(docId)
      navigate(`/inventory/dispatches/${docId}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  function handleSendToAwaiting() {
    if (blockReasons.length > 0) {
      setShowBlockReasons(true)
      return
    }
    setShowBlockReasons(false)
    void handleSave(true)
  }

  if (!canCreate) {
    return (
      <div className="page">
        <div style={{ padding: 32, color: 'var(--c-text-subtle)' }}>Недостаточно прав для создания отгрузок.</div>
      </div>
    )
  }

  return (
    <div className="page">
      <DispHeader
        status="draft"
        cargoType={cargoType}
        title={isDefectCargo ? 'Новая отгрузка брака' : 'Новая отгрузка'}
        subtitle="номер присвоится при сохранении"
        onBack={() => navigate('/inventory/dispatches')}
        blockReasons={showBlockReasons ? blockReasons : []}
        actions={
          <>
            <button className="btn" disabled={saving} onClick={() => navigate('/inventory/dispatches')}>Отмена</button>
            <button
              className="btn"
              disabled={saving || !clientId || lines.length === 0}
              onClick={() => void handleSave(false)}
              title="Сохранить как черновик — для товара, который ещё в пути"
            >
              <Icon name="save" size={13} />Сохранить черновик
            </button>
            <PrimaryAction
              icon="arrowRight"
              label="Передать в ожидание рейса"
              hint="уйдёт в очередь на привязку к рейсу — статус «Ожидает рейс»"
              disabled={saving}
              onClick={handleSendToAwaiting}
            />
          </>
        }
      />

      {hasOverCap && (
        <Alert tone="warning" style={{ marginBottom: 14 }}>
          <span style={{ fontWeight: 500 }}>Запрошено больше, чем остаток и товар в пути по одной или нескольким позициям.</span>
        </Alert>
      )}
      {!hasOverCap && hasInTransit && (
        <Alert tone="info" style={{ marginBottom: 14 }}>
          <span>Часть товара ещё в пути. Сохраните черновик — передать в рейс можно будет после прихода.</span>
        </Alert>
      )}

      {error && <div style={{ color: 'var(--c-danger)', fontSize: 13, marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 332px', gap: 18, alignItems: 'start' }}>
        {/* Left — фазы */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          <PhaseBlock icon="file" title="Основная информация" role="manager" state="active"
            hint="Клиент и дата отгрузки">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Field label="Клиент" required style={{ marginBottom: 0 }}>
                <Combobox
                  value={clientId}
                  onChange={handleClientChange}
                  options={clientOptions}
                  placeholder="Выберите клиента…"
                  clearable
                />
              </Field>
              <Field label="Дата отгрузки (план)" required style={{ marginBottom: 0 }}>
                <DatePicker value={shipDate} onChange={setShipDate} />
              </Field>
              {showCosts && (
                <Field label="Стоимость логистики для клиента, ₽" required style={{ marginBottom: 0 }}>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    step={0.01}
                    value={logisticsCost}
                    onChange={(e) => setLogisticsCost(e.target.value)}
                  />
                </Field>
              )}
            </div>
          </PhaseBlock>

          <PhaseBlock icon="boxes" title="Состав отгрузки" role="manager" state="active"
            hint="Товар на остатках и в пути"
            right={
              <button className="btn sm primary" onClick={() => setShowPicker(true)} disabled={!clientId}>
                <Icon name="plus" size={12} />Добавить товар
              </button>
            }>

            {lines.length === 0 ? (
              <div style={{ padding: '32px 0' }}>
                <EmptyState title="Состав пуст" sub={clientId ? 'Нажмите «Добавить товар» — остатки и товар в пути' : 'Сначала выберите клиента'} />
              </div>
            ) : (
              <table className="t">
                <thead>
                  <tr>
                    <th style={{ width: 32 }} />
                    <th>Товар · вариант</th>
                    <th style={{ width: 170 }}>Магазин</th>
                    <th style={{ width: 200 }}>Ссылка на сайт</th>
                    <th style={{ textAlign: 'right', width: 176 }}>План отгрузки</th>
                    <th style={{ width: 32 }} />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => {
                    const overCap = l.qty > l.onHand + l.inTransit
                    const waiting = !overCap && l.qty > l.onHand
                    return (
                      <tr key={l._uid} style={overCap ? { background: 'var(--c-warning-bg)' } : {}}>
                        <td>
                          <div style={{ width: 26, height: 26, borderRadius: 4, background: 'var(--c-bg-sunken)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Icon name="box" size={12} style={{ color: 'var(--c-text-muted)' }} />
                          </div>
                        </td>
                        <td>
                          <div style={{ fontWeight: 500, fontSize: 13 }}>{l.product_name}</div>
                          <div className="t-sub mono">{[l.product_sku, l.color_name, l.size_name].filter(Boolean).join(' · ')}</div>
                          {l.sku_pending ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                              <span className="badge warning">Без SKU</span>
                              <button className="btn ghost sm" onClick={() => setSkuLine(l)}>
                                <Icon name="edit" size={12} />Указать SKU
                              </button>
                            </div>
                          ) : (
                            <div style={{ marginTop: 4 }}>
                              <button className="btn ghost sm" onClick={() => setSkuLine(l)}>
                                <Icon name="edit" size={12} />Изменить SKU
                              </button>
                            </div>
                          )}
                        </td>
                        <td>
                          <div className="store-cell-combobox">
                            <Combobox
                              value={l.store_id ?? null}
                              placeholder="Без магазина"
                              options={storeOptions}
                              onChange={(v, opt) => setLineStore(l._uid, String(v ?? ''), opt?.label ?? null)}
                              clearable
                            />
                          </div>
                        </td>
                        <td>
                          <input
                            className="input sm"
                            placeholder="https://…"
                            value={l.site_url ?? ''}
                            onChange={(e) => setLineSiteUrl(l._uid, e.target.value)}
                            style={{ width: '100%' }}
                          />
                        </td>
                        <td>
                          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6 }}>
                            <NumberStep value={l.qty} onChange={(v) => updateQty(l._uid, v)} />
                            {overCap ? (
                              <Icon name="alert" size={13} style={{ color: 'var(--c-warning)' }} />
                            ) : waiting ? (
                              <Icon name="clock" size={13} style={{ color: 'var(--c-text-subtle)' }} />
                            ) : null}
                          </div>
                          <div className="t-sub" style={{ textAlign: 'right', marginTop: 2, whiteSpace: 'nowrap' }}>
                            на складе {l.onHand}{!isDefectCargo && l.inTransit > 0 ? ` · в пути ${l.inTransit}` : ''}
                          </div>
                        </td>
                        <td>
                          <button className="btn ghost icon sm" onClick={() => removeLine(l._uid)}>
                            <Icon name="trash" size={13} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background: 'var(--c-bg-sunken)' }}>
                    <td colSpan={4} style={{ padding: '10px 12px', fontWeight: 500, fontSize: 12.5 }}>
                      Итого: {lines.length} SKU
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

        {/* Right — маршрут + итог + готовность */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <RailPanel status="draft" />
          <Panel icon="chart" title="Итого">
            <div style={{ padding: '0 2px' }}>
              <ReadRow label="SKU" mono>{lines.length}</ReadRow>
              <ReadRow label="Кол-во" mono strong>{totalQty} шт</ReadRow>
              <ReadRow label="Дата (план)" mono>{shipDate ? fmtYmdAsDmy(shipDate) : '—'}</ReadRow>
              {showCosts && (
                <ReadRow label="Логистика" mono>{logisticsCostFilled ? `${logisticsCostNumber.toLocaleString('ru-RU')} ₽` : '—'}</ReadRow>
              )}
            </div>
          </Panel>
          <ChecklistPanel items={readyChecks.map((c) => ({ ok: c.ok, label: c.label }))} />
        </div>
      </div>

      {showPicker && (
        <BalancePicker
          clientId={clientId}
          cargoType={cargoType}
          onAdd={(b, qty) => { addFromBalance(b, qty); setShowPicker(false) }}
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
