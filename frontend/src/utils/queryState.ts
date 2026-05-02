export type ListSortState = { field: string; direction: 'asc' | 'desc' } | null

export type ListQueryLimits = 20 | 50 | 100

/** Значения фильтров списка (подмножество ключей задаётся filterKeys в хуке). */
export type ListFilters = {
  search?: string
  name?: string
  sku?: string
  supplier?: string
  type?: string
  type_id?: string
  client_id?: string
  supplier_id?: string
  /** ID записи системного справочника актуальности (GET /system/record-actuality). */
  actuality_id?: string
  /** YYYY-MM-DD, начало периода (ТЗ: date_from) */
  date_from?: string
  /** YYYY-MM-DD, конец периода (ТЗ: date_to) */
  date_to?: string
  /** Фильтр списка пользователей по роли (URL: users_role). */
  users_role?: string
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

function parseYyyyMmDdParam(raw: string | null | undefined): string | undefined {
  if (raw == null || !String(raw).trim()) return undefined
  const v = String(raw).trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined
}

function parseUsersRoleParam(raw: string | null | undefined): string | undefined {
  if (raw == null || !String(raw).trim()) return undefined
  const v = String(raw).trim()
  const allowed = new Set(['user', 'manager', 'client', 'admin'])
  return allowed.has(v) ? v : undefined
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
    } else if (key === 'name') {
      const v = sp.get('name')
      filters.name = v != null && v.trim() !== '' ? v.trim() : undefined
    } else if (key === 'sku') {
      const v = sp.get('sku')
      filters.sku = v != null && v.trim() !== '' ? v.trim() : undefined
    } else if (key === 'supplier') {
      const v = sp.get('supplier')
      filters.supplier = v != null && v.trim() !== '' ? v.trim() : undefined
    } else if (key === 'type') {
      const v = sp.get('type')
      filters.type = v === 'clothes' || v === 'tech' ? v : undefined
    } else if (key === 'type_id') {
      const v = sp.get('type_id')
      filters.type_id = v != null && v.trim() !== '' ? v.trim() : undefined
    } else if (key === 'client_id') {
      const v = sp.get('client_id')
      filters.client_id = v != null && v.trim() !== '' ? v.trim() : undefined
    } else if (key === 'supplier_id') {
      const v = sp.get('supplier_id')
      filters.supplier_id = v != null && v.trim() !== '' ? v.trim() : undefined
    } else if (key === 'actuality_id') {
      const v = sp.get('actuality_id')
      filters.actuality_id = v != null && v.trim() !== '' ? v.trim() : undefined
    } else if (key === 'date_from') {
      filters.date_from = parseYyyyMmDdParam(sp.get('date_from'))
    } else if (key === 'date_to') {
      filters.date_to = parseYyyyMmDdParam(sp.get('date_to'))
    } else if (key === 'users_role') {
      filters.users_role = parseUsersRoleParam(sp.get('users_role'))
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
    } else if (key === 'name') {
      const v = q.filters.name
      if (v != null && String(v).trim() !== '') next.set('name', String(v).trim())
      else next.delete('name')
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
    } else if (key === 'type_id') {
      const v = q.filters.type_id
      if (v != null && String(v).trim() !== '') next.set('type_id', String(v).trim())
      else next.delete('type_id')
    } else if (key === 'client_id') {
      const v = q.filters.client_id
      if (v != null && String(v).trim() !== '') next.set('client_id', String(v).trim())
      else next.delete('client_id')
    } else if (key === 'supplier_id') {
      const v = q.filters.supplier_id
      if (v != null && String(v).trim() !== '') next.set('supplier_id', String(v).trim())
      else next.delete('supplier_id')
    } else if (key === 'actuality_id') {
      const v = q.filters.actuality_id
      if (v != null && String(v).trim() !== '') next.set('actuality_id', String(v).trim())
      else next.delete('actuality_id')
    } else if (key === 'date_from') {
      const v = q.filters.date_from
      const parsed = v != null ? parseYyyyMmDdParam(v) : undefined
      if (parsed) next.set('date_from', parsed)
      else next.delete('date_from')
    } else if (key === 'date_to') {
      const v = q.filters.date_to
      const parsed = v != null ? parseYyyyMmDdParam(v) : undefined
      if (parsed) next.set('date_to', parsed)
      else next.delete('date_to')
    } else if (key === 'users_role') {
      const v = parseUsersRoleParam(q.filters.users_role ?? null)
      if (v) next.set('users_role', v)
      else next.delete('users_role')
    }
  }

  return next
}

export type ListApiQueryParams = {
  page: number
  limit: number
  search?: string
  name?: string
  sku?: string
  supplier?: string
  type?: 'clothes' | 'tech'
  type_id?: string
  client_id?: string
  supplier_id?: string
  actuality_id?: string
  sort?: string
  date_from?: string
  date_to?: string
}

export function listQueryToApiParams(q: ParsedListQuery): ListApiQueryParams {
  const out: ListApiQueryParams = { page: q.page, limit: q.limit }
  const s = q.filters.search
  if (s != null && String(s).trim() !== '') out.search = String(s).trim()
  const name = q.filters.name
  if (name != null && String(name).trim() !== '') out.name = String(name).trim()
  const sku = q.filters.sku
  if (sku != null && String(sku).trim() !== '') out.sku = String(sku).trim()
  const sup = q.filters.supplier
  if (sup != null && String(sup).trim() !== '') out.supplier = String(sup).trim()
  const t = q.filters.type
  if (t === 'clothes' || t === 'tech') out.type = t
  const tid = q.filters.type_id
  if (tid != null && String(tid).trim() !== '') out.type_id = String(tid).trim()
  const cid = q.filters.client_id
  if (cid != null && String(cid).trim() !== '') out.client_id = String(cid).trim()
  const sid = q.filters.supplier_id
  if (sid != null && String(sid).trim() !== '') out.supplier_id = String(sid).trim()
  const aid = q.filters.actuality_id
  if (aid != null && String(aid).trim() !== '') out.actuality_id = String(aid).trim()
  const df = q.filters.date_from
  const dfParsed = df != null ? parseYyyyMmDdParam(df) : undefined
  if (dfParsed) out.date_from = dfParsed
  const dt = q.filters.date_to
  const dtParsed = dt != null ? parseYyyyMmDdParam(dt) : undefined
  if (dtParsed) out.date_to = dtParsed
  const sortStr = serializeSortParam(q.sort)
  if (sortStr) out.sort = sortStr
  return out
}
