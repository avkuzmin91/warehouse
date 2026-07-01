import { Icon } from '../../components/Icon'
import { fmtDateTime } from '../../utils/format'
import type { DuplicateMatch } from '../../api/dispatchApi'

function variantLabel(sku: string | null, color: string | null, size: string | null): string {
  return [sku, color, size].filter(Boolean).join(' · ') || '—'
}

/** Мобильный лист «Похоже на дубль» — зеркало web DuplicateWarnModal. Показывается перед
 *  созданием отгрузки, если сегодня для клиента уже есть документ с таким же составом. */
export function DuplicateWarnSheet({
  matches,
  busy = false,
  onOpenExisting,
  onProceed,
  onCancel,
}: {
  matches: DuplicateMatch[]
  busy?: boolean
  onOpenExisting: (id: string) => void
  onProceed: () => void
  onCancel: () => void
}) {
  return (
    <div className="sheet-backdrop" onClick={onCancel}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <h3>Похоже на дубль</h3>
        <div className="line-sub" style={{ marginBottom: 14 }}>
          Сегодня для этого клиента уже создан{matches.length > 1 ? 'ы документы' : ' документ'} с таким же составом товаров. Проверьте, не создаёте ли то же повторно.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: '46vh', overflowY: 'auto' }}>
          {matches.map((m) => (
            <div key={m.id} style={{ border: '1px solid var(--c-border)', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', background: 'var(--c-bg-sunken)' }}>
                <span className="mono" style={{ fontWeight: 700, fontSize: 13 }}>{m.doc_number}</span>
                <span className="badge">{m.status_label}</span>
                <span className="badge warning" style={{ marginLeft: 'auto' }}>100%</span>
              </div>

              <div style={{ padding: '4px 12px' }}>
                {m.lines.map((l, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex', justifyContent: 'space-between', gap: 12, padding: '5px 0',
                      fontSize: 12.5, borderBottom: i < m.lines.length - 1 ? '1px solid var(--c-border)' : 'none',
                    }}
                  >
                    <span className="mono" style={{ color: 'var(--c-text-subtle)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {variantLabel(l.product_sku, l.color_name, l.size_name)}
                    </span>
                    <span className="num" style={{ whiteSpace: 'nowrap' }}>{l.qty} шт</span>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--c-bg-sunken)' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--c-text-muted)' }}>
                  <Icon name="clock" size={12} />
                  {fmtDateTime(m.created_at)}{m.created_by_name ? ` · ${m.created_by_name}` : ''}
                </span>
                <button className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => onOpenExisting(m.id)} disabled={busy}>
                  Открыть
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="line-row" style={{ marginTop: 14 }}>
          <button className="btn ghost" style={{ flex: 1 }} onClick={onCancel} disabled={busy}>Отмена</button>
          <button
            className="btn"
            style={{ flex: 2, background: 'var(--c-warning)', borderColor: 'var(--c-warning)', color: '#fff' }}
            onClick={onProceed}
            disabled={busy}
          >
            Всё равно создать
          </button>
        </div>
      </div>
    </div>
  )
}
