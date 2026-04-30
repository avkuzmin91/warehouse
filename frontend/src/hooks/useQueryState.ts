import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  applyListQueryToSearchParams,
  cycleSort,
  listQueryToApiParams,
  parseListQueryFromSearchParams,
  type ListFilters,
  type ListSortState,
  type ParsedListQuery,
} from '../utils/queryState'

export type UseQueryStateFilterKey = 'search' | 'sku' | 'supplier' | 'type' | 'is_active'

export function useQueryState(options: { filterKeys: readonly UseQueryStateFilterKey[] }) {
  const { filterKeys } = options
  const [searchParams, setSearchParams] = useSearchParams()

  const query = useMemo(
    () => parseListQueryFromSearchParams(searchParams, filterKeys),
    [searchParams, filterKeys],
  )

  const apiParams = useMemo(() => listQueryToApiParams(query), [query])

  const commitParsed = useCallback(
    (updater: (prev: ParsedListQuery) => ParsedListQuery) => {
      setSearchParams(
        (prevSp) => {
          const prev = parseListQueryFromSearchParams(prevSp, filterKeys)
          return applyListQueryToSearchParams(prevSp, updater(prev), filterKeys)
        },
        { replace: true },
      )
    },
    [filterKeys, setSearchParams],
  )

  const setPage = useCallback(
    (page: number) => {
      commitParsed((prev) => ({ ...prev, page: Math.max(1, page) }))
    },
    [commitParsed],
  )

  const setLimit = useCallback(
    (limit: ParsedListQuery['limit']) => {
      commitParsed((prev) => ({ ...prev, limit, page: 1 }))
    },
    [commitParsed],
  )

  const setFilters = useCallback(
    (patch: Partial<ListFilters>) => {
      commitParsed((prev) => {
        const nextFilters: ListFilters = { ...prev.filters }
        for (const [k, v] of Object.entries(patch) as [keyof ListFilters, string | boolean | undefined][]) {
          if (v === undefined) {
            delete nextFilters[k]
          } else {
            if (k === 'search') nextFilters.search = v as string
            else if (k === 'sku') nextFilters.sku = v as string
            else if (k === 'supplier') nextFilters.supplier = v as string
            else if (k === 'type') nextFilters.type = v as string
            else if (k === 'is_active') nextFilters.is_active = v as boolean
          }
        }
        return { ...prev, filters: nextFilters, page: 1 }
      })
    },
    [commitParsed],
  )

  const setSort = useCallback(
    (sort: ListSortState) => {
      commitParsed((prev) => ({ ...prev, sort }))
    },
    [commitParsed],
  )

  const cycleSortField = useCallback(
    (field: string) => {
      commitParsed((prev) => ({
        ...prev,
        sort: cycleSort(prev.sort, field),
      }))
    },
    [commitParsed],
  )

  const resetFilters = useCallback(() => {
    commitParsed((prev) => {
      const nextFilters: ListFilters = { ...prev.filters }
      for (const k of filterKeys) {
        if (k === 'search') delete nextFilters.search
        if (k === 'sku') delete nextFilters.sku
        if (k === 'supplier') delete nextFilters.supplier
        if (k === 'type') delete nextFilters.type
        if (k === 'is_active') delete nextFilters.is_active
      }
      return { ...prev, filters: nextFilters, page: 1 }
    })
  }, [commitParsed, filterKeys])

  return {
    query,
    apiParams,
    setFilters,
    setPage,
    setLimit,
    setSort,
    cycleSortField,
    resetFilters,
  }
}
