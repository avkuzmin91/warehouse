import { useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useBackNav } from '../../../hooks/useBackNav'
import {
  createReceipt,
  advanceReceiptStatus,
  checkReceiptDuplicate,
} from '../../../api/receiptsApi'
import { linkTripReceipts } from '../../../api/tripsApi'
import type { ReceiptLineInput } from '../../../api/receiptsApi'
import type { DictionaryItem, DuplicateMatch } from '../../../api/domainTypes'
import { DuplicateWarnModal } from './shared/DuplicateWarnModal'
import { Combobox } from '../../data/Combobox'
import { Alert } from '../../primitives/Alert'
import { Badge } from '../../primitives/Badge'
import { EmptyState } from '../../primitives/EmptyState'
import { Icon } from '../../primitives/Icon'
import { AutoGrowTextarea, Field } from '../../primitives/Input'
import { DatePicker } from '../../primitives/DatePicker'
import { Table, Td } from '../../data/Table'
import { useLookups } from '../../../hooks/useLookups'
import { useCurrentUser } from '../../../hooks/useCurrentUser'
import { canCreateDocuments, canViewCosts } from '../../../utils/access'
import { PhaseBlock } from '../shared/process/PhaseBlock'
import { DocHeader } from '../shared/process/DocHeader'
import { PrimaryAction } from '../shared/process/PrimaryAction'
import { Panel, ReadRow, ChecklistPanel, LockedGrid } from '../shared/process/processUI'
import { NumberStep } from './shared/NumberStep'
import { receiptLineVariantKey } from './shared/receiptLineVariantRules'
import { MatrixAddDrawer } from './shared/MatrixAddDrawer'
import type { MatrixCell } from './shared/MatrixAddDrawer'
import { ReceiptRailPanel } from './receiptDetail/components/ReceiptRailPanel'

type DraftLine = ReceiptLineInput & { _id: number }

function genId() {
  return Math.floor(Math.random() * 1e9)
}

export function ReceiptCreateFeature() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const tripParam = searchParams.get('trip')
  const returnToParam = searchParams.get('returnTo')
  const backTarget = tripParam ? `/logistics/trips/${tripParam}` : (returnToParam || '/inventory/receipts')
  const goBack = useBackNav(backTarget)

  const [clientId, setClientId] = useState('')
  const [arrivalDate, setArrivalDate] = useState('')
  const [comment, setComment] = useState('')
  const [logisticsCost, setLogisticsCost] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showAddLine, setShowAddLine] = useState(false)
  const [showBlockReasons, setShowBlockReasons] = useState(false)
  const [dupMatches, setDupMatches] = useState<DuplicateMatch[]>([])
  // Куда идти после подтверждения дубля: черновик или сразу «Запланировать».
  const pendingPlannedRef = useRef(false)

  const { clients: clientsAll } = useLookups()
  const { user } = useCurrentUser()
  const showCosts = canViewCosts(user)
  const canCreate = canCreateDocuments(user)
  const clients: DictionaryItem[] = clientsAll.filter((c) => c.is_active && !c.is_deleted)

  const totalQty = lines.reduce((s, l) => s + l.planned_qty, 0)
  const totalSku = new Set(lines.map((l) => l.product_sku)).size
  const logisticsCostNumber = Number(logisticsCost)
  const logisticsCostFilled = logisticsCost.trim() !== '' && Number.isFinite(logisticsCostNumber) && logisticsCostNumber >= 0

  const readyChecks = [
    { ok: !!clientId, label: 'Клиент указан', error: 'Не выбран клиент' },
    { ok: !!arrivalDate, label: 'Дата прибытия (план) указана', error: 'Не указана дата прибытия (план)' },
    ...(showCosts ? [{ ok: logisticsCostFilled, label: 'Стоимость логистики для клиента указана', error: 'Не указана стоимость логистики для клиента' }] : []),
    { ok: lines.length > 0, label: `Строк добавлено: ${lines.length}`, error: 'Не добавлено ни одной строки' },
    { ok: lines.length > 0 && lines.every((l) => l.planned_qty >= 1), label: 'Все строки валидны (≥ 1 шт)', error: 'Есть строки с количеством меньше 1' },
  ]

  const blockReasons = readyChecks.filter((c) => !c.ok).map((c) => c.error)

  async function runCreate(toPlanned: boolean) {
    setSaving(true)
    try {
      const res = await createReceipt({
        client_id: clientId,
        arrival_date: arrivalDate || null,
        comment: comment.trim() || null,
        ...(showCosts ? { logistics_cost: logisticsCostFilled ? logisticsCostNumber : null } : {}),
        lines: lines.map(({ _id, ...l }) => l),
      })
      const docId = res.message
      // Черновик остаётся в статусе draft — план склада его не видит, пока не запланируют.
      if (!toPlanned) {
        navigate(`/inventory/receipts/${docId}`, { replace: true })
        return
      }
      await advanceReceiptStatus(docId)
      if (tripParam) {
        // Создано из рейса — привязываем и возвращаемся к рейсу.
        try { await linkTripReceipts(tripParam, [{ receipt_doc_id: docId, allocations: [] }]) } catch { /* поступление создано; привязку можно повторить из рейса */ }
        navigate(`/logistics/trips/${tripParam}`, { replace: true })
      } else if (returnToParam) {
        navigate(returnToParam, { replace: true })
      } else {
        navigate(`/inventory/receipts/${docId}`, { replace: true })
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  async function handleSave(toPlanned: boolean) {
    if (!clientId) { setError('Укажите клиента'); return }
    setError('')
    setSaving(true)
    try {
      const dup = await checkReceiptDuplicate({
        client_id: clientId,
        arrival_date: arrivalDate || null,
        lines: lines.map((l) => ({ product_id: l.product_id, color_id: l.color_id ?? null, size_id: l.size_id ?? null, planned_qty: l.planned_qty })),
      })
      if (dup.matches.length > 0) { pendingPlannedRef.current = toPlanned; setDupMatches(dup.matches); setSaving(false); return }
    } catch { /* проверка на дубль не критична — не блокируем создание */ }
    await runCreate(toPlanned)
  }

  function handleRemoveLine(id: number) {
    setLines((ls) => ls.filter((l) => l._id !== id))
  }

  function handleUpdateQty(id: number, qty: number) {
    setLines((ls) => ls.map((l) => l._id === id ? { ...l, planned_qty: qty } : l))
  }

  if (!canCreate) {
    return (
      <div className="page">
        <DocHeader badges={null} role="manager" title="Новое поступление" onBack={goBack} />
        <div style={{ padding: 32, color: 'var(--c-text-subtle)' }}>Недостаточно прав для создания поступлений.</div>
      </div>
    )
  }

  return (
    <div className="page">
      <DocHeader
        badges={<Badge dot>Создание</Badge>}
        role="manager"
        title="Новое поступление"
        subtitle="номер присвоится при сохранении"
        initiator={{ name: user?.display_name || user?.email || null }}
        onBack={goBack}
        blockReasons={showBlockReasons ? blockReasons : []}
        actions={
          <>
            <button className="btn" onClick={goBack} disabled={saving}>
              Отмена
            </button>
            <button
              className="btn"
              disabled={saving || !clientId}
              onClick={() => void handleSave(false)}
              title="Сохранить как черновик — можно без товара, план склада его не увидит, пока не запланируете"
            >
              <Icon name="save" size={13} />Сохранить черновик
            </button>
            <PrimaryAction
              icon="check"
              label="Запланировать поступление"
              hint="уйдёт в план склада — статус «В плане»"
              disabled={saving}
              onClick={() => { if (blockReasons.length > 0) { setShowBlockReasons(true) } else { void handleSave(true) } }}
            />
          </>
        }
      />

      {error && (
        <Alert tone="danger" icon={false} style={{ marginBottom: 16 }}>{error}</Alert>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 332px', gap: 18, alignItems: 'start' }}>
        {/* Left — фазы */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <PhaseBlock icon="file" title="Основная информация" role="manager" state="active"
            hint="Клиент и план поступления">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Field label="Клиент" required style={{ marginBottom: 0 }}>
                <Combobox
                  value={clientId}
                  placeholder="Поиск клиента…"
                  options={clients.map((c) => ({ value: c.id, label: c.name }))}
                  onChange={(v) => setClientId(String(v ?? ''))}
                  disabled={lines.length > 0}
                />
                {lines.length > 0 && (
                  <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', marginTop: 4 }}>
                    Удалите все строки, чтобы сменить клиента
                  </div>
                )}
              </Field>
              <Field label="Дата прибытия (план)" required style={{ marginBottom: 0 }}>
                <DatePicker value={arrivalDate} onChange={setArrivalDate} />
              </Field>
              {showCosts && (
                <Field label="Стоимость логистики для клиента, ₽" required style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    value={logisticsCost}
                    onChange={(e) => setLogisticsCost(e.target.value)}
                  />
                </Field>
              )}
              <Field label="Комментарий" style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
                <AutoGrowTextarea
                  minRows={3}
                  placeholder="Примечание для команды склада"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  style={{ resize: 'vertical', minHeight: 76 }}
                />
              </Field>
            </div>
          </PhaseBlock>

          <PhaseBlock icon="boxes" title="Товары к приёмке" role="manager" state="active"
            hint="План — что и сколько приедет на склад"
            right={
              <button className="btn sm primary" onClick={() => setShowAddLine(true)} disabled={!clientId}>
                <Icon name="plus" size={12} />Добавить строку
              </button>
            }
          >
            {lines.length === 0 ? (
              <div style={{ padding: '32px 0' }}>
                <EmptyState
                  title="Нет строк"
                  sub={clientId ? 'Нажмите «Добавить строку» для выбора товара' : 'Сначала выберите клиента'}
                />
              </div>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <th>Товар</th>
                    <th style={{ width: 130, textAlign: 'right' }}>План</th>
                    <th style={{ width: 56 }}>Действие</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l._id}>
                      <Td>
                        <div style={{ fontWeight: 450 }}>{l.product_name}</div>
                        <div className="t-sub mono">
                          {[l.product_sku, l.color_name, l.size_name].filter(Boolean).join(' · ')}
                        </div>
                      </Td>
                      <Td className="num" style={{ color: 'var(--c-text-muted)' }}>
                        <NumberStep
                          value={l.planned_qty}
                          onChange={(v) => handleUpdateQty(l._id, v)}
                          width={100}
                        />
                      </Td>
                      <Td>
                        <div style={{ display: 'flex', justifyContent: 'center' }}>
                          <button className="btn ghost icon sm" onClick={() => handleRemoveLine(l._id)}>
                            <Icon name="trash" size={13} />
                          </button>
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} style={{ padding: 0 }}>
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 24, padding: '10px 14px',
                        background: 'var(--c-bg-sunken)', borderTop: '1px solid var(--c-border)', fontSize: 12.5,
                      }}>
                        <span style={{ fontWeight: 700 }}>Итого</span>
                        <span style={{ color: 'var(--c-text-subtle)' }}>{totalSku} SKU</span>
                        <span style={{ color: 'var(--c-text-subtle)' }}>
                          План <b className="mono" style={{ color: 'var(--c-text)' }}>{totalQty}</b>
                        </span>
                      </div>
                    </td>
                  </tr>
                </tfoot>
              </Table>
            )}
          </PhaseBlock>

          <PhaseBlock icon="forklift" title="Приёмка" role="warehouse" state="locked"
            hint="Кладовщик примет товар после прибытия">
            <LockedGrid labels={['Дата прибытия (факт)', 'Принято', 'Местоположения']} />
          </PhaseBlock>
        </div>

        {/* Right — маршрут + готовность + итоги */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <ReceiptRailPanel status="draft" />
          <ChecklistPanel items={readyChecks.map((c) => ({ ok: c.ok, label: c.label }))} />
          <Panel icon="layers" title="Будут зафиксированы" bodyPad={false}
            right={<span className="text-xs subtle">{1 + lines.length} опер.</span>}
          >
            <div style={{ padding: '4px 0 8px' }}>
              <OpPreviewItem icon="plus" tone="accent" title="Создание документа" sub="черновик · клиент, дата" />
              {lines.slice(0, 4).map((l) => (
                <OpPreviewItem
                  key={l._id}
                  icon="plus"
                  tone=""
                  title="Добавление строки"
                  sub={[l.product_sku, l.color_name, l.size_name].filter(Boolean).join(' · ') + ` — ${l.planned_qty} шт`}
                />
              ))}
              {lines.length > 4 && (
                <div className="text-xs subtle" style={{ padding: '3px 14px 6px 46px' }}>
                  и ещё {lines.length - 4} строк…
                </div>
              )}
            </div>
          </Panel>
          <Panel icon="chart" title="Итого">
            <div style={{ padding: '0 2px' }}>
              <ReadRow label="SKU" mono>{totalSku}</ReadRow>
              <ReadRow label="Строк" mono>{lines.length}</ReadRow>
              <ReadRow label="План" mono strong>{totalQty} шт</ReadRow>
            </div>
          </Panel>
        </div>
      </div>

      {/* Drawer: массовый ввод через матрицу цвет × размер */}
      <MatrixAddDrawer
        key={showAddLine ? 'open' : 'closed'}
        open={showAddLine}
        clientId={clientId}
        title="Добавить товары к приёмке"
        existingKeys={lines.map((l) => receiptLineVariantKey(l))}
        onClose={() => setShowAddLine(false)}
        onSubmit={(entries) => {
          setLines((ls) => [
            ...ls,
            ...entries.flatMap(({ product, cells }) =>
              cells.map((c: MatrixCell) => ({
                _id: genId(),
                product_id: product.id,
                product_name: product.name,
                product_sku: product.sku,
                color_id: c.color_id,
                color_name: c.color_name,
                size_id: c.size_id,
                size_name: c.size_name,
                planned_qty: c.qty,
              })),
            ),
          ])
          setShowAddLine(false)
        }}
      />

      <DuplicateWarnModal
        open={dupMatches.length > 0}
        matches={dupMatches}
        entityAccusative="поступление"
        busy={saving}
        onOpenExisting={(id) => navigate(`/inventory/receipts/${id}`)}
        onProceed={() => { setDupMatches([]); void runCreate(pendingPlannedRef.current) }}
        onCancel={() => setDupMatches([])}
      />
    </div>
  )
}

function OpPreviewItem({ icon, tone, title, sub }: { icon: string; tone: string; title: string; sub: string }) {
  const bgMap: Record<string, string> = {
    accent: 'var(--c-accent-bg)',
    success: 'var(--c-success-bg)',
    '': 'var(--c-bg-sunken)',
  }
  const borderMap: Record<string, string> = {
    accent: 'var(--c-accent-border)',
    success: 'color-mix(in oklab, var(--c-success) 35%, transparent)',
    '': 'var(--c-border)',
  }
  const colorMap: Record<string, string> = {
    accent: 'var(--c-accent)',
    success: 'var(--c-success)',
    '': 'var(--c-text-muted)',
  }
  return (
    <div style={{ display: 'flex', gap: 10, padding: '6px 14px', alignItems: 'flex-start' }}>
      <div style={{
        width: 22, height: 22, borderRadius: '50%',
        background: bgMap[tone] ?? bgMap[''],
        border: `1px solid ${borderMap[tone] ?? borderMap['']}`,
        color: colorMap[tone] ?? colorMap[''],
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <Icon name={icon as never} size={11} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 500 }}>{title}</div>
        <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {sub}
        </div>
      </div>
    </div>
  )
}
