import { useEffect, useState } from 'react'

export interface UseApiResult<T> {
  data: T | null
  loading: boolean
  error: Error | null
}

/**
 * Хук для загрузки данных с API. Управляет loading/error/AbortController.
 *
 * - При смене `deps` запрос отменяется и пере-выполняется.
 * - При unmount запрос отменяется.
 * - Старые ответы игнорируются (защита от race conditions).
 *
 * @example
 *   const { data, loading, error } = useApi(
 *     (signal) => getShipment(docId, signal),
 *     [docId],
 *   )
 */
export function useApi<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deps: any[],
): UseApiResult<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(
    () => {
      const ctrl = new AbortController()
      setLoading(true)
      setError(null)
      fn(ctrl.signal)
        .then((res) => {
          if (ctrl.signal.aborted) return
          setData(res)
          setLoading(false)
        })
        .catch((e) => {
          if (ctrl.signal.aborted) return
          setError(e instanceof Error ? e : new Error(String(e)))
          setLoading(false)
        })
      return () => ctrl.abort()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps,
  )

  return { data, loading, error }
}
