import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { ReceiptStatus } from '../api/domainTypes'
import {
  applyListQueryToSearchParams,
  cycleSort,
  listQueryToApiParams,
  parseListQueryFromSearchParams,
  type ListFilters,
  type ListSortState,
  type ParsedListQuery,
} from '../utils/queryState'

export type UseQueryStateFilterKey =
  | 'search'
  | 'name'
  | 'sku'
  | 'supplier'
  | 'type'
  | 'type_id'
  | 'client_id'
  | 'supplier_id'
  | 'product_id'
  | 'color_id'
  | 'size_id'
  | 'op_type'
  | 'receipt_status'
  | 'shipment_status'
  | 'actuality_id'
  | 'date_from'
  | 'date_to'
  | 'users_role'
  | 'has_defect'
  | 'has_uninspected'
  | 'no_good'
  | 'only_defect'

export function useQueryState(options: { filterKeys: readonly UseQueryStateFilterKey[] }) {
  const { filterKeys } = options
  const [searchParams, setSearchParams] = useSearchParams()

  /** Строка query: стабильная при неизменном URL (объект searchParams меняет ссылку каждый рендер). */
  const searchSnapshot = searchParams.toString()

  const query = useMemo(() => {
    const sp = new URLSearchParams(searchSnapshot)
    return parseListQueryFromSearchParams(sp, filterKeys)
  }, [searchSnapshot, filterKeys])

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
            else if (k === 'name') nextFilters.name = v as string
            else if (k === 'sku') nextFilters.sku = v as string
            else if (k === 'supplier') nextFilters.supplier = v as string
            else if (k === 'type') nextFilters.type = v as string
            else if (k === 'type_id') nextFilters.type_id = v as string
            else if (k === 'client_id') nextFilters.client_id = v as string
            else if (k === 'supplier_id') nextFilters.supplier_id = v as string
            else if (k === 'product_id') nextFilters.product_id = v as string
            else if (k === 'color_id') nextFilters.color_id = v as string
            else if (k === 'size_id') nextFilters.size_id = v as string
            else if (k === 'op_type') nextFilters.op_type = v as string
            else if (k === 'receipt_status') nextFilters.receipt_status = v as ReceiptStatus | ''
            else if (k === 'shipment_status') nextFilters.shipment_status = v as string
            else if (k === 'actuality_id') nextFilters.actuality_id = v as string
            else if (k === 'date_from') nextFilters.date_from = v as string | undefined
            else if (k === 'date_to') nextFilters.date_to = v as string | undefined
            else if (k === 'users_role') nextFilters.users_role = v as string
            else if (k === 'has_defect') nextFilters.has_defect = v as string
            else if (k === 'has_uninspected') nextFilters.has_uninspected = v as string
            else if (k === 'no_good') nextFilters.no_good = v as string
            else if (k === 'only_defect') nextFilters.only_defect = v as string
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
        if (k === 'name') delete nextFilters.name
        if (k === 'sku') delete nextFilters.sku
        if (k === 'supplier') delete nextFilters.supplier
        if (k === 'type') delete nextFilters.type
        if (k === 'type_id') delete nextFilters.type_id
        if (k === 'client_id') delete nextFilters.client_id
        if (k === 'supplier_id') delete nextFilters.supplier_id
        if (k === 'product_id') delete nextFilters.product_id
        if (k === 'color_id') delete nextFilters.color_id
        if (k === 'size_id') delete nextFilters.size_id
        if (k === 'op_type') delete nextFilters.op_type
        if (k === 'receipt_status') delete nextFilters.receipt_status
        if (k === 'shipment_status') delete nextFilters.shipment_status
        if (k === 'actuality_id') delete nextFilters.actuality_id
        if (k === 'date_from') delete nextFilters.date_from
        if (k === 'date_to') delete nextFilters.date_to
        if (k === 'users_role') delete nextFilters.users_role
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
