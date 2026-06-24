import { useCallback, useEffect, useRef, useState } from 'react'

export type PagedResponse<T> = { items: T[]; total: number; page: number; limit: number }

const PAGE_SIZE = 50

/**
 * Постраничный список с догрузкой («Показать ещё»). Закрывает тихое обрезание
 * длинных списков: первая страница грузится при монтировании, остальные —
 * добавляются по запросу, пока `items.length < total`.
 *
 * `fetchPage` должен быть стабильным (обернуть в useCallback у вызывающего) —
 * его смена перезагружает список с первой страницы.
 */
export function usePagedList<T>(
  fetchPage: (page: number, limit: number, signal?: AbortSignal) => Promise<PagedResponse<T>>,
) {
  const [items, setItems] = useState<T[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const pageRef = useRef(1)

  const loadPage = useCallback(
    (page: number, signal?: AbortSignal, silent = false) => {
      if (page === 1) {
        if (!silent) setLoading(true)
      } else {
        setLoadingMore(true)
      }
      setError('')
      return fetchPage(page, PAGE_SIZE, signal)
        .then((res) => {
          if (signal?.aborted) return
          pageRef.current = res.page
          setTotal(res.total)
          setItems((prev) => (page === 1 ? res.items : [...prev, ...res.items]))
        })
        .catch((err) => {
          if (signal?.aborted) return
          setError(err instanceof Error ? err.message : 'Не удалось загрузить данные')
        })
        .finally(() => {
          if (signal?.aborted) return
          if (page === 1) setLoading(false)
          else setLoadingMore(false)
        })
    },
    [fetchPage],
  )

  useEffect(() => {
    const ac = new AbortController()
    loadPage(1, ac.signal)
    return () => ac.abort()
  }, [loadPage])

  const refresh = useCallback(() => loadPage(1, undefined, true), [loadPage])
  const loadMore = useCallback(() => {
    if (loadingMore) return
    void loadPage(pageRef.current + 1)
  }, [loadPage, loadingMore])

  return { items, total, loading, loadingMore, error, refresh, loadMore, hasMore: items.length < total }
}
