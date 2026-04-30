export type ListSortState = { field: string; direction: 'asc' | 'desc' } | null

export type ListQueryLimits = 20 | 50 | 100

/** Значения фильтров списка (подмножество ключей задаётся filterKeys в хуке). */
export type ListFilters = {
  search?: string
  sku?: string
  supplier?: string
  type?: string
  is_active?: boolean
}

export type ParsedListQuery = {
  page: number
  limit: ListQueryLimits
  filters: ListFilters
  sort: ListSortState
}

const LIMITS: readonly ListQueryLimits[] = [20, 50, 100]

export function parseSortParam(raw: string | null): ListSortState {
  if (raw == null || !raw.trim()) return null
  const s = raw.trim()
  const i = s.lastIndexOf('_')
  if (i <= 0) return null
  const field = s.slice(0, i)
  const direction = s.slice(i + 1).toLowerCase()
  if (!field || (direction !== 'asc' && direction !== 'desc')) return null
  return { field, direction: direction as 'asc' | 'desc' }
}

export function serializeSortParam(sort: ListSortState): string | undefined {
  if (!sort) return undefined
  return `${sort.field}_${sort.direction}`
}

export function cycleSort(current: ListSortState, field: string): ListSortState {
  if (!current || current.field !== field) return { field, direction: 'asc' }
  if (current.direction === 'asc') return { field, direction: 'desc' }
  return null
}

function parseLimit(raw: string | null): ListQueryLimits {
  const n = parseInt(raw || '20', 10)
  return LIMITS.includes(n as ListQueryLimits) ? (n as ListQueryLimits) : 20
}

export function parseListQueryFromSearchParams(
  sp: URLSearchParams,
  filterKeys: readonly string[],
): ParsedListQuery {
  const page = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1)
  const limit = parseLimit(sp.get('limit'))
  const sort = parseSortParam(sp.get('sort'))

  const filters: ListFilters = {}
  for (const key of filterKeys) {
    if (key === 'search') {
      const v = sp.get('search')
      filters.search = v != null && v.trim() !== '' ? v.trim() : undefined
    } else if (key === 'sku') {
      const v = sp.get('sku')
      filters.sku = v != null && v.trim() !== '' ? v.trim() : undefined
    } else if (key === 'supplier') {
      const v = sp.get('supplier')
      filters.supplier = v != null && v.trim() !== '' ? v.trim() : undefined
    } else if (key === 'type') {
      const v = sp.get('type')
      filters.type = v === 'clothes' || v === 'tech' ? v : undefined
    } else if (key === 'is_active') {
      const v = sp.get('is_active')
      if (v === 'true') filters.is_active = true
      else if (v === 'false') filters.is_active = false
      else filters.is_active = undefined
    }
  }

  return { page, limit, filters, sort }
}

export function applyListQueryToSearchParams(
  base: URLSearchParams,
  q: ParsedListQuery,
  filterKeys: readonly string[],
): URLSearchParams {
  const next = new URLSearchParams(base)
  next.set('page', String(q.page))
  next.set('limit', String(q.limit))

  const sortStr = serializeSortParam(q.sort)
  if (sortStr) next.set('sort', sortStr)
  else next.delete('sort')

  for (const key of filterKeys) {
    if (key === 'search') {
      const v = q.filters.search
      if (v != null && String(v).trim() !== '') next.set('search', String(v).trim())
      else next.delete('search')
    } else if (key === 'sku') {
      const v = q.filters.sku
      if (v != null && String(v).trim() !== '') next.set('sku', String(v).trim())
      else next.delete('sku')
    } else if (key === 'supplier') {
      const v = q.filters.supplier
      if (v != null && String(v).trim() !== '') next.set('supplier', String(v).trim())
      else next.delete('supplier')
    } else if (key === 'type') {
      const v = q.filters.type
      if (v === 'clothes' || v === 'tech') next.set('type', v)
      else next.delete('type')
    } else if (key === 'is_active') {
      const v = q.filters.is_active
      if (v === true) next.set('is_active', 'true')
      else if (v === false) next.set('is_active', 'false')
      else next.delete('is_active')
    }
  }

  return next
}

export type ListApiQueryParams = {
  page: number
  limit: number
  search?: string
  sku?: string
  supplier?: string
  type?: 'clothes' | 'tech'
  is_active?: boolean
  sort?: string
}

export function listQueryToApiParams(q: ParsedListQuery): ListApiQueryParams {
  const out: ListApiQueryParams = { page: q.page, limit: q.limit }
  const s = q.filters.search
  if (s != null && String(s).trim() !== '') out.search = String(s).trim()
  const sku = q.filters.sku
  if (sku != null && String(sku).trim() !== '') out.sku = String(sku).trim()
  const sup = q.filters.supplier
  if (sup != null && String(sup).trim() !== '') out.supplier = String(sup).trim()
  const t = q.filters.type
  if (t === 'clothes' || t === 'tech') out.type = t
  const a = q.filters.is_active
  if (a === true || a === false) out.is_active = a
  const sortStr = serializeSortParam(q.sort)
  if (sortStr) out.sort = sortStr
  return out
}
