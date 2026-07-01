import { Modal } from '../../../feedback/Modal'
import { Icon } from '../../../primitives/Icon'
import { fmtDateTime } from '../../../../utils/format'
import type { DuplicateMatch } from '../../../../api/domainTypes'

interface DuplicateWarnModalProps {
  open: boolean
  matches: DuplicateMatch[]
  /** Винительный падеж: «отгрузку» / «поступление» — для текста кнопки и подзаголовка. */
  entityAccusative: string
  busy?: boolean
  onOpenExisting: (id: string) => void
  onProceed: () => void
  onCancel: () => void
}

function variantLabel(sku: string | null, color: string | null, size: string | null): string {
  return [sku, color, size].filter(Boolean).join(' · ') || '—'
}

export function DuplicateWarnModal({
  open, matches, entityAccusative, busy = false, onOpenExisting, onProceed, onCancel,
}: DuplicateWarnModalProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      width={480}
      title="Похоже на дубль"
      subtitle={`Сегодня для этого клиента уже создан${matches.length > 1 ? 'ы документы' : ' документ'} с таким же составом товаров.`}
      footer={
        <>
          <button className="btn" onClick={onCancel} disabled={busy}>Отмена</button>
          <button
            className="btn"
            onClick={onProceed}
            disabled={busy}
            style={{ background: 'var(--c-warning)', borderColor: 'var(--c-warning)', color: '#fff' }}
          >
            Всё равно создать {entityAccusative}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 14 }}>
        <div style={{
          flex: 'none', width: 34, height: 34, borderRadius: '50%',
          background: 'var(--c-warning-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name="alert" size={17} style={{ color: 'var(--c-warning)' }} />
        </div>
        <div style={{ fontSize: 13, color: 'var(--c-text-subtle)', lineHeight: 1.5 }}>
          Проверьте, не создаёте ли вы то же самое повторно. Если это отдельная поставка — продолжайте.
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {matches.map((m) => (
          <div key={m.id} style={{ border: '1px solid var(--c-border)', borderRadius: 'var(--r-lg, 12px)', overflow: 'hidden' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px',
              background: 'var(--c-bg-sunken)', borderBottom: '1px solid var(--c-border)',
            }}>
              <span className="mono" style={{ fontWeight: 600, fontSize: 13 }}>{m.doc_number}</span>
              <span className="badge" style={{ fontSize: 11 }}>{m.status_label}</span>
              <span style={{
                marginLeft: 'auto', fontSize: 11, padding: '2px 8px', borderRadius: 6,
                background: 'var(--c-warning-bg)', color: 'var(--c-warning)', fontWeight: 500,
              }}>
                Совпадение 100%
              </span>
            </div>

            <div style={{ padding: '4px 12px' }}>
              {m.lines.map((l, i) => (
                <div key={i} style={{
                  display: 'flex', justifyContent: 'space-between', gap: 12, padding: '5px 0',
                  fontSize: 12.5, borderBottom: i < m.lines.length - 1 ? '1px solid var(--c-border)' : 'none',
                }}>
                  <span className="mono" style={{ color: 'var(--c-text-subtle)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {variantLabel(l.product_sku, l.color_name, l.size_name)}
                  </span>
                  <span className="num" style={{ whiteSpace: 'nowrap' }}>{l.qty} шт</span>
                </div>
              ))}
            </div>

            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
              background: 'var(--c-bg-sunken)', borderTop: '1px solid var(--c-border)',
            }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--c-text-muted)' }}>
                <Icon name="clock" size={12} />
                {fmtDateTime(m.created_at)}{m.created_by_name ? ` · ${m.created_by_name}` : ''}
              </span>
              <button className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => onOpenExisting(m.id)} disabled={busy}>
                Открыть {m.doc_number}
              </button>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  )
}
