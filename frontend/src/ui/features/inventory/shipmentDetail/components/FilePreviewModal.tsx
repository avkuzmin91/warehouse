import { Icon } from '../../../../primitives/Icon'
import { Modal } from '../../../../feedback/Modal'
import { isPdf, isImageFile, fileTypeIcon, fileTypeColor, printFile, fitWidthPreviewUrl } from './fileHelpers'
import type { FilePreviewMeta } from '../shared/types'

/** Предпросмотр файла строки отгрузки (ШК): и загруженные файлы (detail), и локальные черновики (create). */
export function FilePreviewModal({ filename, mimeType, url, meta, onClose }: {
  filename: string | null
  mimeType: string | null
  url: string
  meta: FilePreviewMeta | null
  onClose: () => void
}) {
  const open = !!(meta && filename)
  const isPdfFile = filename ? isPdf(mimeType, filename) : false
  const isImage = filename ? isImageFile(mimeType, filename) : false
  const previewUrl = isPdfFile ? fitWidthPreviewUrl(url) : url

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={filename ?? 'Файл'}
      subtitle={meta ? `${meta.productName} · ${meta.sku}` : undefined}
      width={1040}
      footer={(
        <>
          <a
            className="btn ghost"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon name="eye" size={14} />Открыть отдельно
          </a>
          <button className="btn primary" disabled={!filename} onClick={() => printFile(url)}>
            <Icon name="print" size={14} />Печать
          </button>
        </>
      )}
    >
      {open && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 240px', gap: 16, minHeight: 520 }}>
          <div
            style={{
              minHeight: 520,
              border: '1px solid var(--c-border)',
              borderRadius: 'var(--r-lg)',
              background: 'var(--c-bg-sunken)',
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {isPdfFile ? (
              <iframe
                title={filename!}
                src={previewUrl}
                style={{ width: '100%', height: 520, border: 0, background: 'var(--c-bg-elev)' }}
              />
            ) : isImage ? (
              <img
                src={url}
                alt={filename!}
                style={{
                  display: 'block',
                  width: '100%',
                  height: 520,
                  objectFit: 'contain',
                }}
              />
            ) : (
              <div style={{ color: 'var(--c-text-subtle)', fontSize: 13 }}>Предпросмотр недоступен</div>
            )}
          </div>

          <div
            style={{
              border: '1px solid var(--c-border)',
              borderRadius: 'var(--r-lg)',
              background: 'var(--c-bg-elev)',
              padding: 14,
              alignSelf: 'start',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 'var(--r-md)',
                  background: isPdfFile ? 'var(--c-danger-bg)' : 'var(--c-accent-bg)',
                  color: fileTypeColor(mimeType, filename!),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Icon name={fileTypeIcon(mimeType, filename!)} size={17} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  ШК к отгрузке
                </div>
                <div className="text-xs subtle">{isPdfFile ? 'PDF' : 'Изображение'}</div>
              </div>
            </div>

            <div style={{ display: 'grid', gap: 10 }}>
              <PreviewMeta label="Товар" value={meta!.productName} />
              <PreviewMeta label="SKU" value={meta!.sku} mono />
              <PreviewMeta label="Цвет" value={meta!.colorName || '—'} />
              <PreviewMeta label="Размер" value={meta!.sizeName || '—'} />
              <div
                style={{
                  marginTop: 4,
                  padding: '12px 14px',
                  borderRadius: 'var(--r-lg)',
                  background: 'var(--c-accent-bg)',
                  border: '1px solid var(--c-accent-border)',
                }}
              >
                <div style={{ fontSize: 11.5, color: 'var(--c-accent-text)', marginBottom: 3 }}>План к печати</div>
                <div className="mono" style={{ fontSize: 24, fontWeight: 700, color: 'var(--c-accent-text)' }}>
                  {meta!.qty.toLocaleString('ru-RU')} шт
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

function PreviewMeta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', marginBottom: 2 }}>{label}</div>
      <div
        className={mono ? 'mono' : undefined}
        style={{
          fontSize: 13,
          fontWeight: 500,
          overflowWrap: 'anywhere',
        }}
      >
        {value}
      </div>
    </div>
  )
}
