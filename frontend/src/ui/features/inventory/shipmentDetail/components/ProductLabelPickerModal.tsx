import { getProductFiles } from '../../../../../api/adminApi'
import type { ProductFileItem } from '../../../../../api/domainTypes'
import { useApi } from '../../../../../hooks/useApi'
import { Modal } from '../../../../feedback/Modal'
import { EmptyState } from '../../../../primitives/EmptyState'
import { Icon } from '../../../../primitives/Icon'
import { Skeleton } from '../../../../primitives/Skeleton'
import { fileTypeColor, fileTypeIcon } from './fileHelpers'

/** Выбор этикетки из карточки товара для прикрепления к строке задачи упаковки.
 * Код принадлежит варианту: показываются этикетки цвето-размера строки
 * (и коды без варианта — легаси до доукомплектования). */
export function ProductLabelPickerModal({ productId, productName, lineColorId, lineSizeId, excludeUrls = [], onPick, onClose }: {
  productId: string
  productName: string
  lineColorId: string | null
  lineSizeId: string | null
  /** URL уже прикреплённых к строке файлов — прячем, чтобы не предлагать дубликат. */
  excludeUrls?: string[]
  onPick: (file: ProductFileItem) => void
  onClose: () => void
}) {
  const { data, loading, error } = useApi((signal) => getProductFiles(productId, signal), [productId])
  const files = (data ?? []).filter((f) =>
    !excludeUrls.includes(f.url) &&
    (f.variant_id === null || ((f.color_id ?? null) === (lineColorId ?? null) && (f.size_id ?? null) === (lineSizeId ?? null))))

  return (
    <Modal open onClose={onClose} title="Этикетка из карточки товара" subtitle={productName} width={440}>
      {loading ? (
        <div className="col gap-8">
          <Skeleton height={36} />
          <Skeleton height={36} />
        </div>
      ) : error ? (
        <EmptyState title="Не удалось загрузить этикетки" sub={error.message} />
      ) : files.length === 0 ? (
        <EmptyState
          title="В карточке товара нет этикеток"
          sub="Этикетка сохраняется в карточку при привязке распознанного ШК или вручную в справочнике товаров"
        />
      ) : (
        <div className="col" style={{ gap: 4 }}>
          {files.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => onPick(f)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                padding: '8px 10px', borderRadius: 'var(--r-md)', textAlign: 'left',
                border: '1px solid var(--c-border)', background: 'var(--c-bg-elev)', cursor: 'pointer',
              }}
            >
              <Icon name={fileTypeIcon(f.mime_type, f.filename)} size={16} style={{ color: fileTypeColor(f.mime_type, f.filename), flexShrink: 0 }} />
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: 'block', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {f.filename}
                </span>
                <span className="mono" style={{ display: 'block', fontSize: 11.5, color: 'var(--c-text-subtle)' }}>
                  {[f.barcode, [f.color_name, f.size_name].filter(Boolean).join(' / ')].filter(Boolean).join(' · ')}
                </span>
              </span>
              <Icon name="plus" size={14} style={{ color: 'var(--c-accent)', flexShrink: 0 }} />
            </button>
          ))}
        </div>
      )}
    </Modal>
  )
}
