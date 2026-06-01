import { useSearchParams } from 'react-router-dom'

/**
 * Читает строковый фильтр из URL query string и возвращает сеттер.
 * Смена фильтра создаёт новую запись в истории (replace: false) → «назад» восстанавливает фильтры.
 * При смене фильтра автоматически сбрасывает page=1.
 */
export function useFilterParam(key: string, def: string): [string, (v: string) => void] {
  const [params, setParams] = useSearchParams()
  const value = params.get(key) ?? def

  function setValue(v: string) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (v === def) {
          next.delete(key)
        } else {
          next.set(key, v)
        }
        next.delete('page')
        return next
      },
      { replace: false },
    )
  }

  return [value, setValue]
}

export function useFilterParamsActions() {
  const [, setParams] = useSearchParams()

  function setMany(updates: Record<string, string | null | undefined>) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const [key, value] of Object.entries(updates)) {
          if (value == null || value === '') next.delete(key)
          else next.set(key, value)
        }
        next.delete('page')
        return next
      },
      { replace: false },
    )
  }

  return { setMany }
}

/**
 * Читает page из URL. Смена страницы использует replace:true — не засоряет историю.
 */
export function usePageParam(): [number, (v: number) => void] {
  const [params, setParams] = useSearchParams()
  const value = Math.max(1, parseInt(params.get('page') ?? '1', 10) || 1)

  function setValue(v: number) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (v <= 1) {
          next.delete('page')
        } else {
          next.set('page', String(v))
        }
        return next
      },
      { replace: true },
    )
  }

  return [value, setValue]
}
