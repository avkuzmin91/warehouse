import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { useApi } from '../../../../hooks/useApi'
import { Icon } from '../../../primitives/Icon'
import { fmtDateTime, fmtYmdAsDmy, moscowTodayYmd, parseMoscow, MOSCOW_TZ } from '../../../../utils/format'
import {
  getReceipts, getReceiptLines, RECEIPT_STATUS_LABELS,
} from '../../../../api/receiptsApi'
import type { ReceiptStatus } from '../../../../api/receiptsApi'
import {
  listShipments, listShipmentLines,
} from '../../../../api/shipmentsApi'
import type { ShipmentCargoType, ShipmentStatus } from '../../../../api/shipmentsApi'
import {
  listDispatches, listDispatchLines,
} from '../../../../api/dispatchApi'
import type { DispatchCargoType, DispatchStatus } from '../../../../api/dispatchApi'

export type ActiveDocLine = {
  key: string
  product_sku: string | null
  product_name: string | null
  color_name: string | null
  size_name: string | null
  qty: number
}

export type ActiveDoc = {
  id: string
  doc_number: string
  status_label: string
  plan_date: string | null
  created_at: string | null
  created_by_name: string | null
  sku_count: number
  total_qty: number
  lines: ActiveDocLine[]
}

/**
 * Ключ варианта для подсветки пересечений с составом формы. Построчные списки
 * не отдают id цвета/размера, поэтому сравнение — по SKU (или имени товара,
 * если SKU ещё не присвоен) + названиям цвета и размера.
 */
export function activeDocVariantKey(
  sku: string | null | undefined,
  productName: string | null | undefined,
  colorName: string | null | undefined,
  sizeName: string | null | undefined,
): string {
  const base = (sku || '').trim().toLowerCase() || (productName || '').trim().toLowerCase()
  return `${base}|${(colorName || '').trim().toLowerCase()}|${(sizeName || '').trim().toLowerCase()}`
}

const DOCS_LIMIT = 50
const LINES_LIMIT = 200
const DOCS_SHOWN = 5
const LINES_COLLAPSED = 4

const ACTIVE_RECEIPT_STATUSES: ReceiptStatus[] = ['draft', 'planned', 'partially_received']
const ACTIVE_SHIPMENT_STATUSES: ShipmentStatus[] = ['draft', 'packing', 'on_packing', 'relocating']
const ACTIVE_DISPATCH_STATUSES: DispatchStatus[] = ['draft', 'awaiting_packing', 'preparing', 'awaiting_trip', 'partially_shipped']

export async function loadActiveReceipts(clientId: string, signal: AbortSignal): Promise<ActiveDoc[]> {
  const [docs, lines] = await Promise.all([
    getReceipts({ client_id: clientId, status: ACTIVE_RECEIPT_STATUSES, limit: DOCS_LIMIT }, signal),
    getReceiptLines({ client_id: clientId, status: ACTIVE_RECEIPT_STATUSES, limit: LINES_LIMIT }, signal),
  ])
  const byDoc = new Map<string, ActiveDocLine[]>()
  for (const l of lines.items) {
    const arr = byDoc.get(l.doc_id) ?? []
    arr.push({
      key: activeDocVariantKey(l.product_sku, l.product_name, l.color_name, l.size_name),
      product_sku: l.product_sku, product_name: l.product_name,
      color_name: l.color_name, size_name: l.size_name, qty: l.planned_qty,
    })
    byDoc.set(l.doc_id, arr)
  }
  return docs.items.map((d) => ({
    id: d.id,
    doc_number: d.doc_number,
    status_label: RECEIPT_STATUS_LABELS[d.status] ?? d.status,
    plan_date: d.arrival_date,
    created_at: d.created_at,
    created_by_name: d.created_by_name,
    sku_count: d.sku_count,
    total_qty: d.total_planned,
    lines: byDoc.get(d.id) ?? [],
  }))
}

export async function loadActiveShipments(clientId: string, cargoType: ShipmentCargoType, signal: AbortSignal): Promise<ActiveDoc[]> {
  const [docs, lines] = await Promise.all([
    listShipments({ client_id: clientId, cargo_type: cargoType, status: ACTIVE_SHIPMENT_STATUSES, limit: DOCS_LIMIT }, signal),
    listShipmentLines({ client_id: clientId, cargo_type: cargoType, status: ACTIVE_SHIPMENT_STATUSES, limit: LINES_LIMIT }, signal),
  ])
  const byDoc = new Map<string, ActiveDocLine[]>()
  for (const l of lines.items) {
    const arr = byDoc.get(l.doc_id) ?? []
    arr.push({
      key: activeDocVariantKey(l.product_sku, l.product_name, l.color_name, l.size_name),
      product_sku: l.product_sku, product_name: l.product_name,
      color_name: l.color_name, size_name: l.size_name, qty: l.qty,
    })
    byDoc.set(l.doc_id, arr)
  }
  return docs.items.map((d) => ({
    id: d.id,
    doc_number: d.doc_number,
    status_label: d.status_label,
    plan_date: d.ship_date,
    created_at: d.created_at,
    created_by_name: d.created_by_name ?? null,
    sku_count: d.sku_count,
    total_qty: d.total_qty,
    lines: byDoc.get(d.id) ?? [],
  }))
}

export async function loadActiveDispatches(clientId: string, cargoType: DispatchCargoType, signal: AbortSignal): Promise<ActiveDoc[]> {
  const [docs, lines] = await Promise.all([
    listDispatches({ client_id: clientId, cargo_type: cargoType, status: ACTIVE_DISPATCH_STATUSES, limit: DOCS_LIMIT }, signal),
    listDispatchLines({ client_id: clientId, cargo_type: cargoType, status: ACTIVE_DISPATCH_STATUSES, limit: LINES_LIMIT }, signal),
  ])
  const byDoc = new Map<string, ActiveDocLine[]>()
  for (const l of lines.items) {
    const arr = byDoc.get(l.doc_id) ?? []
    arr.push({
      key: activeDocVariantKey(l.product_sku, l.product_name, l.color_name, l.size_name),
      product_sku: l.product_sku, product_name: l.product_name,
      color_name: l.color_name, size_name: l.size_name, qty: l.qty,
    })
    byDoc.set(l.doc_id, arr)
  }
  return docs.items.map((d) => ({
    id: d.id,
    doc_number: d.doc_number,
    status_label: d.status_label,
    plan_date: d.ship_date,
    created_at: d.created_at,
    created_by_name: d.created_by_name ?? null,
    sku_count: d.sku_count,
    total_qty: d.total_qty,
    lines: byDoc.get(d.id) ?? [],
  }))
}

function pluralRu(n: number, forms: [string, string, string]): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return forms[0]
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1]
  return forms[2]
}

function moscowDayOfIso(iso: string | null): string {
  if (!iso) return ''
  const d = parseMoscow(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-CA', { timeZone: MOSCOW_TZ })
}

function variantLabel(l: ActiveDocLine): string {
  return [l.product_sku, l.color_name, l.size_name].filter(Boolean).join(' · ')
}

interface ClientActiveDocsPanelProps {
  clientId: string | null
  /** Формы существительного с прилагательным: [«активная задача упаковки», «активные задачи упаковки», «активных задач упаковки»]. */
  nounForms: [string, string, string]
  load: (clientId: string, signal: AbortSignal) => Promise<ActiveDoc[]>
  detailHref: (id: string) => string
  /** Ключи вариантов из состава формы (activeDocVariantKey) — совпадающие строки подсвечиваются. */
  formKeys?: string[]
  style?: CSSProperties
}

/**
 * «У клиента уже есть активные задачи этого типа» — пассивная защита от дублей
 * в формах создания: показывается после выбора клиента, не блокирует работу.
 */
export function ClientActiveDocsPanel({ clientId, nounForms, load, detailHref, formKeys, style }: ClientActiveDocsPanelProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const { data } = useApi(
    async (signal) => (clientId ? load(clientId, signal) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clientId],
  )
  const keySet = useMemo(() => new Set(formKeys ?? []), [formKeys])

  if (!clientId || !data || data.length === 0) return null

  const today = moscowTodayYmd()
  const shown = data.slice(0, DOCS_SHOWN)
  const hiddenCount = data.length - shown.length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--c-text-subtle)' }}>
        <Icon name="layers" size={13} style={{ flexShrink: 0 }} />
        <span>
          У клиента уже есть <b style={{ color: 'var(--c-text)' }}>{data.length}</b> {pluralRu(data.length, nounForms)} — проверьте, не дублируете ли задачу
        </span>
      </div>

      {shown.map((doc) => {
        const isToday = moscowDayOfIso(doc.created_at) === today
        const matches = doc.lines.filter((l) => keySet.has(l.key)).length
        const isOpen = !!expanded[doc.id]
        const visibleLines = isOpen ? doc.lines : doc.lines.slice(0, LINES_COLLAPSED)
        const restCount = doc.lines.length - visibleLines.length
        return (
          <div key={doc.id} style={{ border: '1px solid var(--c-border)', borderRadius: 'var(--r-lg, 12px)', overflow: 'hidden' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', flexWrap: 'wrap',
              background: 'var(--c-bg-sunken)', borderBottom: '1px solid var(--c-border)',
            }}>
              <span className="mono" style={{ fontWeight: 600, fontSize: 13 }}>{doc.doc_number}</span>
              <span className="badge" style={{ fontSize: 11 }}>{doc.status_label}</span>
              {isToday && (
                <span style={{
                  fontSize: 11, padding: '2px 8px', borderRadius: 6, fontWeight: 500,
                  background: 'var(--c-warning-bg)', color: 'var(--c-warning)',
                }}>
                  создан сегодня
                </span>
              )}
              {matches > 0 && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--c-warning)', fontWeight: 500 }}>
                  <Icon name="alert" size={11} />
                  {matches} {pluralRu(matches, ['позиция совпадает', 'позиции совпадают', 'позиций совпадает'])} с вашим составом
                </span>
              )}
              <a
                className="btn ghost sm"
                style={{ marginLeft: 'auto' }}
                href={detailHref(doc.id)}
                target="_blank"
                rel="noopener noreferrer"
                title="Откроется в новой вкладке — форма создания не потеряется"
              >
                Открыть<Icon name="arrowRight" size={11} style={{ marginLeft: 4 }} />
              </a>
            </div>

            <div style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '5px 12px', flexWrap: 'wrap',
              fontSize: 11.5, color: 'var(--c-text-muted)', borderBottom: doc.lines.length > 0 ? '1px solid var(--c-border)' : 'none',
            }}>
              {doc.plan_date && <span>план {fmtYmdAsDmy(doc.plan_date)}</span>}
              <span>{doc.sku_count} SKU · {doc.total_qty} шт</span>
              {doc.created_at && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Icon name="clock" size={11} />
                  {fmtDateTime(doc.created_at)}{doc.created_by_name ? ` · ${doc.created_by_name}` : ''}
                </span>
              )}
            </div>

            {doc.lines.length > 0 && (
              <div style={{ padding: '2px 12px 4px' }}>
                {visibleLines.map((l, i) => {
                  const hit = keySet.has(l.key)
                  return (
                    <div key={i} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
                      padding: '4px 6px', margin: '0 -6px', fontSize: 12, borderRadius: 6,
                      background: hit ? 'var(--c-warning-bg)' : 'transparent',
                    }}>
                      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {l.product_name || '—'}
                        {variantLabel(l) && (
                          <span className="mono" style={{ color: 'var(--c-text-subtle)', marginLeft: 8 }}>{variantLabel(l)}</span>
                        )}
                      </span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
                        {hit && <span style={{ fontSize: 10.5, color: 'var(--c-warning)', fontWeight: 500 }}>есть в вашем документе</span>}
                        <span className="num">{l.qty} шт</span>
                      </span>
                    </div>
                  )
                })}
                {restCount > 0 && (
                  <button
                    className="btn ghost sm"
                    style={{ margin: '2px 0 4px', fontSize: 11.5 }}
                    onClick={() => setExpanded((m) => ({ ...m, [doc.id]: true }))}
                  >
                    ещё {restCount} {pluralRu(restCount, ['позиция', 'позиции', 'позиций'])}…
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}

      {hiddenCount > 0 && (
        <div style={{ fontSize: 11.5, color: 'var(--c-text-muted)' }}>
          и ещё {hiddenCount} — полный список в разделе задач с фильтром по клиенту
        </div>
      )}
    </div>
  )
}
