import { useRef } from 'react'
import { Icon } from '../../../../primitives/Icon'
import type { IconName } from '../../../../primitives/Icon'

const ACCEPT = '.zip,.pdf,.jpg,.jpeg'
const ALLOWED_EXTS = ['zip', 'pdf', 'jpg', 'jpeg']
const MAX_FILE_BYTES = 10 * 1024 * 1024

/** Набор типов для input[type=file] в отгрузке (zip/pdf/jpeg). */
export const DISPATCH_FILE_ACCEPT = ACCEPT

/** Файл в ячейке: загруженный (с href на /uploads) или локальный черновик создания (без href). */
export type DispatchFileEntry = {
  id:       string
  filename: string
  mimeType: string | null
  href?:    string
}

/** null — файл валиден; иначе текст ошибки. */
export function validateDispatchFile(file: File): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (!ALLOWED_EXTS.includes(ext)) return 'Допустимы файлы: zip, pdf, jpeg'
  if (file.size > MAX_FILE_BYTES) return 'Файл слишком большой (максимум 10 МБ)'
  return null
}

function fileGlyph(filename: string, mime: string | null): { name: IconName; color: string } {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'pdf' || mime === 'application/pdf') return { name: 'filePdf', color: 'var(--c-danger)' }
  if (ext === 'zip' || mime === 'application/zip') return { name: 'archive', color: 'var(--c-warning)' }
  return { name: 'fileImg', color: 'var(--c-accent)' }
}

/** Глиф файла отгрузки в сигнатуре `LineFilesCell.glyphFor` (mime, filename). */
export function dispatchFileGlyph(mime: string | null, filename: string): { name: IconName; color: string } {
  return fileGlyph(filename, mime)
}

function shortName(name: string, max = 22): string {
  if (name.length <= max) return name
  const ext = name.includes('.') ? '.' + name.split('.').pop() : ''
  return `${name.slice(0, max - ext.length - 1)}…${ext}`
}

type Props = {
  entries:    DispatchFileEntry[]
  canEdit:    boolean
  uploading?: boolean
  onAdd?:     (files: File[]) => void
  onRemove?:  (entryId: string) => void
}

/** Вложения по строке отгрузки (zip/pdf/jpeg). Менеджер прикрепляет/удаляет в черновике,
 *  кладовщик видит как ссылки-скачивания при подготовке. */
export function DispatchLineFiles({ entries, canEdit, uploading, onAdd, onRemove }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? [])
    if (selected.length > 0) onAdd?.(selected)
    e.target.value = ''
  }

  if (entries.length === 0 && !canEdit) {
    return <span style={{ fontSize: 12, color: 'var(--c-text-faint)' }}>—</span>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
      {canEdit && (
        <input ref={inputRef} type="file" accept={ACCEPT} multiple style={{ display: 'none' }} onChange={handleInputChange} />
      )}
      {entries.map((f) => {
        const g = fileGlyph(f.filename, f.mimeType)
        const inner = (
          <>
            <Icon name={g.name} size={14} style={{ color: g.color, flexShrink: 0 }} />
            <span style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {shortName(f.filename)}
            </span>
          </>
        )
        return (
          <div
            key={f.id}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: 200,
              height: 26, padding: '0 4px 0 8px', borderRadius: 'var(--r-md)',
              border: '1px solid var(--c-border)', background: 'var(--c-bg-elev)',
            }}
          >
            {f.href ? (
              <a
                href={f.href}
                target="_blank"
                rel="noreferrer"
                title={f.filename}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, textDecoration: 'none', color: 'var(--c-text)' }}
              >
                {inner}
              </a>
            ) : (
              <span
                title={f.filename}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, color: 'var(--c-text)' }}
              >
                {inner}
              </span>
            )}
            {canEdit && (
              <button
                type="button"
                title="Удалить файл"
                className="btn ghost icon sm"
                style={{ width: 22, height: 22, color: 'var(--c-text-faint)', flexShrink: 0 }}
                onClick={() => onRemove?.(f.id)}
              >
                <Icon name="x" size={12} />
              </button>
            )}
          </div>
        )
      })}
      {canEdit && (
        <button
          type="button"
          className="btn ghost sm"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          style={{ color: 'var(--c-accent)' }}
        >
          <Icon name={uploading ? 'refresh' : 'importFile'} size={12} style={uploading ? { animation: 'spin 0.7s linear infinite' } : undefined} />
          Прикрепить файл
        </button>
      )}
    </div>
  )
}
