import type { ReactNode } from 'react'
import { Icon } from '../../primitives/Icon'
import type { IconName } from '../../primitives/Icon'
import { Badge } from '../../primitives/Badge'
import { formatMoneyKopecks } from '../../../utils/format'
import { useApi } from '../../../hooks/useApi'
import { getShipment } from '../../../api/shipmentsApi'
import { getShipmentContents, getReceiptContents } from '../../../api/invoicesApi'
import type { ProductPreview } from '../../../api/invoicesApi'
import { Panel, ReadRow } from '../shared/process/processUI'

/** Компактные деньги для KPI: рубли без копеек, не растягивают карточку. «2 400 000 ₽». */
export function kpiMoney(kopecks: number): string {
  const rub = Math.floor(Math.abs(kopecks) / 100)
  return `${rub.toLocaleString('ru-RU')} ₽`
}

export type KpiTone = 'default' | 'warning' | 'danger'

/** KPI-карточка реестра счетов: иконка-акцент, метка, крупное число, подпись. */
export function Kpi({ icon, label, value, sub, tone = 'default' }: {
  icon: IconName
  label: string
  value: ReactNode
  sub?: string
  tone?: KpiTone
}) {
  const accent = tone === 'danger' ? 'var(--c-danger)' : tone === 'warning' ? 'var(--c-warning)' : 'var(--c-accent)'
  const valueColor = tone === 'danger' ? 'var(--c-danger)' : tone === 'warning' ? 'var(--c-warning)' : 'var(--c-text)'
  return (
    <div className="kpi">
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <div style={{
          width: 24, height: 24, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: `color-mix(in oklab, ${accent} 12%, transparent)`, color: accent,
        }}>
          <Icon name={icon} size={14} />
        </div>
        <span className="kpi-label">{label}</span>
      </div>
      <div className="kpi-value" style={{ fontSize: 24, color: valueColor, marginTop: 8 }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

/** Мини-прогресс оплаты для строк реестра: «оплачено» + полоска. */
export function PayBar({ total, paid }: { total: number; paid: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0
  const full = paid >= total && total > 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
      <span className="mono" style={{ fontSize: 12.5, color: full ? 'var(--c-success)' : paid > 0 ? 'var(--c-text)' : 'var(--c-text-faint)' }}>
        {formatMoneyKopecks(paid)}
      </span>
      <div className="prog" style={{ width: 46, height: 5, flexShrink: 0 }}>
        <div className={`prog-fill ${full ? 'ok' : 'warn'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

/** Финансовая сводка карточки — главный акцент: Сумма · Оплачено · Остаток · Срок + прогресс оплаты. */
export function FinanceSummary({ total, paid, dueDate, overdue, cancelled }: {
  total: number
  paid: number
  dueDate: string
  overdue: boolean
  cancelled: boolean
}) {
  const remaining = Math.max(0, total - paid)
  const pct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0
  const full = paid >= total && total > 0
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr) 1.2fr' }}>
        <FinCell label="Сумма счёта" value={formatMoneyKopecks(total)} />
        <FinCell label="Оплачено" value={formatMoneyKopecks(paid)} tone={full ? 'success' : paid > 0 ? 'info' : undefined} />
        <FinCell label="Остаток" value={cancelled ? '—' : formatMoneyKopecks(remaining)}
          tone={cancelled ? undefined : remaining > 0 ? 'warning' : full ? 'success' : undefined} big />
        <div style={{
          padding: '16px 18px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6,
          borderLeft: '1px solid var(--c-border)', background: 'var(--c-bg-sunken)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--c-text-subtle)' }}>
            <Icon name="calendar" size={13} />Срок расчёта
          </div>
          <div className="mono" style={{ fontSize: 15, fontWeight: 600, color: overdue ? 'var(--c-danger)' : 'var(--c-text)' }}>
            {dueDate}
          </div>
          {overdue && <Badge tone="danger" dot>Просрочен</Badge>}
        </div>
      </div>
      <div style={{ padding: '0 18px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
          <span style={{ fontSize: 11.5, color: 'var(--c-text-subtle)' }}>Прогресс оплаты</span>
          <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: full ? 'var(--c-success)' : 'var(--c-text-muted)' }}>
            {cancelled ? '—' : `${pct}%`}
          </span>
        </div>
        <div className="prog" style={{ height: 8 }}>
          <div className={`prog-fill ${full ? 'ok' : 'warn'}`} style={{ width: `${cancelled ? 0 : pct}%` }} />
        </div>
      </div>
    </div>
  )
}

function FinCell({ label, value, tone, big }: {
  label: string
  value: string
  tone?: 'success' | 'warning' | 'info'
  big?: boolean
}) {
  const color = tone === 'success' ? 'var(--c-success)' : tone === 'warning' ? 'var(--c-warning)'
    : tone === 'info' ? 'var(--c-info)' : 'var(--c-text)'
  return (
    <div style={{ padding: '16px 18px' }}>
      <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', marginBottom: 4 }}>{label}</div>
      <div className="mono" style={{ fontSize: big ? 24 : 20, fontWeight: 600, letterSpacing: '-0.02em', color }}>{value}</div>
    </div>
  )
}

/** Секция карточки счёта в стиле фазового блока (дизайн redesign-scheta):
 *  active — акцентная рамка + мягкое свечение + подкрашенная шапка + акцентная иконка;
 *  done — нейтральная рамка, обычная шапка, зелёная (success) иконка. */
export function InvoiceSection({ icon, title, count, accent = 'var(--c-accent)', state = 'done', right, children }: {
  icon: IconName
  title: string
  count?: number
  accent?: string
  state?: 'active' | 'done'
  right?: ReactNode
  children: ReactNode
}) {
  const isActive = state === 'active'
  const isDone = state === 'done'
  return (
    <div style={{
      border: `1px solid ${isActive ? accent : 'var(--c-border)'}`,
      borderRadius: 'var(--r-lg)', background: 'var(--c-bg-elev)', overflow: 'hidden',
      boxShadow: isActive ? `0 0 0 3px color-mix(in oklab, ${accent} 8%, transparent)` : 'none',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 9, padding: '11px 14px',
        borderBottom: '1px solid var(--c-border)',
        background: isActive ? `color-mix(in oklab, ${accent} 5%, var(--c-bg-elev))` : 'var(--c-bg-sunken)',
      }}>
        <div style={{
          width: 24, height: 24, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          background: isDone ? 'var(--c-success-bg)' : `color-mix(in oklab, ${accent} 14%, transparent)`,
          color: isDone ? 'var(--c-success)' : accent,
        }}>
          <Icon name={icon} size={14} />
        </div>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
        {count != null && (
          <span style={{
            fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--c-text-subtle)',
            background: 'var(--c-bg-elev)', border: '1px solid var(--c-border)', padding: '1px 7px', borderRadius: 99,
          }}>{count}</span>
        )}
        {right && <span style={{ marginLeft: 'auto' }}>{right}</span>}
      </div>
      <div style={{ padding: 14 }}>{children}</div>
    </div>
  )
}

/** Тип груза отгрузки: годный / брак. */
export function CargoTag({ cargoType }: { cargoType: string }) {
  return cargoType === 'defect'
    ? <Badge tone="danger">Брак</Badge>
    : <span style={{ fontSize: 12, color: 'var(--c-text-subtle)' }}>Годный</span>
}

/** Ленивая раскрывашка состава отгрузки: грузит строки по требованию
 *  (`getShipment`) и показывает компактную таблицу товар·цвет·размер·кол-во.
 *  Переиспользуется при выборе отгрузок (создание/привязка) и в карточке счёта —
 *  чтобы видеть содержимое, не уходя со страницы. */
export function ShipmentContentsPanel({ shipmentId }: { shipmentId: string }) {
  const { data, loading, error } = useApi(() => getShipment(shipmentId), [shipmentId])

  if (loading) {
    return <div style={{ fontSize: 12, color: 'var(--c-text-subtle)', padding: '4px 0' }}>Загрузка состава…</div>
  }
  if (error) {
    return <div style={{ fontSize: 12, color: 'var(--c-danger)', padding: '4px 0' }}>Не удалось загрузить состав отгрузки</div>
  }
  const lines = data?.lines ?? []
  if (lines.length === 0) {
    return <div style={{ fontSize: 12, color: 'var(--c-text-subtle)', padding: '4px 0' }}>В отгрузке нет строк</div>
  }
  return (
    <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ color: 'var(--c-text-faint)', textAlign: 'left' }}>
          <th style={{ fontWeight: 400, padding: '2px 8px 4px 0' }}>Товар</th>
          <th style={{ fontWeight: 400, padding: '2px 8px 4px 0' }}>Цвет</th>
          <th style={{ fontWeight: 400, padding: '2px 8px 4px 0' }}>Размер</th>
          <th style={{ fontWeight: 400, padding: '2px 0 4px', textAlign: 'right' }}>Кол-во</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.id}>
            <td style={{ padding: '3px 8px 3px 0' }}>
              {l.product_name}
              {l.product_sku && <span className="mono" style={{ color: 'var(--c-text-faint)', marginLeft: 6, fontSize: 11 }}>{l.product_sku}</span>}
            </td>
            <td style={{ padding: '3px 8px 3px 0', color: 'var(--c-text-subtle)' }}>{l.color_name ?? '—'}</td>
            <td style={{ padding: '3px 8px 3px 0', color: 'var(--c-text-subtle)' }}>{l.size_name ?? '—'}</td>
            <td className="mono num" style={{ padding: '3px 0', textAlign: 'right' }}>{l.qty}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Однострочный предпросмотр состава для свёрнутой строки: «Куртка ×220, Джинсы ×80 +2».
 *  `+N` — сколько ещё SKU сверх показанных (на основе общего sku_count отгрузки). */
export function productsPreviewText(preview: ProductPreview[], skuCount: number): string {
  if (!preview.length) return ''
  const shown = preview.map((p) => `${p.name} ×${p.qty}`).join(', ')
  const rest = skuCount - preview.length
  return rest > 0 ? `${shown} +${rest}` : shown
}

/** Сводка-roll-up по выбранным отгрузкам: товары с суммарным количеством.
 *  Грузит агрегат с бэкенда (`getShipmentContents`) при смене набора отгрузок —
 *  чтобы сверить сумму счёта с фактическим объёмом, не открывая отгрузки. */
export function SelectedContentsRollup({ shipmentIds, label = 'Сводка по выбранным отгрузкам', onApplyAmount }: { shipmentIds: string[]; label?: string; onApplyAmount?: (kopecks: number) => void }) {
  const key = [...shipmentIds].sort().join(',')
  const { data, loading } = useApi(
    (signal) => shipmentIds.length
      ? getShipmentContents(shipmentIds, signal)
      : Promise.resolve({ products: [], total_qty: 0, sku_count: 0, suggested_amount_kop: 0, logistics_amount_kop: 0, has_missing_price: false }),
    [key],
  )
  if (shipmentIds.length === 0) return null

  const products = data?.products ?? []
  const goods = data?.suggested_amount_kop ?? 0
  const logistics = data?.logistics_amount_kop ?? 0
  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--c-border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
        <span style={{ fontSize: 11.5, color: 'var(--c-text-subtle)' }}>{label}</span>
        {data && (
          <span className="mono" style={{ fontSize: 11.5, color: 'var(--c-text-muted)' }}>
            {data.total_qty.toLocaleString('ru-RU')} шт · {data.sku_count} SKU
          </span>
        )}
      </div>
      {data && (
        <CostBreakdown
          goods={goods} logistics={logistics}
          hasMissingPrice={data.has_missing_price}
          onApplyAmount={onApplyAmount}
        />
      )}
      {loading && !data ? (
        <div style={{ fontSize: 12, color: 'var(--c-text-subtle)' }}>Подсчёт…</div>
      ) : products.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--c-text-subtle)' }}>В выбранных отгрузках нет строк</div>
      ) : (
        <ProductChips products={products} />
      )}
    </div>
  )
}

/** Сводка-roll-up по выбранным поступлениям: логистика + товары (информационно).
 *  У поступлений нет товарного тарифа — в счёт идёт только их логистика. */
export function SelectedReceiptsRollup({ receiptIds, label = 'Сводка по выбранным поступлениям' }: { receiptIds: string[]; label?: string }) {
  const key = [...receiptIds].sort().join(',')
  const { data, loading } = useApi(
    (signal) => receiptIds.length
      ? getReceiptContents(receiptIds, signal)
      : Promise.resolve({ products: [], total_qty: 0, sku_count: 0, logistics_amount_kop: 0 }),
    [key],
  )
  if (receiptIds.length === 0) return null

  const products = data?.products ?? []
  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--c-border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
        <span style={{ fontSize: 11.5, color: 'var(--c-text-subtle)' }}>{label}</span>
        {data && (
          <span className="mono" style={{ fontSize: 11.5, color: 'var(--c-text-muted)' }}>
            {data.total_qty.toLocaleString('ru-RU')} шт · {data.sku_count} SKU
          </span>
        )}
      </div>
      {data && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          padding: '8px 10px', marginBottom: 8, borderRadius: 8, background: 'var(--c-bg-sunken)',
        }}>
          <span style={{ fontSize: 12, color: 'var(--c-text-subtle)' }}>Логистика:</span>
          <span className="mono" style={{ fontSize: 14, fontWeight: 700, color: 'var(--c-accent)' }}>
            {formatMoneyKopecks(data.logistics_amount_kop)}
          </span>
        </div>
      )}
      {loading && !data ? (
        <div style={{ fontSize: 12, color: 'var(--c-text-subtle)' }}>Подсчёт…</div>
      ) : products.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--c-text-subtle)' }}>В выбранных поступлениях нет строк</div>
      ) : (
        <ProductChips products={products} />
      )}
    </div>
  )
}

/** Итоговая разбивка счёта по выбранным отгрузкам и поступлениям:
 *  Товары (тарифы отгрузок) + Логистика (отгрузки + поступления) = Итого.
 *  Единая кнопка «В сумму счёта» проставляет объединённый итог. */
export function InvoiceTotalsRollup({ shipmentIds, receiptIds, onApplyAmount }: {
  shipmentIds: string[]
  receiptIds: string[]
  onApplyAmount?: (kopecks: number) => void
}) {
  const shipKey = [...shipmentIds].sort().join(',')
  const recKey = [...receiptIds].sort().join(',')
  const { data: ship } = useApi(
    (s) => shipmentIds.length
      ? getShipmentContents(shipmentIds, s)
      : Promise.resolve({ products: [], total_qty: 0, sku_count: 0, suggested_amount_kop: 0, logistics_amount_kop: 0, has_missing_price: false }),
    [shipKey],
  )
  const { data: rec } = useApi(
    (s) => receiptIds.length
      ? getReceiptContents(receiptIds, s)
      : Promise.resolve({ products: [], total_qty: 0, sku_count: 0, logistics_amount_kop: 0 }),
    [recKey],
  )
  if (shipmentIds.length === 0 && receiptIds.length === 0) return null

  const goods = ship?.suggested_amount_kop ?? 0
  const logistics = (ship?.logistics_amount_kop ?? 0) + (rec?.logistics_amount_kop ?? 0)
  return (
    <CostBreakdown
      goods={goods} logistics={logistics}
      hasMissingPrice={ship?.has_missing_price ?? false}
      onApplyAmount={onApplyAmount}
    />
  )
}

/** Разбивка стоимости Товары / Логистика / Итого + опц. кнопка «В сумму счёта». */
export function CostBreakdown({ goods, logistics, hasMissingPrice, onApplyAmount }: {
  goods: number
  logistics: number
  hasMissingPrice?: boolean
  onApplyAmount?: (kopecks: number) => void
}) {
  const total = goods + logistics
  return (
    <div style={{ padding: '8px 10px', marginBottom: 8, borderRadius: 8, background: 'var(--c-bg-sunken)' }}>
      {goods > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
          <span style={{ color: 'var(--c-text-subtle)' }}>
            Товары по тарифам
            {hasMissingPrice && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginLeft: 6, color: 'var(--c-warning)' }}>
                <Icon name="alert" size={11} />часть без тарифа
              </span>
            )}
          </span>
          <span className="mono" style={{ color: 'var(--c-text-muted)' }}>{formatMoneyKopecks(goods)}</span>
        </div>
      )}
      {logistics > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
          <span style={{ color: 'var(--c-text-subtle)' }}>Логистика</span>
          <span className="mono" style={{ color: 'var(--c-text-muted)' }}>{formatMoneyKopecks(logistics)}</span>
        </div>
      )}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        paddingTop: goods > 0 || logistics > 0 ? 6 : 0,
        borderTop: goods > 0 || logistics > 0 ? '1px solid var(--c-border)' : 'none',
      }}>
        <span style={{ fontSize: 12, color: 'var(--c-text-subtle)' }}>Итого:</span>
        <span className="mono" style={{ fontSize: 14, fontWeight: 700, color: 'var(--c-accent)' }}>
          {formatMoneyKopecks(total)}
        </span>
        {onApplyAmount && total > 0 && (
          <button type="button" className="btn ghost sm" style={{ marginLeft: 'auto' }}
            onClick={() => onApplyAmount(total)}>
            <Icon name="arrowDown" size={12} />В сумму счёта
          </button>
        )}
      </div>
    </div>
  )
}

/** «Сводка счёта» — единый правый-колоночный блок для создания и карточки счёта
 *  на любом статусе: реквизиты + живой расчёт Товары/Логистика/Итого по текущему
 *  набору отгрузок и поступлений (товары пересчитываются при смене состава). */
export function InvoiceSummaryPanel({
  clientName, shipmentCount, receiptCount, totalQty, dueDateText, amountKop,
  shipmentIds, receiptIds, onApplyAmount, footer,
}: {
  clientName: string | null
  shipmentCount: number
  receiptCount: number
  totalQty: number
  dueDateText: string
  amountKop: number
  shipmentIds: string[]
  receiptIds: string[]
  onApplyAmount?: (kopecks: number) => void
  footer?: ReactNode
}) {
  return (
    <Panel icon="wallet" title="Сводка счёта">
      <div style={{ padding: '0 2px' }}>
        <ReadRow label="Клиент" strong>{clientName ?? '—'}</ReadRow>
        <ReadRow label="Отгрузок" mono strong>{shipmentCount}</ReadRow>
        <ReadRow label="Поступлений" mono strong>{receiptCount}</ReadRow>
        <ReadRow label="Всего мест" mono>{totalQty.toLocaleString('ru-RU')} шт</ReadRow>
        <ReadRow label="Срок расчёта" mono>{dueDateText}</ReadRow>
        <ReadRow label="Сумма счёта" mono strong>{formatMoneyKopecks(amountKop)}</ReadRow>
      </div>
      {(shipmentIds.length > 0 || receiptIds.length > 0) && (
        <div style={{ marginTop: 8 }}>
          <InvoiceTotalsRollup shipmentIds={shipmentIds} receiptIds={receiptIds} onApplyAmount={onApplyAmount} />
        </div>
      )}
      {footer}
    </Panel>
  )
}

function ProductChips({ products }: { products: { product_id: string; name: string; qty: number }[] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {products.map((p) => (
        <span key={p.product_id} style={{
          fontSize: 12, background: 'var(--c-bg-sunken)', padding: '3px 9px', borderRadius: 99,
          color: 'var(--c-text-muted)',
        }}>
          {p.name} · <span className="mono" style={{ fontWeight: 500, color: 'var(--c-text)' }}>{p.qty.toLocaleString('ru-RU')}</span>
        </span>
      ))}
    </div>
  )
}

/** Иконка файла по расширению (Excel — зелёная, PDF — красная). */
export function FileTypeIcon({ filename }: { filename: string }) {
  const lower = filename.toLowerCase()
  const isXls = lower.endsWith('.xlsx') || lower.endsWith('.xls')
  const isPdf = lower.endsWith('.pdf')
  const isImg = /\.(png|jpe?g|gif|webp)$/.test(lower)
  const name: IconName = isXls ? 'fileXls' : isPdf ? 'filePdf' : isImg ? 'fileImg' : 'file'
  const color = isXls ? 'var(--c-success)' : isPdf ? 'var(--c-danger)' : 'var(--c-accent)'
  return <Icon name={name} size={15} style={{ color }} />
}
