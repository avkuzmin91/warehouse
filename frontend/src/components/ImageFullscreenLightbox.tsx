import { useEffect } from 'react'
import { createPortal } from 'react-dom'

/** Иконка «на весь экран» для превью фото */
export function PhotoExpandIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 8V4h4M20 16v4h-4M20 8V4h-4M4 16v4h4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

type Props = {
  open: boolean
  src: string | null
  alt?: string
  onClose: () => void
}

export function ImageFullscreenLightbox({ open, src, alt = '', onClose }: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose])

  if (!open || !src || typeof document === 'undefined') return null

  return createPortal(
    <div
      className="image-fullscreen-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="Просмотр изображения"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <button
        type="button"
        className="image-fullscreen-lightbox__close"
        aria-label="Закрыть"
        title="Закрыть (Esc)"
        onClick={onClose}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
          <path
            d="M18 6L6 18M6 6l12 12"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <div
        className="image-fullscreen-lightbox__frame"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="presentation"
      >
        <img src={src} alt={alt} className="image-fullscreen-lightbox__img" />
      </div>
    </div>,
    document.body,
  )
}
