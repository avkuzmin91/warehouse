import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../../../../primitives/Icon'
import type { IconName } from '../../../../primitives/Icon'
import { Link } from 'react-router-dom'
import { fileTypeIcon, fileTypeColor, shortName } from './fileHelpers'
import type { LineLabelState } from '../../../shared/usePrintBarcodeLabels'

type FileGlyph = { name: IconName; color: string }

/** Файл в ячейке: загруженный (id + href) или локальный черновик (id = индекс, без href). */
export type LineFileEntry = {
  id: string
  filename: string
  mimeType: string | null
  href?: string
  /** Подпись под файлом — например, распознанный на нём ШК. */
  caption?: string
  /** Тон подписи: `danger` — красная (конфликтный ШК на этикетке). */
  captionTone?: 'default' | 'danger'
}

export function LineFilesCell({
  entries, canEdit, uploading, onPreview, onAdd, onReplace, onRemove, onPickFromCard,
  label, labelScanCritical, onPrintLabel, productHref,
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
  /** Чем маркируют строку, если файла в ней нет: код карточки, «нет ШК» или загрузка.
   * Без пропа ячейка ведёт себя по-старому — только файлы (отгрузка, вложения строки). */
  label?: LineLabelState
  /** Задача с ТСД: без кода не сработает скан, поэтому предупреждение жёстче. */
  labelScanCritical?: boolean
  /** Печать этикетки по коду карточки — тираж считает вызывающая сторона. */
  onPrintLabel?: () => void
  /** Куда вести за штрих-кодом, когда его нет: карточка товара. */
  productHref?: string | null
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

  function draggingFiles(e: React.DragEvent) {
    return Array.from(e.dataTransfer.types ?? []).includes('Files')
  }

  function handleDragOver(e: React.DragEvent) {
    if (!canEdit || !draggingFiles(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragOver(true)
  }

  function handleDragLeave(e: React.DragEvent) {
    // Курсор, ушедший на вложенный элемент, тоже даёт dragleave — без этой проверки
    // подсветка мигает, пока файл ведут над ячейкой.
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
    setDragOver(false)
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

  function renderContent() {
  // Пусто + только просмотр → прочерк. Со сведениями об этикетке прочерк не ставим:
  // на закрытой задаче тоже видно, чем маркировали строку.
  if (entries.length === 0 && !canEdit && !label) {
    return <span style={{ fontSize: 12, color: 'var(--c-text-faint)' }}>—</span>
  }

  // Файла нет, но код в карточке есть — строка сразу показывает, что напечатается.
  // Раньше здесь была пустая кнопка «прикрепить», и генерация была не видна вообще.
  if (entries.length === 0 && label && label.kind === 'code') {
    return (
      <div
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}
      >
        {hiddenInput}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
          <button
            type="button"
            onClick={onPickFromCard}
            disabled={!onPickFromCard}
            title={label.chosen
              ? 'Код выбран вручную — сменить'
              : label.count > 1 ? `У варианта ${label.count} кода — выбрать` : 'Этикетка строки'}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              height: 30, maxWidth: 210, padding: '0 9px',
              borderRadius: 'var(--r-md)',
              border: `1px solid ${label.chosen ? 'var(--c-success)' : 'var(--c-accent-border)'}`,
              background: label.chosen ? 'var(--c-success-bg)' : 'var(--c-accent-bg)',
              cursor: onPickFromCard ? 'pointer' : 'default',
            }}
          >
            <Icon
              name={label.chosen ? 'check' : 'barcode'}
              size={14}
              style={{ color: label.chosen ? 'var(--c-success)' : 'var(--c-accent)', flexShrink: 0 }}
            />
            <span className="mono" style={{ fontSize: 11.5, color: 'var(--c-text)' }}>{label.barcode}</span>
            {/* Показываем начало кода в натуральном масштабе, а не весь код,
                сжатый до 44 px: 143 модуля в такой ширине сливаются в серую кашу. */}
            <span style={{ height: 16, width: 46, flexShrink: 0, overflow: 'hidden', display: 'block' }}>
              <span
                style={{ display: 'block', height: '100%', width: label.modules * 1.2 }}
                dangerouslySetInnerHTML={{ __html: label.barcodeSvg }}
              />
            </span>
          </button>
          {canEdit && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 1,
              opacity: hover ? 1 : 0, transition: 'opacity 120ms ease',
              pointerEvents: hover ? 'auto' : 'none',
            }}>
              {onPrintLabel && (
                <button
                  type="button"
                  title="Напечатать этикетки на эту строку"
                  onClick={onPrintLabel}
                  className="btn ghost icon sm"
                  style={{ width: 22, height: 22, color: 'var(--c-accent)' }}
                >
                  <Icon name="print" size={12} />
                </button>
              )}
              <button
                type="button"
                title="Прикрепить файл этикетки — PDF, PNG, JPG. Можно перетащить файл в ячейку"
                disabled={uploading}
                onClick={() => pickFile(null)}
                className="btn ghost icon sm"
                style={{ width: 22, height: 22, color: 'var(--c-text-subtle)' }}
              >
                <Icon name="importFile" size={12} />
              </button>
            </span>
          )}
        </span>
        <span style={{
          fontSize: 10.5, lineHeight: '12px',
          color: label.chosen ? 'var(--c-success)' : 'var(--c-text-subtle)',
          maxWidth: 232, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {label.chosen ? 'Код выбран вручную' : label.count > 1 ? (
            <>
              По умолчанию ·{' '}
              <button
                type="button"
                onClick={onPickFromCard}
                disabled={!onPickFromCard}
                style={{
                  border: 0, background: 'none', padding: 0, font: 'inherit',
                  color: 'var(--c-accent)', textDecoration: 'underline',
                  cursor: onPickFromCard ? 'pointer' : 'default',
                }}
              >
                выбрать из {label.count}
              </button>
            </>
          ) : 'Напечатаем по коду карточки'}
        </span>
      </div>
    )
  }

  // Коды из разных кабинетов: любой напечатать нельзя — чужой ШК площадка не примет.
  // Это не ошибка данных, а незакрытое решение, поэтому тон акцентный, а не тревожный.
  if (entries.length === 0 && label && label.kind === 'choose') {
    return (
      <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
        {hiddenInput}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
          <button
            type="button"
            onClick={onPickFromCard}
            disabled={!onPickFromCard}
            title="Выбрать, каким кодом маркировать строку"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              height: 30, padding: '0 10px', borderRadius: 'var(--r-md)',
              border: '1px dashed var(--c-accent)', background: 'var(--c-bg-elev)',
              color: 'var(--c-accent)', fontSize: 12, fontWeight: 600,
              cursor: onPickFromCard ? 'pointer' : 'default',
            }}
          >
            <Icon name="alert" size={13} />{label.count} кода — выберите
          </button>
          {canEdit && (
            <button
              type="button"
              title="Прикрепить файл этикетки — PDF, PNG, JPG. Можно перетащить файл в ячейку"
              disabled={uploading}
              onClick={() => pickFile(null)}
              className="btn ghost icon sm"
              style={{ width: 22, height: 22, color: 'var(--c-text-subtle)' }}
            >
              <Icon name="importFile" size={12} />
            </button>
          )}
        </span>
        <span style={{
          fontSize: 10.5, lineHeight: '12px', color: 'var(--c-accent)',
          maxWidth: 232, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          Коды разных кабинетов
        </span>
      </div>
    )
  }

  // Кода нет — маркировать нечем. На задаче с ТСД это ещё и стоп для сборки.
  if (entries.length === 0 && label && label.kind === 'missing') {
    return (
      <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
        {hiddenInput}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
          <button
            type="button"
            onClick={onPickFromCard}
            disabled={!onPickFromCard}
            title="Чем маркировать эту строку"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              height: 30, padding: '0 9px', borderRadius: 'var(--r-md)',
              border: '1px solid var(--c-warning)', background: 'var(--c-warning-bg)',
              color: 'var(--c-warning)', fontSize: 12, fontWeight: 600,
              cursor: onPickFromCard ? 'pointer' : 'default',
            }}
          >
            <Icon name="alert" size={13} />{label.reason.startsWith('Выбранный код') ? 'Код снят' : 'Нет ШК'}
          </button>
          {canEdit && (
            <button
              type="button"
              title="Прикрепить файл этикетки — PDF, PNG, JPG. Можно перетащить файл в ячейку"
              disabled={uploading}
              onClick={() => pickFile(null)}
              className="btn ghost icon sm"
              style={{ width: 22, height: 22, color: 'var(--c-text-subtle)' }}
            >
              <Icon name="importFile" size={12} />
            </button>
          )}
        </span>
        <span style={{
          fontSize: 10.5, lineHeight: '12px', color: 'var(--c-warning)',
          maxWidth: 232, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }} title={label.reason}>
          {label.reason.startsWith('Выбранный код')
            ? 'Код снят с карточки'
            : labelScanCritical ? 'Сканер не опознает товар' : 'Печатать нечего'}
          {productHref ? <> — <Link to={productHref} style={{ color: 'var(--c-warning)' }}>добавить код</Link></> : null}
        </span>
      </div>
    )
  }

  if (entries.length === 0 && label && label.kind === 'loading') {
    return (
      <span style={{
        display: 'inline-block', width: 150, height: 30, borderRadius: 'var(--r-md)',
        background: 'var(--c-bg-sunken)', border: '1px solid var(--c-border)',
      }} />
    )
  }

  // Пусто + можно прикрепить → приглушённая ghost-кнопка (не «кричит» на пустых строках)
  if (entries.length === 0) {
    return (
      <div style={{ display: 'inline-flex', gap: 4 }}>
        {hiddenInput}
        <button
          type="button"
          title="Прикрепить файл — PDF, PNG, JPG. Можно перетащить файл в ячейку"
          disabled={uploading}
          onClick={() => pickFile(null)}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            height: 28, width: 28, borderRadius: 'var(--r-md)',
            border: '1px solid var(--c-border)',
            background: 'var(--c-bg-elev)',
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
          border: '1px solid var(--c-border)',
          background: 'var(--c-bg-elev)',
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
                  title="Прикрепить ещё файл — или перетащите его в ячейку"
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
            fontSize: 10.5, lineHeight: '12px',
            color: single.captionTone === 'danger' ? 'var(--c-danger)' : 'var(--c-text-subtle)',
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
                        fontSize: 10.5,
                        color: entry.captionTone === 'danger' ? 'var(--c-danger)' : 'var(--c-text-subtle)',
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

  // Приём файла перетаскиванием — на общей обёртке: варианты ячейки (файл, код карточки,
  // «нет ШК», выбор кода) рисуются разными ветками, а вести файл можно в любую из них.
  return (
    <div
      onDragEnter={handleDragOver}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        display: 'inline-flex',
        borderRadius: 'var(--r-md)',
        transition: 'background-color 120ms ease',
        ...(dragOver && canEdit
          ? { outline: '2px dashed var(--c-accent)', outlineOffset: 3, background: 'var(--c-accent-bg)' }
          : null),
      }}
    >
      {renderContent()}
    </div>
  )
}
