import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../primitives/Icon'

export interface LightboxImage {
  src: string
  caption?: string
}

interface LightboxProps {
  images: LightboxImage[]
  initialIndex?: number
  onClose: () => void
}

export function Lightbox({ images, initialIndex = 0, onClose }: LightboxProps) {
  const [idx, setIdx] = useState(() => Math.min(Math.max(initialIndex, 0), Math.max(images.length - 1, 0)))
  const thumbsRef = useRef<HTMLDivElement>(null)

  const prev = useCallback(() => {
    setIdx((i) => (i === 0 ? images.length - 1 : i - 1))
  }, [images.length])

  const next = useCallback(() => {
    setIdx((i) => (i === images.length - 1 ? 0 : i + 1))
  }, [images.length])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') prev()
      else if (e.key === 'ArrowRight') next()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose, prev, next])

  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prevOverflow }
  }, [])

  useEffect(() => {
    if (images.length < 2) return
    for (const n of [images[(idx + 1) % images.length], images[(idx - 1 + images.length) % images.length]]) {
      const im = new Image()
      im.src = n.src
    }
  }, [idx, images])

  useEffect(() => {
    thumbsRef.current?.children[idx]?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }, [idx])

  if (images.length === 0) return null
  const current = images[idx]
  const many = images.length > 1

  return createPortal(
    <div className="lbx" onClick={onClose}>
      <div className="lbx-top" onClick={(e) => e.stopPropagation()}>
        {current.caption && <div className="lbx-caption">{current.caption}</div>}
        {many && <div className="lbx-count mono">{idx + 1} / {images.length}</div>}
        <div className="flex-1" />
        <button type="button" className="lbx-btn" onClick={onClose} title="Закрыть (Esc)">
          <Icon name="x" size={17} />
        </button>
      </div>

      {many && (
        <button
          type="button"
          className="lbx-btn lbx-nav prev"
          onClick={(e) => { e.stopPropagation(); prev() }}
          title="Предыдущее фото"
        >
          <Icon name="arrowLeft" size={20} />
        </button>
      )}

      <img key={current.src} className="lbx-img" src={current.src} alt={current.caption ?? ''} onClick={(e) => e.stopPropagation()} />

      {many && (
        <button
          type="button"
          className="lbx-btn lbx-nav next"
          onClick={(e) => { e.stopPropagation(); next() }}
          title="Следующее фото"
        >
          <Icon name="arrowRight" size={20} />
        </button>
      )}

      {many && (
        <div ref={thumbsRef} className="lbx-thumbs" onClick={(e) => e.stopPropagation()}>
          {images.map((im, i) => (
            <img
              key={`${im.src}-${i}`}
              src={im.src}
              alt=""
              className={`lbx-thumb${i === idx ? ' active' : ''}`}
              onClick={() => setIdx(i)}
            />
          ))}
        </div>
      )}
    </div>,
    document.body,
  )
}
