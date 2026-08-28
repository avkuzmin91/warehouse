import { Fragment, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useBackNav } from '../../../hooks/useBackNav'
import {
  cancelInvoice,
  deleteInvoiceFile,
  removeInvoiceDiscount,
  detachInvoiceExtraIncome,
  detachInvoiceReceipt,
  detachInvoiceShipment,
  detachInvoiceStorage,
  getInvoice,
  INVOICE_OP_LABELS,
  invoiceStatusTone,
  isInvoiceActive,
  isInvoiceDraft,
  issueInvoice,
  parseDueHistory,
  updateInvoice,
  uploadInvoiceFile,
} from '../../../api/invoicesApi'
import type { InvoiceDetail, InvoiceOpType } from '../../../api/invoicesApi'
import { getUninvoicedStorage } from '../../../api/storagePricingApi'
import { resolvePublicUploadSrc } from '../../../api/constants'
import { Badge } from '../../primitives/Badge'
import { Icon } from '../../primitives/Icon'
import { DatePicker } from '../../primitives/DatePicker'
import { Combobox } from '../../data/Combobox'
import { DocHeader } from '../shared/process/DocHeader'
import { Panel, ChecklistPanel } from '../shared/process/processUI'
import { useApi } from '../../../hooks/useApi'
import { useLookups } from '../../../hooks/useLookups'
import { useToast } from '../../feedback/Toast'
import { useConfirm } from '../../feedback/ConfirmDialog'
import { fmtDate, fmtDateShort, fmtDateTime, formatMoneyKopecks, parseRublesToKopecks } from '../../../utils/format'
import { FinanceSummary, InvoiceSection, CargoTag, FileTypeIcon, ShipmentContentsPanel, SelectedContentsRollup, SelectedReceiptsRollup, InvoiceSummaryPanel } from './financeUI'
import { InvoiceRailPanel, invoicePhase } from './InvoiceRail'
import { PayModal, DueModal, AmountModal, DiscountModal, AttachModal, AttachReceiptsModal, AttachExtraIncomeModal, AttachStorageModal } from './InvoiceModals'

const OP_DOT: Partial<Record<InvoiceOpType, string>> = {
  issue: 'var(--c-accent)',
  close: 'var(--c-success)',
  payment: 'var(--c-warning)',
  due_date_change: 'var(--c-danger)',
  amount_change: 'var(--c-danger)',
  cancel: 'var(--c-danger)',
}

type DraftSaveResult = { total_amount: number; due_date: string | null } | null

export function InvoiceDetailFeature({ invoiceId }: { invoiceId: string }) {
  const navigate = useNavigate()
  const goBack = useBackNav('/finance/invoices')
  const toast = useToast()
  const confirm = useConfirm()
  const [tick, setTick] = useState(0)
  const reload = () => setTick((t) => t + 1)
  const toggleShip = (id: string) =>
    setExpandedShip((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const { data: inv, loading, error } = useApi((s) => getInvoice(invoiceId, s), [invoiceId, tick])
  // Подсказка «есть невыставленное хранение» — только пока хранение не привязано.
  const { data: uninvStor } = useApi(
    (s) => inv?.client_id && !inv.storage && (isInvoiceDraft(inv.status) || isInvoiceActive(inv.status))
      ? getUninvoicedStorage(inv.client_id, s)
      : Promise.resolve({ items: [], total_amount_kop: 0 }),
    [inv?.client_id, inv?.storage, inv?.status, tick],
  )

  const [payOpen, setPayOpen] = useState(false)
  const [dueOpen, setDueOpen] = useState(false)
  const [amountOpen, setAmountOpen] = useState(false)
  const [attachOpen, setAttachOpen] = useState(false)
  const [attachRecOpen, setAttachRecOpen] = useState(false)
  const [attachExtraOpen, setAttachExtraOpen] = useState(false)
  const [attachStorageOpen, setAttachStorageOpen] = useState(false)
  const [discountOpen, setDiscountOpen] = useState(false)
  const [expandedShip, setExpandedShip] = useState<Set<string>>(new Set())
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [draftDirty, setDraftDirty] = useState(false)
  const [draftSaving, setDraftSaving] = useState(false)
  const [showReasons, setShowReasons] = useState(false)
  const draftSave = useRef<() => Promise<DraftSaveResult>>(async () => null)
  const draftSetAmount = useRef<((kopecks: number) => void) | null>(null)

  if (loading && !inv) {
    return (
      <div className="page">
        <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
          <div style={{ width: 28, height: 28, border: '2.5px solid var(--c-border)', borderTopColor: 'var(--c-accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
        </div>
      </div>
    )
  }
  if (error || !inv) {
    return (
      <div className="page">
        <div className="card" style={{ padding: 16, color: 'var(--c-danger)' }}>{error?.message ?? 'Счёт не найден'}</div>
      </div>
    )
  }

  const active = isInvoiceActive(inv.status)
  const draft = isInvoiceDraft(inv.status)
  const cancelled = inv.status === 'cancelled'
  const editable = draft || active          // состав отгрузок / файлов
  const phase = invoicePhase(inv.status)

  const dueChanges = parseDueHistory(inv.ops)
  const duePrevRaw = dueChanges.length ? dueChanges[dueChanges.length - 1].from : null
  const lastPayment = inv.payments.length ? inv.payments[inv.payments.length - 1] : null
  const issueOp = inv.ops.find((o) => o.op_type === 'issue')

  const stamps = {
    draft: fmtDateShort(inv.created_at),
    issued: issueOp ? fmtDateShort(issueOp.created_at) : (draft ? undefined : fmtDateShort(inv.created_at)),
    paying: lastPayment ? fmtDateShort(lastPayment.paid_on ?? lastPayment.created_at) : undefined,
    closed: inv.status === 'closed' && inv.updated_at ? fmtDateShort(inv.updated_at) : undefined,
  }

  const docCount = inv.shipments.length + inv.receipts.length + inv.extra_income.length + (inv.storage ? 1 : 0)
  // Готовность к выставлению (draft → issued): зеркало серверных гейтов.
  const issueChecklist = [
    { ok: docCount > 0, label: docCount > 0 ? `Привязаны документы (${inv.shipments.length} отгр. · ${inv.receipts.length} пост. · ${inv.extra_income.length} доп.${inv.storage ? ' · хранение' : ''})` : 'Привяжите отгрузку, поступление, доп. работу или хранение' },
    { ok: inv.total_amount > 0, label: inv.total_amount > 0 ? `Сумма счёта ${formatMoneyKopecks(inv.total_amount)}` : 'Укажите сумму счёта' },
    { ok: !!inv.due_date, label: inv.due_date ? `Срок расчёта ${fmtDate(inv.due_date)}` : 'Укажите плановую дату расчёта' },
    { ok: inv.files.length > 0, label: inv.files.length > 0 ? `Файл прикреплён (${inv.files.length})` : 'Прикрепите файл счёта' },
  ]
  // Причины блокировки перехода — те же гейты, что и на сервере (см. router.issue_invoice).
  const issueReasons = issueChecklist.filter((c) => !c.ok).map((c) => c.label)
  const headerReasons = showReasons && draft ? issueReasons : []

  async function handleIssue() {
    if (!inv) return
    // Выставление подразумевает сохранение: несохранённую правку черновика сначала пишем,
    // потом проверяем гейты против только что сохранённых значений.
    let amount = inv.total_amount
    let due = inv.due_date
    if (draftDirty) {
      const saved = await draftSave.current()
      if (!saved) return
      amount = saved.total_amount
      due = saved.due_date
    }
    const reasons = [
      inv.shipments.length + inv.receipts.length + inv.extra_income.length + (inv.storage ? 1 : 0) === 0 ? 'Привяжите отгрузку, поступление, доп. работу или хранение' : null,
      amount <= 0 ? 'Укажите сумму счёта' : null,
      !due ? 'Укажите плановую дату расчёта' : null,
      inv.files.length === 0 ? 'Прикрепите файл счёта' : null,
    ].filter((r): r is string => r != null)
    if (reasons.length) { setShowReasons(true); toast(`Нельзя выставить счёт: ${reasons[0]}`, 'error'); return }
    setShowReasons(false)
    issueInvoice(inv.id).then(() => { toast('Счёт выставлен', 'success'); reload() }).catch((e) => toast(e.message, 'error'))
  }

  async function handleCancel() {
    if (!inv) return
    const ok = await confirm({
      title: 'Аннулировать счёт?',
      body: `Счёт ${inv.doc_number} будет аннулирован, привязанные отгрузки и поступления освободятся. Это действие нельзя отменить.`,
      danger: true, confirmLabel: 'Аннулировать',
    })
    if (!ok) return
    cancelInvoice(inv.id).then(() => { toast('Счёт аннулирован', 'success'); reload() }).catch((e) => toast(e.message, 'error'))
  }

  async function handleDetach(shipmentDocId: string, docNumber: string) {
    if (!inv) return
    const ok = await confirm({ title: 'Отвязать отгрузку?', body: `Отгрузка ${docNumber} вернётся в реестр «без счёта».`, confirmLabel: 'Отвязать' })
    if (!ok) return
    detachInvoiceShipment(inv.id, shipmentDocId).then(() => { toast('Отгрузка отвязана', 'success'); reload() }).catch((e) => toast(e.message, 'error'))
  }

  async function handleDetachReceipt(receiptDocId: string, docNumber: string) {
    if (!inv) return
    const ok = await confirm({ title: 'Отвязать поступление?', body: `Поступление ${docNumber} вернётся в реестр «без счёта».`, confirmLabel: 'Отвязать' })
    if (!ok) return
    detachInvoiceReceipt(inv.id, receiptDocId).then(() => { toast('Поступление отвязано', 'success'); reload() }).catch((e) => toast(e.message, 'error'))
  }

  async function handleDetachExtra(entryId: string, label: string) {
    if (!inv) return
    const ok = await confirm({ title: 'Отвязать доп. работу?', body: `«${label}» вернётся в пул невыставленных доп. работ.`, confirmLabel: 'Отвязать' })
    if (!ok) return
    detachInvoiceExtraIncome(inv.id, entryId).then(() => { toast('Доп. работа отвязана', 'success'); reload() }).catch((e) => toast(e.message, 'error'))
  }

  async function handleRemoveDiscount(discountId: string, reason: string, amountKop: number) {
    if (!inv) return
    const ok = await confirm({
      title: 'Снять скидку?',
      body: `Скидка ${formatMoneyKopecks(amountKop)} («${reason}») будет снята: сумма счёта восстановится, расход в реестре сторнируется.`,
      danger: true, confirmLabel: 'Снять',
    })
    if (!ok) return
    removeInvoiceDiscount(inv.id, discountId).then(() => { toast('Скидка снята', 'success'); reload() }).catch((e) => toast(e.message, 'error'))
  }

  async function handleDetachStorage() {
    if (!inv || !inv.storage) return
    const ok = await confirm({
      title: 'Отвязать хранение?',
      body: `Начисления ${fmtDate(inv.storage.period_from)} — ${fmtDate(inv.storage.period_to)} (${inv.storage.days} дн.) снова станут доступны для счёта.`,
      confirmLabel: 'Отвязать',
    })
    if (!ok) return
    detachInvoiceStorage(inv.id).then(() => { toast('Хранение отвязано', 'success'); reload() }).catch((e) => toast(e.message, 'error'))
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !inv) return
    setUploading(true)
    uploadInvoiceFile(inv.id, file)
      .then(() => { toast('Файл прикреплён', 'success'); reload() })
      .catch((err) => toast(err.message, 'error'))
      .finally(() => setUploading(false))
  }

  async function handleDeleteFile(fileId: string, name: string) {
    if (!inv) return
    const ok = await confirm({ title: 'Удалить файл?', body: name, danger: true, confirmLabel: 'Удалить' })
    if (!ok) return
    deleteInvoiceFile(inv.id, fileId).then(() => { toast('Файл удалён', 'success'); reload() }).catch((e) => toast(e.message, 'error'))
  }

  return (
    <div className="page">
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.pdf,.png,.jpg,.jpeg" style={{ display: 'none' }} onChange={handleFileChange} />

      <DocHeader
        badges={<>
          <Badge tone={invoiceStatusTone(inv.status)} dot>{inv.status_label}</Badge>
          {inv.overdue && <Badge tone="danger" dot>Просрочен</Badge>}
        </>}
        role={cancelled ? null : 'manager'}
        title={inv.doc_number}
        subtitle={inv.client_name ?? undefined}
        onBack={goBack}
        blockReasons={headerReasons}
        actions={
          draft ? (
            <>
              {draftDirty && (
                <button className="btn" onClick={() => draftSave.current()} disabled={draftSaving}>
                  <Icon name="save" size={14} />Сохранить изменения
                </button>
              )}
              <button className="btn primary" onClick={handleIssue}>
                <Icon name="receipt" size={14} />Выставить счёт
              </button>
              <button className="btn ghost danger" onClick={handleCancel}><Icon name="x" size={14} />Аннулировать</button>
            </>
          ) : active ? (
            <>
              <button className="btn ghost" onClick={() => setAmountOpen(true)}><Icon name="edit" size={14} />Скорректировать сумму</button>
              <button className="btn ghost" onClick={() => setDueOpen(true)}><Icon name="calendar" size={14} />Перенести срок</button>
              <button className="btn ghost danger" onClick={handleCancel}><Icon name="x" size={14} />Аннулировать</button>
            </>
          ) : undefined
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 360px', gap: 18, alignItems: 'start' }}>
        {/* Главная колонка */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {draft
            ? <DraftParamsPanel inv={inv} markRequired={showReasons} onSaved={reload} onDirty={setDraftDirty} onBusy={setDraftSaving} saveRef={draftSave} setAmountRef={draftSetAmount} />
            : <FinanceSummary total={inv.total_amount} paid={inv.paid_amount} dueDate={fmtDate(inv.due_date)} overdue={inv.overdue} cancelled={cancelled} />}

          <InvoiceSection
            icon="truckOut" title="Отгрузки" count={inv.shipments.length} accent="var(--c-accent)" state={editable ? 'active' : 'done'}
            right={editable ? (
              <button className="btn ghost sm" onClick={() => setAttachOpen(true)}>
                <Icon name="plus" size={12} />Добавить
              </button>
            ) : undefined}
          >
            {inv.shipments.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--c-text-subtle)', padding: '4px 0' }}>Нет привязанных отгрузок.</div>
            ) : (
              <>
              <table className="t" style={{ margin: '0 -14px', width: 'calc(100% + 28px)' }}>
                <tbody>
                  {inv.shipments.map((s) => {
                    const open = expandedShip.has(s.shipment_doc_id)
                    return (
                      <Fragment key={s.shipment_doc_id}>
                        <tr>
                          <td style={{ width: 120 }}>
                            <button
                              className="btn ghost sm" style={{ padding: '2px 6px', height: 'auto' }}
                              title="Открыть отгрузку" onClick={() => navigate(`/inventory/dispatches/${s.shipment_doc_id}`)}
                            >
                              <span className="mono" style={{ fontWeight: 500, color: 'var(--c-accent-text)' }}>{s.doc_number}</span>
                            </button>
                          </td>
                          <td style={{ width: 84 }}><CargoTag cargoType={s.cargo_type} /></td>
                          <td><span style={{ color: 'var(--c-text-subtle)' }}>{s.destination ?? '—'}</span></td>
                          <td style={{ width: 104 }}><span className="mono" style={{ color: 'var(--c-text-subtle)', fontSize: 12 }}>{fmtDate(s.ship_date)}</span></td>
                          <td style={{ width: 110, textAlign: 'right', whiteSpace: 'nowrap' }}><span className="mono" style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>{s.total_qty} шт · {s.sku_count} SKU</span></td>
                          <td style={{ width: 110, textAlign: 'right', whiteSpace: 'nowrap' }} title="Логистика для клиента"><span className="mono" style={{ fontSize: 12, color: s.logistics_cost_kop > 0 ? 'var(--c-text)' : 'var(--c-text-faint)' }}>{formatMoneyKopecks(s.logistics_cost_kop)}</span></td>
                          <td style={{ width: 84, textAlign: 'right' }}>
                            {/* «Отвязать» — крайнее справа (деструктивное действие), шеврон состава слева от него.
                                Слот удаления зарезервирован по ширине, поэтому шеврон не сдвигается, когда на
                                финальных статусах кнопка удаления исчезает. */}
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, justifyContent: 'flex-end' }}>
                              <button className="btn ghost icon sm" title={open ? 'Свернуть состав' : 'Показать состав'} onClick={() => toggleShip(s.shipment_doc_id)}>
                                <Icon name={open ? 'chevUp' : 'chevDown'} size={14} />
                              </button>
                              <span style={{ width: 26, display: 'inline-flex', justifyContent: 'center' }}>
                                {editable && (
                                  <button className="btn ghost icon sm" title="Отвязать" onClick={() => handleDetach(s.shipment_doc_id, s.doc_number)}>
                                    <Icon name="x" size={13} />
                                  </button>
                                )}
                              </span>
                            </span>
                          </td>
                        </tr>
                        {open && (
                          <tr>
                            <td colSpan={7} style={{ background: 'var(--c-bg-sunken)', padding: '8px 14px 10px 16px' }}>
                              <ShipmentContentsPanel shipmentId={s.shipment_doc_id} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
              <SelectedContentsRollup shipmentIds={inv.shipments.map((s) => s.shipment_doc_id)} label="Сводка по товарам" />
              </>
            )}
          </InvoiceSection>

          <InvoiceSection
            icon="truckIn" title="Поступления" count={inv.receipts.length} accent="var(--c-accent)" state={editable ? 'active' : 'done'}
            right={editable ? (
              <button className="btn ghost sm" onClick={() => setAttachRecOpen(true)}>
                <Icon name="plus" size={12} />Добавить
              </button>
            ) : undefined}
          >
            {inv.receipts.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--c-text-subtle)', padding: '4px 0' }}>Нет привязанных поступлений.</div>
            ) : (
              <>
              <table className="t" style={{ margin: '0 -14px', width: 'calc(100% + 28px)' }}>
                <tbody>
                  {inv.receipts.map((rec) => (
                    <tr key={rec.receipt_doc_id}>
                      <td style={{ width: 120 }}>
                        <button
                          className="btn ghost sm" style={{ padding: '2px 6px', height: 'auto' }}
                          title="Открыть поступление" onClick={() => navigate(`/inventory/receipts/${rec.receipt_doc_id}`)}
                        >
                          <span className="mono" style={{ fontWeight: 500, color: 'var(--c-accent-text)' }}>{rec.doc_number}</span>
                        </button>
                      </td>
                      <td><span style={{ color: 'var(--c-text-subtle)' }}>{rec.supplier_name ?? '—'}</span></td>
                      <td style={{ width: 104 }}><span className="mono" style={{ color: 'var(--c-text-subtle)', fontSize: 12 }}>{fmtDate(rec.arrival_date)}</span></td>
                      <td style={{ width: 110, textAlign: 'right', whiteSpace: 'nowrap' }}><span className="mono" style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>{rec.total_qty} шт · {rec.sku_count} SKU</span></td>
                      <td style={{ width: 110, textAlign: 'right', whiteSpace: 'nowrap' }} title="Логистика для клиента"><span className="mono" style={{ fontSize: 12, color: rec.logistics_cost_kop > 0 ? 'var(--c-text)' : 'var(--c-text-faint)' }}>{formatMoneyKopecks(rec.logistics_cost_kop)}</span></td>
                      <td style={{ width: 58, textAlign: 'right' }}>
                        <span style={{ width: 26, display: 'inline-flex', justifyContent: 'center' }}>
                          {editable && (
                            <button className="btn ghost icon sm" title="Отвязать" onClick={() => handleDetachReceipt(rec.receipt_doc_id, rec.doc_number)}>
                              <Icon name="x" size={13} />
                            </button>
                          )}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <SelectedReceiptsRollup receiptIds={inv.receipts.map((r) => r.receipt_doc_id)} label="Логистика по поступлениям" />
              </>
            )}
          </InvoiceSection>

          <InvoiceSection
            icon="briefcase" title="Доп. работы" count={inv.extra_income.length} accent="var(--c-accent)" state={editable ? 'active' : 'done'}
            right={editable ? (
              <button className="btn ghost sm" onClick={() => setAttachExtraOpen(true)}>
                <Icon name="plus" size={12} />Добавить
              </button>
            ) : undefined}
          >
            {inv.extra_income.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--c-text-subtle)', padding: '4px 0' }}>Нет привязанных доп. работ (переборка, переклейка ШК и т.п.).</div>
            ) : (
              <>
              <table className="t" style={{ margin: '0 -14px', width: 'calc(100% + 28px)' }}>
                <tbody>
                  {inv.extra_income.map((ex) => (
                    <tr key={ex.entry_id}>
                      <td style={{ width: 104 }}><span className="mono" style={{ color: 'var(--c-text-subtle)', fontSize: 12 }}>{fmtDate(ex.entry_date)}</span></td>
                      <td>
                        <span>{ex.category_name ?? 'Доп. работа'}</span>
                        {ex.comment && <span style={{ color: 'var(--c-text-subtle)' }}> · {ex.comment}</span>}
                      </td>
                      <td style={{ width: 90, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <span className="mono" style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>{ex.qty != null ? `${ex.qty} шт.` : ''}</span>
                      </td>
                      <td style={{ width: 110, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <span className="mono" style={{ fontSize: 12, color: 'var(--c-text)' }}>{formatMoneyKopecks(ex.amount_kop)}</span>
                      </td>
                      <td style={{ width: 58, textAlign: 'right' }}>
                        <span style={{ width: 26, display: 'inline-flex', justifyContent: 'center' }}>
                          {editable && (
                            <button className="btn ghost icon sm" title="Отвязать" onClick={() => handleDetachExtra(ex.entry_id, ex.category_name ?? 'Доп. работа')}>
                              <Icon name="x" size={13} />
                            </button>
                          )}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 12.5 }}>
                <span style={{ color: 'var(--c-text-subtle)' }}>Итого доп. работ:</span>
                <span className="mono" style={{ fontWeight: 600 }}>{formatMoneyKopecks(inv.extra_income_kop)}</span>
              </div>
              </>
            )}
          </InvoiceSection>

          <InvoiceSection
            icon="archive" title="Хранение" count={inv.storage ? inv.storage.days : 0} accent="var(--c-accent)" state={editable ? 'active' : 'done'}
            right={editable && !inv.storage ? (
              <button className="btn ghost sm" onClick={() => setAttachStorageOpen(true)}>
                <Icon name="plus" size={12} />Добавить
              </button>
            ) : undefined}
          >
            {!inv.storage ? (
              editable && (uninvStor?.items.length ?? 0) > 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 13 }}>
                  <Icon name="alert" size={14} style={{ color: 'var(--c-warning)', flexShrink: 0 }} />
                  <span>
                    У клиента есть невыставленное хранение:{' '}
                    <b className="mono">{formatMoneyKopecks(uninvStor?.total_amount_kop ?? 0)}</b>
                    <span style={{ color: 'var(--c-text-subtle)' }}>
                      {' '}({uninvStor?.items.map((m) => m.month_label).join(', ')})
                    </span>
                  </span>
                </div>
              ) : (
                <div style={{ fontSize: 13, color: 'var(--c-text-subtle)', padding: '4px 0' }}>
                  Начисления за хранение остатков не привязаны. Суммы по дням — в разделе «Финансы → Хранение».
                </div>
              )
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0', fontSize: 13 }}>
                <span className="mono" style={{ color: 'var(--c-text-subtle)' }}>
                  {fmtDate(inv.storage.period_from)} — {fmtDate(inv.storage.period_to)}
                </span>
                <span style={{ color: 'var(--c-text-subtle)' }}>{inv.storage.days} дн.</span>
                <span className="mono" style={{ fontWeight: 600, marginLeft: 'auto' }}>{formatMoneyKopecks(inv.storage.amount_kop)}</span>
                {editable && (
                  <button className="btn ghost icon sm" title="Отвязать хранение" onClick={handleDetachStorage}>
                    <Icon name="x" size={13} />
                  </button>
                )}
              </div>
            )}
          </InvoiceSection>

          <InvoiceSection
            icon="tag" title="Скидки" count={inv.discounts.length} accent="var(--c-danger)" state={editable ? 'active' : 'done'}
            right={editable ? (
              <button className="btn ghost sm" onClick={() => setDiscountOpen(true)}>
                <Icon name="plus" size={12} />Добавить
              </button>
            ) : undefined}
          >
            {inv.discounts.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--c-text-subtle)', padding: '4px 0' }}>
                Скидок нет. Скидка вычитается из суммы счёта и автоматически попадает в «Расходы».
              </div>
            ) : (
              <>
              <table className="t" style={{ margin: '0 -14px', width: 'calc(100% + 28px)' }}>
                <tbody>
                  {inv.discounts.map((d) => (
                    <tr key={d.id}>
                      <td style={{ width: 104 }}><span className="mono" style={{ color: 'var(--c-text-subtle)', fontSize: 12 }}>{fmtDate(d.created_at.slice(0, 10))}</span></td>
                      <td>{d.reason}</td>
                      <td style={{ width: 190, textAlign: 'right' }}><span className="t-sub">{d.created_by_name ?? '—'}</span></td>
                      <td style={{ width: 110, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-danger)' }}>−{formatMoneyKopecks(d.amount_kop)}</span>
                      </td>
                      <td style={{ width: 58, textAlign: 'right' }}>
                        <span style={{ width: 26, display: 'inline-flex', justifyContent: 'center' }}>
                          {editable && (
                            <button className="btn ghost icon sm" title="Снять скидку" onClick={() => handleRemoveDiscount(d.id, d.reason, d.amount_kop)}>
                              <Icon name="x" size={13} />
                            </button>
                          )}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 12.5 }}>
                <span style={{ color: 'var(--c-text-subtle)' }}>Итого скидка:</span>
                <span className="mono" style={{ fontWeight: 600, color: 'var(--c-danger)' }}>−{formatMoneyKopecks(inv.discount_kop)}</span>
              </div>
              </>
            )}
          </InvoiceSection>

          {!draft && (
            <InvoiceSection
              icon="coins" title="Оплаты" count={inv.payments.length} accent="var(--c-warning)" state={active ? 'active' : 'done'}
              right={active ? (
                <button className="btn ghost sm" onClick={() => setPayOpen(true)}>
                  <Icon name="plus" size={12} />Внести оплату
                </button>
              ) : undefined}
            >
              {inv.payments.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--c-text-subtle)', padding: '4px 0' }}>Оплат пока нет — внесите первое поступление.</div>
              ) : (
                <table className="t" style={{ margin: '0 -14px', width: 'calc(100% + 28px)' }}>
                  <tbody>
                    {inv.payments.map((p) => (
                      <tr key={p.id}>
                        <td className="num" style={{ width: 150, fontWeight: 600, color: p.reverses_id ? 'var(--c-danger)' : undefined }}>
                          {p.reverses_id && '−'}{formatMoneyKopecks(Math.abs(p.amount))}
                        </td>
                        <td style={{ width: 120 }}><span className="mono" style={{ color: 'var(--c-text-subtle)', fontSize: 12 }}>{fmtDate(p.paid_on)}</span></td>
                        <td><span style={{ color: 'var(--c-text-muted)' }}>{p.comment ?? ''}</span></td>
                        <td style={{ width: 190, textAlign: 'right' }}><span className="t-sub">{p.created_by_email ?? '—'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </InvoiceSection>
          )}

          <InvoiceSection
            icon="paperclip" title="Файлы" count={inv.files.length} accent="var(--c-info)" state={!cancelled && inv.files.length === 0 ? 'active' : 'done'}
            right={!cancelled ? (
              <button className="btn ghost sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
                <Icon name={uploading ? 'refresh' : 'paperclip'} size={12} />{uploading ? 'Загрузка…' : 'Прикрепить'}
              </button>
            ) : undefined}
          >
            {inv.files.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--c-text-subtle)', padding: '4px 0' }}>Файлы (например, расчёт Excel) не прикреплены.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {inv.files.map((f) => (
                  <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: '1px solid var(--c-border)', borderRadius: 'var(--r-md)' }}>
                    <FileTypeIcon filename={f.filename} />
                    <a href={resolvePublicUploadSrc(f.url)} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: 'var(--c-text)', textDecoration: 'none', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {f.filename}
                    </a>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--c-text-subtle)' }}>{fmtDate(f.created_at.slice(0, 10))}</span>
                    <a href={resolvePublicUploadSrc(f.url)} target="_blank" rel="noreferrer" className="btn ghost icon sm" title="Скачать"><Icon name="download" size={13} /></a>
                    {!cancelled && <button className="btn ghost icon sm" title="Удалить" onClick={() => handleDeleteFile(f.id, f.filename)}><Icon name="trash" size={13} /></button>}
                  </div>
                ))}
              </div>
            )}
          </InvoiceSection>

          <InvoiceSection icon="history" title="Журнал" count={inv.ops.length} accent="var(--c-text-muted)" state="done">
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {inv.ops.slice().reverse().map((op, i, arr) => (
                <div key={op.id} style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: i < arr.length - 1 ? '1px solid var(--c-border)' : 'none' }}>
                  <div style={{ width: 9, height: 9, borderRadius: '50%', background: OP_DOT[op.op_type as InvoiceOpType] ?? 'var(--c-border-strong)', marginTop: 5, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13 }}>
                      <span style={{ fontWeight: 500 }}>{INVOICE_OP_LABELS[op.op_type as InvoiceOpType] ?? op.op_type}</span>
                      {op.comment && <span style={{ color: 'var(--c-text-muted)' }}> — {op.comment}</span>}
                    </div>
                    <div className="t-sub">{fmtDateTime(op.created_at)}{op.created_by_email ? ` · ${op.created_by_email}` : ''}</div>
                  </div>
                </div>
              ))}
            </div>
          </InvoiceSection>
        </div>

        {/* Правая колонка */}
        <div className="detail-side">
          <InvoiceRailPanel phase={phase} overdue={inv.overdue} dueReached={inv.due_reached} dueDate={fmtDate(inv.due_date)} duePrev={duePrevRaw ? fmtDate(duePrevRaw) : null} stamps={stamps} />

          <InvoiceSummaryPanel
            clientName={inv.client_name}
            shipmentCount={inv.shipments.length}
            receiptCount={inv.receipts.length}
            extraCount={inv.extra_income.length}
            extraAmountKop={inv.extra_income_kop}
            discountKop={inv.discount_kop}
            totalQty={inv.shipments.reduce((a, s) => a + s.total_qty, 0) + inv.receipts.reduce((a, r) => a + r.total_qty, 0)}
            dueDateText={fmtDate(inv.due_date)}
            amountKop={inv.total_amount}
            shipmentIds={inv.shipments.map((s) => s.shipment_doc_id)}
            receiptIds={inv.receipts.map((r) => r.receipt_doc_id)}
            onApplyAmount={draft ? ((kop) => draftSetAmount.current?.(kop)) : undefined}
          />

          {draft && <ChecklistPanel title="Готовность к выставлению" items={issueChecklist} />}

          {inv.status === 'closed' && (
            <div className="card" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 10, background: 'var(--c-success-bg)', border: '1px solid transparent' }}>
              <Icon name="check" size={18} style={{ color: 'var(--c-success)' }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-success)' }}>Счёт завершён</div>
                <div style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>оплачен полностью{inv.updated_at ? ` · ${fmtDate(inv.updated_at.slice(0, 10))}` : ''}</div>
              </div>
            </div>
          )}

          {cancelled && (
            <div className="card" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 10, background: 'var(--c-danger-bg)', border: '1px solid transparent' }}>
              <Icon name="x" size={18} style={{ color: 'var(--c-danger)' }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-danger)' }}>Счёт аннулирован</div>
                <div style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>отгрузки освобождены</div>
              </div>
            </div>
          )}

          {!draft && inv.comment && (
            <Panel icon="edit" title="Комментарий" iconColor="var(--c-text-muted)">
              <div style={{ fontSize: 12.5, color: 'var(--c-text-muted)', lineHeight: 1.5 }}>{inv.comment}</div>
            </Panel>
          )}
        </div>
      </div>

      {payOpen && <PayModal invoice={inv} onClose={() => setPayOpen(false)} onDone={() => { setPayOpen(false); reload() }} />}
      {dueOpen && <DueModal invoice={inv} onClose={() => setDueOpen(false)} onDone={() => { setDueOpen(false); reload() }} />}
      {amountOpen && <AmountModal invoice={inv} onClose={() => setAmountOpen(false)} onDone={() => { setAmountOpen(false); reload() }} />}
      {attachOpen && <AttachModal invoice={inv} onClose={() => setAttachOpen(false)} onDone={() => { setAttachOpen(false); reload() }} />}
      {attachRecOpen && <AttachReceiptsModal invoice={inv} onClose={() => setAttachRecOpen(false)} onDone={() => { setAttachRecOpen(false); reload() }} />}
      {attachExtraOpen && <AttachExtraIncomeModal invoice={inv} onClose={() => setAttachExtraOpen(false)} onDone={() => { setAttachExtraOpen(false); reload() }} />}
      {attachStorageOpen && <AttachStorageModal invoice={inv} onClose={() => setAttachStorageOpen(false)} onDone={() => { setAttachStorageOpen(false); reload() }} />}
      {discountOpen && <DiscountModal invoice={inv} onClose={() => setDiscountOpen(false)} onDone={() => { setDiscountOpen(false); reload() }} />}
    </div>
  )
}

// ── Правка реквизитов черновика ──────────────────────────────────────────────
function DraftParamsPanel({ inv, markRequired, onSaved, onDirty, onBusy, saveRef, setAmountRef }: {
  inv: InvoiceDetail
  markRequired: boolean
  onSaved: () => void
  onDirty: (d: boolean) => void
  onBusy: (b: boolean) => void
  saveRef: React.MutableRefObject<() => Promise<DraftSaveResult>>
  setAmountRef: React.MutableRefObject<((kopecks: number) => void) | null>
}) {
  const toast = useToast()
  const { clients } = useLookups()
  const [clientId, setClientId] = useState(inv.client_id ?? '')
  const [dueDate, setDueDate] = useState(inv.due_date ?? '')
  const [amount, setAmount] = useState(inv.total_amount ? String(inv.total_amount / 100) : '')
  const [comment, setComment] = useState(inv.comment ?? '')
  const [busy, setBusy] = useState(false)

  const kopecks = parseRublesToKopecks(amount)
  const clientChanged = clientId !== (inv.client_id ?? '')
  const hasShipments = inv.shipments.length > 0 || inv.receipts.length > 0 || inv.extra_income.length > 0
  const amountInvalid = markRequired && (kopecks == null || kopecks <= 0)
  const dueInvalid = markRequired && !dueDate
  const clientInvalid = markRequired && !clientId
  const dirty =
    clientChanged ||
    dueDate !== (inv.due_date ?? '') ||
    (kopecks ?? 0) !== inv.total_amount ||
    comment.trim() !== (inv.comment ?? '')

  async function save(): Promise<DraftSaveResult> {
    if (!clientId) { toast('Укажите клиента', 'error'); return null }
    if (amount && kopecks == null) { toast('Введите корректную сумму', 'error'); return null }
    if (clientChanged && hasShipments) { toast('Сначала отвяжите документы прежнего клиента', 'error'); return null }
    setBusy(true)
    return updateInvoice(inv.id, {
      client_id: clientId,
      client_name: clients.find((c) => c.id === clientId)?.name ?? null,
      due_date: dueDate || null,
      total_amount: kopecks ?? 0,
      comment: comment.trim() || null,
    })
      .then((): DraftSaveResult => { toast('Черновик сохранён', 'success'); onSaved(); return { total_amount: kopecks ?? 0, due_date: dueDate || null } })
      .catch((e): DraftSaveResult => { toast(e.message, 'error'); return null })
      .finally(() => setBusy(false))
  }

  useEffect(() => { saveRef.current = save })
  useEffect(() => {
    setAmountRef.current = (kop) => setAmount(String(kop / 100))
    return () => { setAmountRef.current = null }
  }, [setAmountRef])
  useEffect(() => { onDirty(dirty) }, [dirty, onDirty])
  useEffect(() => { onBusy(busy) }, [busy, onBusy])

  return (
    <InvoiceSection icon="receipt" title="Параметры черновика" accent="var(--c-accent)" state="active">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <DraftFieldLabel>Клиент</DraftFieldLabel>
          <Combobox
            value={clientId || null}
            onChange={(v) => setClientId(v ? String(v) : '')}
            options={clients.map((c) => ({ value: c.id, label: c.name }))}
            placeholder="Выберите клиента…"
            prefix="building"
            invalid={clientInvalid}
          />
          {clientChanged && hasShipments && (
            <div style={{ fontSize: 11.5, color: 'var(--c-danger)', marginTop: 4 }}>Сначала отвяжите документы прежнего клиента ниже.</div>
          )}
        </div>
        <div>
          <DraftFieldLabel>Плановая дата расчёта</DraftFieldLabel>
          <DatePicker value={dueDate} onChange={setDueDate} invalid={dueInvalid} />
        </div>
        <div>
          <DraftFieldLabel>Сумма счёта, ₽</DraftFieldLabel>
          <input
            className="input" inputMode="decimal" placeholder="например, 150000" value={amount}
            onChange={(e) => setAmount(e.target.value)}
            style={amountInvalid ? { borderColor: 'var(--c-danger)', background: 'var(--c-danger-bg)' } : undefined}
          />
          <div style={{ fontSize: 11.5, color: amount && kopecks == null ? 'var(--c-danger)' : amountInvalid ? 'var(--c-danger)' : 'var(--c-text-subtle)', marginTop: 4 }}>
            {amount && kopecks == null ? 'Введите число' : amountInvalid ? 'Укажите сумму счёта' : formatMoneyKopecks(kopecks ?? 0)}
          </div>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <DraftFieldLabel>Комментарий</DraftFieldLabel>
          <textarea className="input" rows={2} style={{ resize: 'vertical' }} placeholder="Необязательно" value={comment} onChange={(e) => setComment(e.target.value)} />
        </div>
      </div>
    </InvoiceSection>
  )
}

function DraftFieldLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--c-text-muted)', marginBottom: 6 }}>{children}</div>
}
