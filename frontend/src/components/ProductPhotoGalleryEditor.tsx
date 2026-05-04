import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import { ImageFullscreenLightbox, PhotoExpandIcon } from './ImageFullscreenLightbox'
import { resolvePublicUploadSrc, uploadProductDictionaryImage } from '../api'

export type ProductGallerySlot =
  | { kind: 'remote'; url: string }
  | { kind: 'local'; file: File }

function slotPreviewSrc(slot: ProductGallerySlot): string {
  if (slot.kind === 'remote') return resolvePublicUploadSrc(slot.url)
  return URL.createObjectURL(slot.file)
}

export function slotsFromImageUrls(urls: string[] | undefined): ProductGallerySlot[] {
  if (!urls || urls.length === 0) return []
  return urls.map((url) => ({ kind: 'remote' as const, url }))
}

export async function resolveProductGalleryForSave(
  slots: ProductGallerySlot[],
): Promise<string[]> {
  const out: string[] = []
  for (const s of slots) {
    if (s.kind === 'remote') {
      out.push(s.url)
    } else {
      const { url } = await uploadProductDictionaryImage(s.file)
      out.push(url)
    }
  }
  return out
}

type Props = {
  /** Слоты: URL с сервера и/или новые файлы; порядок = порядок в галерее. */
  slots: ProductGallerySlot[]
  onSlotsChange: Dispatch<SetStateAction<ProductGallerySlot[]>>
  disabled?: boolean
}

/**
 * Та же логика, что на странице создания товара: превью, перетаскивание, удаление, полноэкран, загрузка файлов.
 */
export function ProductPhotoGalleryEditor({ slots, onSlotsChange, disabled = false }: Props) {
  const formId = useId()
  const imagesInputRef = useRef<HTMLInputElement>(null)
  const [previews, setPreviews] = useState<string[]>([])
  const [photoDragOver, setPhotoDragOver] = useState<number | null>(null)
  const [photoDragging, setPhotoDragging] = useState<number | null>(null)
  const [photoLightboxSrc, setPhotoLightboxSrc] = useState<string | null>(null)
  const photoDragFromRef = useRef<number | null>(null)

  useEffect(() => {
    const next = slots.map(slotPreviewSrc)
    setPreviews(next)
    return () => {
      for (const u of next) {
        if (u.startsWith('blob:')) URL.revokeObjectURL(u)
      }
    }
  }, [slots])

  const reorderSlots = useCallback(
    (from: number, to: number) => {
      if (from === to) return
      onSlotsChange((prev) => {
        if (from < 0 || to < 0 || from >= prev.length || to >= prev.length) return prev
        const n = [...prev]
        const [x] = n.splice(from, 1)
        if (x === undefined) return prev
        n.splice(to, 0, x)
        return n
      })
    },
    [onSlotsChange],
  )

  return (
    <div className="product-create-form">
      <h2 className="product-variants-editor__title" id={`${formId}-ph-title`}>
        Фотографии
      </h2>
      <div
        className="product-multi-preview"
        role="list"
        aria-labelledby={`${formId}-ph-title`}
        aria-label="Превью фотографий, перетаскивание меняет порядок"
      >
        {previews.map((src, i) => {
          const s = slots[i]
          const key =
            s?.kind === 'local'
              ? `local-${s.file.name}-${s.file.size}-${s.file.lastModified}`
              : `remote-${s?.kind === 'remote' ? s.url : i}`
          return (
            <div
              key={key}
              className={`product-multi-preview__card${photoDragOver === i ? ' product-multi-preview__card--over' : ''}${photoDragging === i ? ' product-multi-preview__card--dragging' : ''}`.trim()}
              role="listitem"
              draggable={!disabled}
              title="Перетащите, чтобы изменить порядок"
              onDragStart={(e) => {
                if (disabled) return
                photoDragFromRef.current = i
                e.dataTransfer.setData('text/plain', String(i))
                e.dataTransfer.effectAllowed = 'move'
                setPhotoDragging(i)
              }}
              onDragEnd={() => {
                photoDragFromRef.current = null
                setPhotoDragging(null)
                setPhotoDragOver(null)
              }}
              onDragEnter={(e) => {
                e.preventDefault()
                setPhotoDragOver(i)
              }}
              onDragOver={(e) => {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                setPhotoDragOver(i)
              }}
              onDrop={(e) => {
                e.preventDefault()
                e.stopPropagation()
                const from = photoDragFromRef.current
                photoDragFromRef.current = null
                if (from === null || Number.isNaN(from)) return
                if (from === i) return
                reorderSlots(from, i)
                setPhotoDragging(null)
                setPhotoDragOver(null)
              }}
            >
              <div className="product-multi-preview__frame">
                <img src={src} alt="" className="product-create-preview__img" draggable={false} />
              </div>
              <div className="product-multi-preview__actions">
                <button
                  type="button"
                  className="product-multi-preview__action product-multi-preview__action--delete"
                  aria-label="Удалить фото"
                  title="Удалить"
                  disabled={disabled}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    onSlotsChange((prev) => prev.filter((_, j) => j !== i))
                  }}
                >
                  <svg className="product-multi-preview__action-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M9 3h6M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14"
                      stroke="currentColor"
                      strokeWidth="1.85"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  className="product-multi-preview__action product-multi-preview__action--expand"
                  aria-label="Открыть на весь экран"
                  title="На весь экран"
                  disabled={disabled}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    setPhotoLightboxSrc(src)
                  }}
                >
                  <PhotoExpandIcon className="product-multi-preview__action-icon" />
                </button>
              </div>
            </div>
          )
        })}
      </div>
      <div className="product-photo-picker">
        <input
          ref={imagesInputRef}
          className="file-field__native"
          type="file"
          accept="image/jpeg,image/jpg,image/png,image/heic,image/heif,.heic,.heif"
          multiple
          disabled={disabled}
          onChange={(e) => {
            const list = e.target.files ? Array.from(e.target.files) : []
            onSlotsChange((prev) => [...prev, ...list.map((file) => ({ kind: 'local' as const, file }))])
            e.target.value = ''
          }}
        />
        <button
          type="button"
          className="product-photo-picker__btn"
          aria-label="Выбрать файлы изображений"
          title="JPG, PNG, HEIC — несколько файлов"
          disabled={disabled}
          onClick={() => imagesInputRef.current?.click()}
        >
          <svg className="product-photo-picker__icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.75" />
            <circle cx="8.5" cy="10" r="1.35" fill="currentColor" />
            <path
              d="M21 17l-4.2-4.2a1.2 1.2 0 00-1.6.05L12 15.5l-2.2-2.2a1.2 1.2 0 00-1.65 0L3 17"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>Добавить фото</span>
        </button>
      </div>
      <p className="field-hint">
        Форматы: JPG, PNG, HEIC. Превью карточки — первое фото в списке; порядок можно менять перетаскиванием.
      </p>
      <ImageFullscreenLightbox
        open={photoLightboxSrc !== null}
        src={photoLightboxSrc}
        onClose={() => setPhotoLightboxSrc(null)}
      />
    </div>
  )
}
