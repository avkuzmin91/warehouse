import { useNavigate } from 'react-router-dom'

/**
 * Кнопка «Назад» в шапках карточек/форм: возвращает по истории браузера,
 * чтобы не терять URL-state списка (фильтры, страницу, таб). При прямом
 * заходе по ссылке (истории внутри приложения нет) — переход на fallback.
 */
export function useBackNav(fallback: string): () => void {
  const navigate = useNavigate()
  return () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx
    if (typeof idx === 'number' && idx > 0) navigate(-1)
    else navigate(fallback)
  }
}
