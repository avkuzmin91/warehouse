import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../../../../primitives/Icon'
import type { IconName } from '../../../../primitives/Icon'
import { fileTypeIcon, fileTypeColor, shortName } from './fileHelpers'

type FileGlyph = { name: IconName; color: string }

/** Файл в ячейке: загруженный (id + href) или локальный черновик (id = индекс, без href). */
export type LineFileEntry = {
  id: string
  filename: string
  mimeType: string | null
  href?: string
  /** Подпись под файлом — например, распознанный на нём ШК. */
  caption?: string
}

export function LineFilesCell({
  entries, canEdit, uploading, onPreview, onAdd, onReplace, onRemove, onPickFromCard,
  accept = '.pdf,.png,.jpg,.jpeg',
  glyphFor = (mime, filename) => ({ name: fileTypeIcon(mime, filename), color: fileTypeColor(mime, filename) }),
}: {
  entries: LineFileEntry[]
  canEdit: boolean
  uploading?: boolean
  onPreview: (entry: LineFileEntry) => void
  onAdd: (files: File[]) => void
  onReplace: (entryId: string, file: File) => void
  onRemove: (entryId: string) => void
  /** Выбор этикетки из карточки товара — кнопка появляется, только если проп передан. */
  onPickFromCard?: () => void
  /** Список расширений для input[type=file]. По умолчанию — набор упаковки (pdf/png/jpg). */
  accept?: string
  /** Иконка+цвет глифа по файлу — для доменов с другим набором типов (напр. zip в отгрузке). */
  glyphFor?: (mime: string | null, filename: string) => FileGlyph
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const replaceTargetRef = useRef<string | null>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [popStyle, setPopStyle] = useState<React.CSSProperties>({})

  function pickFile(replaceId: string | null) {
    replaceTargetRef.current = replaceId
    inputRef.current?.click()
  }

  function handleInputChange(e: { target: HTMLInputElement }) {
    const selected = Array.from(e.target.files ?? [])
    if (selected.length > 0) {
      if (replaceTargetRef.current != null) onReplace(replaceTargetRef.current, selected[0])
      else onAdd(selected)
    }
    replaceTargetRef.current = null
    e.target.value = ''
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    if (!canEdit) return
    const dropped = Array.from(e.dataTransfer.files ?? [])
    if (dropped.length > 0) onAdd(dropped)
  }

  const updatePopPosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const gap = 4
    const width = 240
    const left = Math.min(rect.left, window.innerWidth - width - 8)
    setPopStyle({ position: 'fixed', top: rect.bottom + gap, left, width })
  }, [])

  useEffect(() => {
    if (!popoverOpen) return
    updatePopPosition()
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (triggerRef.current?.contains(t) || popoverRef.current?.contains(t)) return
      setPopoverOpen(false)
    }
    window.addEventListener('resize', updatePopPosition)
    window.addEventListener('scroll', updatePopPosition, true)
    document.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('resize', updatePopPosition)
      window.removeEventListener('scroll', updatePopPosition, true)
      document.removeEventListener('mousedown', onDown)
    }
  }, [popoverOpen, updatePopPosition])

  const hiddenInput = (
    <input
      ref={inputRef}
      type="file"
      accept={accept}
      multiple
      style={{ display: 'none' }}
      onChange={handleInputChange}
    />
  )

  // Пусто + только просмотр → прочерк
  if (entries.length === 0 && !canEdit) {
    return <span style={{ fontSize: 12, color: 'var(--c-text-faint)' }}>—</span>
  }

  // Пусто + можно прикрепить → приглушённая ghost-кнопка (не «кричит» на пустых строках)
  if (entries.length === 0) {
    return (
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        style={{ display: 'inline-flex', gap: 4 }}
      >
        {hiddenInput}
        <button
          type="button"
          title="Прикрепить файл (PDF, PNG, JPG)"
          disabled={uploading}
          onClick={() => pickFile(null)}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            height: 28, width: 28, borderRadius: 'var(--r-md)',
            border: `1px solid ${dragOver ? 'var(--c-accent)' : 'var(--c-border)'}`,
            background: dragOver ? 'var(--c-bg-hover)' : 'var(--c-bg-elev)',
            color: 'var(--c-accent)',
            cursor: uploading ? 'default' : 'pointer', transition: 'all 120ms ease',
          }}
        >
          <Icon name={uploading ? 'refresh' : 'importFile'} size={15} />
        </button>
        {onPickFromCard && (
          <button
            type="button"
            title="Этикетка из карточки товара"
            disabled={uploading}
            onClick={onPickFromCard}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              height: 28, width: 28, borderRadius: 'var(--r-md)',
              border: '1px solid var(--c-border)', background: 'var(--c-bg-elev)',
              color: 'var(--c-text-subtle)',
              cursor: uploading ? 'default' : 'pointer', transition: 'all 120ms ease',
            }}
          >
            <Icon name="box" size={14} />
          </button>
        )}
      </div>
    )
  }

  const single = entries[0]
  const many = entries.length > 1

  function entryGlyph(entry: LineFileEntry, size: number) {
    const g = glyphFor(entry.mimeType, entry.filename)
    return <Icon name={g.name} size={size} style={{ color: g.color, flexShrink: 0 }} />
  }

  function previewLink(entry: LineFileEntry, onPicked: () => void, children: React.ReactNode, style: React.CSSProperties) {
    if (entry.href) {
      return (
        <a
          href={entry.href}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onPicked()
          }}
          style={{ ...style, textDecoration: 'none', color: 'var(--c-text)' }}
        >
          {children}
        </a>
      )
    }
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onPicked() }}
        style={{ ...style, border: 0, background: 'transparent', padding: 0, cursor: 'pointer', textAlign: 'left', color: 'var(--c-text)' }}
      >
        {children}
      </button>
    )
  }

  return (
    <div
      onDragOver={(e) => { if (canEdit) { e.preventDefault(); setDragOver(true) } }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}
    >
      {hiddenInput}
      <div
        ref={triggerRef}
        onClick={() => { if (many) setPopoverOpen((o) => !o) }}
        title={many ? `${entries.length} файла` : single.filename}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          height: 28, maxWidth: 180, padding: '0 4px 0 8px',
          borderRadius: 'var(--r-md)',
          border: `1px solid ${dragOver ? 'var(--c-accent)' : 'var(--c-border)'}`,
          background: dragOver ? 'var(--c-bg-hover)' : 'var(--c-bg-elev)',
          cursor: many ? 'pointer' : 'default', transition: 'border-color 120ms ease',
        }}
      >
        {many ? (
          <>
            <Icon name="filePdf" size={14} style={{ color: 'var(--c-danger)', flexShrink: 0 }} />
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--c-text)' }}>
              {entries.length} файла
            </span>
            <Icon name="chevDown" size={12} style={{ color: 'var(--c-text-subtle)', flexShrink: 0 }} />
          </>
        ) : (
          <>
            {previewLink(
              single,
              () => onPreview(single),
              <>
                {entryGlyph(single, 14)}
                <span style={{
                  fontSize: 12, fontWeight: 500,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {shortName(single.filename)}
                </span>
              </>,
              { display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 },
            )}
            {canEdit && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 1, flexShrink: 0,
                opacity: hover ? 1 : 0, transition: 'opacity 120ms ease',
                pointerEvents: hover ? 'auto' : 'none',
              }}>
                <button
                  type="button"
                  title="Прикрепить ещё файл"
                  disabled={uploading}
                  onClick={(e) => { e.stopPropagation(); pickFile(null) }}
                  className="btn ghost icon sm"
                  style={{ width: 22, height: 22, color: 'var(--c-accent)' }}
                >
                  <Icon name="importFile" size={12} />
                </button>
                {onPickFromCard && (
                  <button
                    type="button"
                    title="Этикетка из карточки товара"
                    disabled={uploading}
                    onClick={(e) => { e.stopPropagation(); onPickFromCard() }}
                    className="btn ghost icon sm"
                    style={{ width: 22, height: 22, color: 'var(--c-text-subtle)' }}
                  >
                    <Icon name="box" size={12} />
                  </button>
                )}
                <button
                  type="button"
                  title="Заменить файл"
                  disabled={uploading}
                  onClick={(e) => { e.stopPropagation(); pickFile(single.id) }}
                  className="btn ghost icon sm"
                  style={{ width: 22, height: 22, color: 'var(--c-text-subtle)' }}
                >
                  <Icon name="refresh" size={12} />
                </button>
                <button
                  type="button"
                  title="Удалить файл"
                  onClick={(e) => { e.stopPropagation(); onRemove(single.id) }}
                  className="btn ghost icon sm"
                  style={{ width: 22, height: 22, color: 'var(--c-text-faint)' }}
                >
                  <Icon name="x" size={12} />
                </button>
              </span>
            )}
          </>
        )}
      </div>

      {!many && single.caption && (
        <span
          className="mono"
          title={single.caption}
          style={{
            fontSize: 10.5, lineHeight: '12px', color: 'var(--c-text-subtle)',
            maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {single.caption}
        </span>
      )}

      {popoverOpen && many && createPortal(
        <div
          ref={popoverRef}
          style={{
            ...popStyle,
            background: 'var(--c-bg-elev)',
            border: '1px solid var(--c-border)',
            borderRadius: 'var(--r-lg)',
            boxShadow: 'var(--sh-2)',
            zIndex: 9999, padding: 4,
          }}
        >
          {entries.map((entry) => (
            <div
              key={entry.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 8px', borderRadius: 'var(--r-md)',
              }}
            >
              {previewLink(
                entry,
                () => { setPopoverOpen(false); onPreview(entry) },
                <>
                  {entryGlyph(entry, 15)}
                  <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <span style={{
                      fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {entry.filename}
                    </span>
                    {entry.caption && (
                      <span className="mono" style={{
                        fontSize: 10.5, color: 'var(--c-text-subtle)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {entry.caption}
                      </span>
                    )}
                  </span>
                </>,
                { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 },
              )}
              {canEdit && (
                <button
                  type="button"
                  title="Удалить файл"
                  onClick={() => { onRemove(entry.id); if (entries.length <= 1) setPopoverOpen(false) }}
                  className="btn ghost icon sm"
                  style={{ width: 22, height: 22, color: 'var(--c-text-faint)', flexShrink: 0 }}
                >
                  <Icon name="x" size={12} />
                </button>
              )}
            </div>
          ))}
          {canEdit && (
            <>
              <div style={{ height: 1, background: 'var(--c-border)', margin: '4px 0' }} />
              <button
                type="button"
                disabled={uploading}
                onClick={() => { setPopoverOpen(false); pickFile(null) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  padding: '6px 8px', borderRadius: 'var(--r-md)',
                  border: 0, background: 'transparent', cursor: 'pointer',
                  fontSize: 12.5, color: 'var(--c-accent)',
                }}
              >
                <Icon name="importFile" size={15} />Прикрепить файл
              </button>
              {onPickFromCard && (
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => { setPopoverOpen(false); onPickFromCard() }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                    padding: '6px 8px', borderRadius: 'var(--r-md)',
                    border: 0, background: 'transparent', cursor: 'pointer',
                    fontSize: 12.5, color: 'var(--c-text-muted)',
                  }}
                >
                  <Icon name="box" size={15} />Из карточки товара
                </button>
              )}
            </>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}
