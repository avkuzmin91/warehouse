import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  getShipment,
  advanceShipment,
  revertShipment,
  cancelShipment,
  deleteShipment,
  SHIPMENT_STATUS_LABELS,
  SHIPMENT_STATUS_TONES,
  SHIPMENT_CARGO_LABELS,
} from '../../api/shipmentsApi'
import type { ShipmentDetail, ShipmentStatus, ShipmentCargoType, ShipmentOp } from '../../api/shipmentsApi'
import { ShipmentStepper } from '../features/inventory/ShipmentStepper'
import { Badge } from '../primitives/Badge'
import { Icon } from '../primitives/Icon'
import { Avatar, getInitials } from '../primitives/Avatar'
import { SkeletonRows } from '../primitives/Skeleton'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(s: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

function fmtDateTime(s: string) {
  return new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

// ─── Op metadata ─────────────────────────────────────────────────────────────

const OP_LABELS: Record<string, string> = {
  doc_create: 'Документ создан',
  doc_update: 'Документ изменён',
  advance:    'Переход на следующий этап',
  revert:     'Возврат на предыдущий этап',
  cancel:     'Отменено',
}

const OP_ICONS: Record<string, string> = {
  doc_create: 'plus',
  doc_update: 'edit',
  advance:    'arrowRight',
  revert:     'arrowLeft',
  cancel:     'x',
}

const OP_TONES: Record<string, string> = {
  doc_create: 'accent',
  doc_update: '',
  advance:    'success',
  revert:     'warning',
  cancel:     'danger',
}

// ─── Main page ───────────────────────────────────────────────────────────────

export function InventoryShipmentDetailPage() {
  const { docId } = useParams<{ docId: string }>()
  const navigate = useNavigate()

  const [doc, setDoc] = useState<ShipmentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [acting, setActing] = useState(false)

  const load = useCallback(async () => {
    if (!docId) return
    setLoading(true)
    try { setDoc(await getShipment(docId)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Ошибка загрузки') }
    finally { setLoading(false) }
  }, [docId])

  useEffect(() => { load() }, [load])

  async function act(fn: () => Promise<unknown>, redirectAfter?: string) {
    setActing(true); setError('')
    try {
      await fn()
      if (redirectAfter) navigate(redirectAfter)
      else await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally { setActing(false) }
  }

  const status = doc?.status as ShipmentStatus | undefined

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
      {/* ── Header ── */}
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

        {/* Кнопки — справа в колонку (как в поступлениях) */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {/* Отменить — всегда видна пока не финал */}
            {status !== 'shipped' && status !== 'cancelled' && (
              <button className="btn ghost danger" disabled={acting} onClick={() => act(() => cancelShipment(docId!))}>
                <Icon name="x" size={14} />Отменить
              </button>
            )}
            {/* Удалить — только черновик или отменённый */}
            {(status === 'draft' || status === 'cancelled') && (
              <button className="btn ghost" disabled={acting} onClick={() => act(() => deleteShipment(docId!), '/inventory/shipments')}>
                <Icon name="trash" size={14} />Удалить
              </button>
            )}
            {/* Вернуть в сборку — только на этапе отправления */}
            {status === 'ready' && (
              <button className="btn ghost" disabled={acting} onClick={() => act(() => revertShipment(docId!))}>
                <Icon name="arrowLeft" size={14} />Вернуть в сборку
              </button>
            )}
            {/* Главная кнопка продвижения */}
            {status === 'draft' && (
              <button className="btn primary" disabled={acting || doc.lines.length === 0} onClick={() => act(() => advanceShipment(docId!))}>
                <Icon name="arrowRight" size={14} />Начать сборку
              </button>
            )}
            {status === 'packing' && (
              <button className="btn primary" disabled={acting || doc.lines.length === 0} onClick={() => act(() => advanceShipment(docId!))}>
                <Icon name="check" size={14} />Завершить сборку
              </button>
            )}
            {status === 'ready' && (
              <button className="btn primary" disabled={acting} onClick={() => act(() => advanceShipment(docId!))}>
                <Icon name="arrowRight" size={14} />Отправить
              </button>
            )}
            {status === 'shipped' && (
              <button className="btn" disabled={acting}>
                <Icon name="plus" size={14} />Создать корректировку
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Stepper ── */}
      <ShipmentStepper status={status!} ops={doc.ops} style={{ marginTop: -10 }} />

      {error && (
        <div style={{
          padding: '10px 14px', marginBottom: 16,
          background: 'color-mix(in oklab, var(--c-danger) 10%, transparent)',
          border: '1px solid color-mix(in oklab, var(--c-danger) 30%, transparent)',
          borderRadius: 'var(--r-md)', color: 'var(--c-danger)', fontSize: 13,
        }}>{error}</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 20, alignItems: 'start' }}>

        {/* ── Left column ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Состав отгрузки */}
          <div className="card">
            <div className="card-head">
              <Icon name="boxes" size={15} style={{ color: 'var(--c-accent)' }} />
              <div className="card-head-title">Состав отгрузки</div>
              {doc.lines.length > 0 && (
                <span className="badge accent" style={{ marginLeft: 6 }}>{doc.lines.length}</span>
              )}
            </div>
            {doc.lines.length === 0 ? (
              <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 13 }}>
                Нет позиций
              </div>
            ) : (
              <table className="t">
                <thead>
                  <tr>
                    <th style={{ width: 30 }}>#</th>
                    <th>Товар · вариант</th>
                    <th style={{ textAlign: 'right', width: 90 }}>Кол-во</th>
                  </tr>
                </thead>
                <tbody>
                  {doc.lines.map((l, i) => (
                    <tr key={l.id}>
                      <td><span className="mono" style={{ color: 'var(--c-text-faint)', fontSize: 11 }}>{i + 1}</span></td>
                      <td>
                        <div style={{ fontWeight: 450 }}>{l.product_name}</div>
                        <div className="t-sub mono">{[l.product_sku, l.color_name, l.size_name].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td className="num" style={{ fontWeight: 500 }}>{l.qty}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: 'var(--c-bg-sunken)' }}>
                    <td colSpan={2} style={{ padding: '10px 12px', fontWeight: 500, fontSize: 12.5 }}>
                      Итого: {doc.lines.length} SKU
                    </td>
                    <td className="num" style={{ padding: '10px 12px', fontWeight: 600, fontSize: 14 }}>{doc.total_qty}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>

          {/* Основная информация */}
          <div className="card">
            <div className="card-head">
              <Icon name="file" size={15} style={{ color: 'var(--c-accent)' }} />
              <div className="card-head-title">Основная информация</div>
            </div>
            <div style={{ padding: '12px 16px', display: 'grid', gridTemplateColumns: 'auto 1fr', rowGap: 10, columnGap: 16, fontSize: 13 }}>
              <span style={{ color: 'var(--c-text-muted)' }}>Тип</span>
              <span><CargoTypeBadge type={doc.cargo_type as ShipmentCargoType} /></span>
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
        </div>

        {/* ── Right column ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Итого */}
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
              <span style={{ color: 'var(--c-text-muted)' }}>Тип</span>
              <span style={{ textAlign: 'right' }}><CargoTypeBadge type={doc.cargo_type as ShipmentCargoType} /></span>
            </div>
          </div>

          {/* Журнал операций — sticky, как в поступлениях */}
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
                  {/* Вертикальная линия таймлайна */}
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
              <span>Операции не редактируются. Удаление запрещено.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── OpEntry — по образцу поступлений v2 ─────────────────────────────────────

function OpEntry({ op }: { op: ShipmentOp }) {
  const tone = OP_TONES[op.op_type] ?? ''
  const iconName = OP_ICONS[op.op_type] ?? 'layers'
  const label = OP_LABELS[op.op_type] ?? op.op_type

  const bgMap: Record<string, string> = {
    accent:  'var(--c-accent-bg)',
    success: 'var(--c-success-bg)',
    warning: 'color-mix(in oklab, var(--c-warning) 18%, var(--c-bg))',
    info:    'color-mix(in oklab, var(--c-info, #3b82f6) 15%, var(--c-bg))',
    danger:  'color-mix(in oklab, var(--c-danger) 12%, var(--c-bg))',
    '':      'var(--c-bg-sunken)',
  }
  const borderMap: Record<string, string> = {
    accent:  'var(--c-accent-border)',
    success: 'color-mix(in oklab, var(--c-success) 35%, transparent)',
    warning: 'color-mix(in oklab, var(--c-warning) 40%, transparent)',
    info:    'color-mix(in oklab, var(--c-info, #3b82f6) 35%, transparent)',
    danger:  'color-mix(in oklab, var(--c-danger) 35%, transparent)',
    '':      'var(--c-border)',
  }
  const colorMap: Record<string, string> = {
    accent:  'var(--c-accent)',
    success: 'var(--c-success)',
    warning: 'var(--c-warning)',
    info:    'var(--c-info, #3b82f6)',
    danger:  'var(--c-danger)',
    '':      'var(--c-text-muted)',
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

// ─── CargoTypeBadge ───────────────────────────────────────────────────────────

function CargoTypeBadge({ type }: { type: ShipmentCargoType }) {
  const isDefect = type === 'defect'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '2px 8px', borderRadius: 99, fontSize: 12, fontWeight: 500,
      background: isDefect ? 'var(--c-warning-bg)' : 'var(--c-success-bg, #f0faf4)',
      color: isDefect ? 'var(--c-warning)' : 'var(--c-success)',
      border: `1px solid ${isDefect ? '#ead1a3' : '#b6e5c8'}`,
    }}>
      {isDefect ? '!' : '✓'} {SHIPMENT_CARGO_LABELS[type]}
    </span>
  )
}

// Нужен для Badge в JSX ниже
import type React from 'react'
