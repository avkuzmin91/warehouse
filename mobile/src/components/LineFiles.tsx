import { useEffect, useRef, useState } from 'react'
import { requestBlob } from '../api/http'
import { IS_NATIVE } from '../api/constants'
import { Icon, type IconName } from './Icon'
import { useHardwareBack } from '../nav/backHandlers'

// Вложения строки документа (ТЗ по упаковке, накладные, фото). Файлы раздаются
// backend'ом только аутентифицированным, поэтому качаем blob с Bearer-заголовком:
// картинки показываем во весь экран прямо в приложении, прочее (pdf/zip) на нативе
// сохраняем в кеш и открываем системным приложением через FileOpener.
export type LineFileEntry = {
  id: string
  filename: string
  url: string
  mime_type: string | null
}

function fileExt(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot).toLowerCase()
}

function isImage(entry: LineFileEntry): boolean {
  if (entry.mime_type?.startsWith('image/')) return true
  return ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.heic'].includes(fileExt(entry.filename || entry.url))
}

function fileGlyph(entry: LineFileEntry): IconName {
  if (isImage(entry)) return 'eye'
  if (fileExt(entry.filename || entry.url) === '.zip') return 'archive'
  return 'file'
}

function contentTypeFor(entry: LineFileEntry): string {
  if (entry.mime_type) return entry.mime_type
  const ext = fileExt(entry.filename || entry.url)
  if (ext === '.pdf') return 'application/pdf'
  if (ext === '.zip') return 'application/zip'
  if (ext === '.png') return 'image/png'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  return 'application/octet-stream'
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'))
    reader.onload = () => {
      const s = String(reader.result)
      resolve(s.slice(s.indexOf(',') + 1))
    }
    reader.readAsDataURL(blob)
  })
}

// Открытие не-картинки на нативе: файл пишется в кеш приложения и открывается
// системным просмотрщиком. Плагины грузим динамически — на вебе они не нужны.
async function openNative(entry: LineFileEntry, blob: Blob): Promise<void> {
  const [{ Filesystem, Directory }, { FileOpener }] = await Promise.all([
    import('@capacitor/filesystem'),
    import('@capacitor-community/file-opener'),
  ])
  // Имя для кеша берём из серверного url (там безопасное хранимое имя), не из
  // пользовательского filename.
  const cacheName = entry.url.slice(entry.url.lastIndexOf('/') + 1) || `file-${entry.id}`
  const written = await Filesystem.writeFile({
    path: cacheName,
    data: await blobToBase64(blob),
    directory: Directory.Cache,
  })
  await FileOpener.open({ filePath: written.uri, contentType: contentTypeFor(entry) })
}

export function LineFiles({
  files,
  onError,
  onDelete,
}: {
  files: LineFileEntry[]
  onError?: (msg: string) => void
  // Удаление вложения (там, где роль/статус это позволяют) — рядом с чипом появляется ×.
  onDelete?: (entry: LineFileEntry) => Promise<void> | void
}) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null)
  const objectUrl = useRef<string | null>(null)

  function releasePreview() {
    if (objectUrl.current) {
      URL.revokeObjectURL(objectUrl.current)
      objectUrl.current = null
    }
    setPreview(null)
  }
  useEffect(() => () => { if (objectUrl.current) URL.revokeObjectURL(objectUrl.current) }, [])
  useHardwareBack(releasePreview, preview !== null)

  async function open(entry: LineFileEntry) {
    if (busyId) return
    setBusyId(entry.id)
    try {
      const blob = await requestBlob(entry.url)
      if (isImage(entry)) {
        releasePreview()
        const url = URL.createObjectURL(blob)
        objectUrl.current = url
        setPreview({ url, name: entry.filename })
      } else if (IS_NATIVE) {
        await openNative(entry, blob)
      } else {
        // Веб-превью (dev): отдаём файл браузеру.
        const url = URL.createObjectURL(blob)
        window.open(url, '_blank', 'noopener')
        setTimeout(() => URL.revokeObjectURL(url), 60_000)
      }
    } catch (err) {
      onError?.(err instanceof Error ? err.message : 'Не удалось открыть файл')
    } finally {
      setBusyId(null)
    }
  }

  async function remove(entry: LineFileEntry) {
    if (busyId || !onDelete) return
    setBusyId(entry.id)
    try {
      await onDelete(entry)
    } catch (err) {
      onError?.(err instanceof Error ? err.message : 'Не удалось удалить файл')
    } finally {
      setBusyId(null)
    }
  }

  if (files.length === 0) return null

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
        {files.map((f) => (
          <span key={f.id} style={{ display: 'inline-flex', gap: 2, maxWidth: '100%' }}>
            <button
              className="btn ghost sm auto"
              style={{ maxWidth: '100%' }}
              disabled={busyId !== null}
              onClick={() => void open(f)}
            >
              <Icon name={busyId === f.id ? 'refresh' : fileGlyph(f)} size={14} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.filename}</span>
            </button>
            {onDelete && (
              <button
                className="btn ghost sm auto"
                aria-label={`Удалить файл ${f.filename}`}
                disabled={busyId !== null}
                onClick={() => void remove(f)}
              >
                <Icon name="x" size={13} />
              </button>
            )}
          </span>
        ))}
      </div>

      {preview && (
        <div
          className="sheet-backdrop"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={releasePreview}
        >
          <div style={{ maxWidth: '100%', maxHeight: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <img
              src={preview.url}
              alt={preview.name}
              style={{ maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain', borderRadius: 12 }}
              onClick={(e) => e.stopPropagation()}
            />
            <button className="btn ghost sm auto" style={{ alignSelf: 'center' }} onClick={releasePreview}>
              <Icon name="x" size={14} /> Закрыть
            </button>
          </div>
        </div>
      )}
    </>
  )
}
