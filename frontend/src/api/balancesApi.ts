import { request } from './http'

// --- Types ---

/** Операционный статус запаса: что товар делает. */
export type InvOpStatus = 'storage' | 'packing' | 'packed' | 'boxed' | 'ready'
/** Качество запаса. «Не проверен» существует только внутри приёмки. */
export type InvQuality = 'good' | 'defect'

export const INV_OP_LABELS: Record<InvOpStatus, string> = {
  storage: 'На хранении',
  packing: 'На упаковке',
  packed:  'Упакован',
  boxed:   'Собран в короб',
  ready:   'Готов к отгрузке',
}

export const INV_QUALITY_LABELS: Record<InvQuality, string> = {
  good:   'Годный',
  defect: 'Брак',
}

/** Ключ группы остатков для UI-состояний (разворот, режим матрицы). */
export function balanceGroupKey(g: { product_id: string; client_id: string | null }): string {
  return `${g.product_id}::${g.client_id ?? ''}`
}

/** Группа с единственным вариантом (техника: один цвет, без размеров) — плоская
 * строка без разворота; атрибуты варианта показываются прямо в подзаголовке. */
export function isFlatBalanceGroup(g: { variants_count: number }): boolean {
  return g.variants_count === 1
}

export function balanceVariantLabel(item: { color_name: string | null; size_name: string | null }): string {
  return [item.color_name, item.size_name].filter(Boolean).join(' · ') || 'Без цвета и размера'
}

/** Причина списания остатков (движение → written_off). */
export type WriteOffReason = 'shortage' | 'damage' | 'disposal' | 'client_return' | 'other'

export const WRITEOFF_REASON_LABELS: Record<WriteOffReason, string> = {
  shortage:      'Недостача',
  damage:        'Порча',
  disposal:      'Утилизация брака',
  client_return: 'Возврат клиенту',
  other:         'Прочее',
}

export type BalanceItem = {
  product_id: string
  product_name: string
  product_sku: string
  color_id: string | null
  color_name: string | null
  size_id: string | null
  size_name: string | null
  /** Порядок размера из справочника — для сеток цвет×размер. */
  size_sort_order?: number | null
  client_id: string | null
  client_name: string | null
  storage_good: number
  storage_defect: number
  packing_good: number
  packing_defect: number
  packed_good: number
  packed_defect: number
  /** Собран в короб (задача размещения): на столе, к отгрузке НЕ доступен. */
  boxed_good: number
  ready_good: number
  ready_defect: number
  total: number
  docs_count: number
}

/**
 * Позиция для планирования отгрузки: остаток на складе + товар в пути.
 * `in_transit` — заявленное, но ещё не приехавшее (planned − accepted по активным
 * поступлениям). Позицию можно положить в черновик, а перевести в план — только
 * когда товар появится на остатках (storage_good).
 */
export type PlannableItem = {
  product_id: string
  product_name: string
  product_sku: string
  sku_pending?: boolean
  client_id: string | null
  client_name: string | null
  color_id: string | null
  color_name: string | null
  size_id: string | null
  size_name: string | null
  ready_good: number
  ready_defect: number
  /** Упаковано, но ещё не размещено по местам — для отгрузки годного такой же источник, как ready. */
  packed_good: number
  /** На столе упаковки (снято со склада, ещё не упаковано) — к отгрузке недоступно, только провенанс. */
  packing_good: number
  storage_good: number
  storage_defect: number
  in_transit: number
  /** ШК ровно этого варианта (цвет×размер) — для сверки позиции с коробкой/письмом клиента. */
  barcodes?: string[]
  /** Кратность товара на короб (из карточки товара) — для рекомендации числа коробов. */
  items_per_box: number | null
  /** Кратность «коробов на палете» (из карточки товара) — для рекомендации числа палет. */
  boxes_per_pallet: number | null
}

export type PlannableListResponse = {
  items: PlannableItem[]
}

export type PlannableParams = {
  client_id?:  string
  search?:     string
  cargo_type?: 'good' | 'good_unpacked' | 'defect'
  limit?:      number
}

export type BalanceSummary = {
  storage_good: number
  storage_defect: number
  packing_good: number
  packing_defect: number
  packed_good: number
  packed_defect: number
  /** Собран в короб (задача размещения): на столе, к отгрузке НЕ доступен. */
  boxed_good: number
  ready_good: number
  ready_defect: number
  total: number
}

export type BalanceSummaryParams = {
  client_id?:  string
  search?:     string
  has_defect?: boolean
}

export type BalanceListParams = {
  page?: number
  limit?: number
  client_id?: string
  search?: string
  only_positive?: boolean
  has_defect?: boolean
}

export type BalanceListResponse = {
  items: BalanceItem[]
  total: number
  page: number
  limit: number
}

/**
 * Группа остатков «артикул × клиент»: агрегаты по корзинам + варианты.
 * Варианты отсортированы сервером: цвет, затем размер по sort_order справочника.
 */
export type BalanceGroupItem = {
  product_id: string
  product_name: string
  product_sku: string
  client_id: string | null
  client_name: string | null
  storage_good: number
  storage_defect: number
  packing_good: number
  packing_defect: number
  packed_good: number
  packed_defect: number
  /** Собран в короб (задача размещения): на столе, к отгрузке НЕ доступен. */
  boxed_good: number
  ready_good: number
  ready_defect: number
  total: number
  variants_count: number
  colors_count: number
  sizes_count: number
  items: BalanceItem[]
}

export type BalanceGroupedResponse = {
  items: BalanceGroupItem[]
  /** Число групп — пагинация по группам, не по вариантам. */
  total: number
  page: number
  limit: number
}

export type BalanceZoneItem = {
  location_id:   string | null
  location_name: string | null
  op_status:     InvOpStatus
  quality:       InvQuality
  product_id:    string
  product_name:  string
  product_sku:   string
  client_id:     string | null
  client_name:   string | null
  color_id:      string | null
  color_name:    string | null
  size_id:       string | null
  size_name:     string | null
  qty:           number
}

export type BalanceZonesParams = {
  client_id?:     string
  search?:        string
  location?:      string
  op_status?:     InvOpStatus
  quality?:       InvQuality
  page?:          number
  limit?:         number
  only_positive?: boolean
}

export type BalanceZonesResponse = {
  items: BalanceZoneItem[]
  /** Выборка обрезана серверным лимитом — список неполный (режим без пагинации). */
  truncated: boolean
  /** Число местоположений (страница = total/limit), заполняется при limit. */
  total: number
  page: number
  limit: number
}

// --- API functions ---

export function getBalances(params: BalanceListParams = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.page) sp.set('page', String(params.page))
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.client_id) sp.set('client_id', params.client_id)
  if (params.search) sp.set('search', params.search)
  if (params.only_positive === false) sp.set('only_positive', 'false')
  if (params.has_defect) sp.set('has_defect', 'true')
  const q = sp.toString()
  return request<BalanceListResponse>(`/balances${q ? `?${q}` : ''}`, { signal })
}

export function getBalancesGrouped(params: BalanceListParams = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.page) sp.set('page', String(params.page))
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.client_id) sp.set('client_id', params.client_id)
  if (params.search) sp.set('search', params.search)
  if (params.only_positive === false) sp.set('only_positive', 'false')
  if (params.has_defect) sp.set('has_defect', 'true')
  const q = sp.toString()
  return request<BalanceGroupedResponse>(`/balances/grouped${q ? `?${q}` : ''}`, { signal })
}

export function getPlannableItems(params: PlannableParams = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.client_id)  sp.set('client_id', params.client_id)
  if (params.search)     sp.set('search', params.search)
  if (params.cargo_type) sp.set('cargo_type', params.cargo_type)
  if (params.limit)      sp.set('limit', String(params.limit))
  const q = sp.toString()
  return request<PlannableListResponse>(`/balances/plannable${q ? `?${q}` : ''}`, { signal })
}

export function getBalancesSummary(params: BalanceSummaryParams = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.client_id) sp.set('client_id', params.client_id)
  if (params.search) sp.set('search', params.search)
  if (params.has_defect) sp.set('has_defect', 'true')
  const q = sp.toString()
  return request<BalanceSummary>(`/balances/summary${q ? `?${q}` : ''}`, { signal })
}

export function getBalancesByZone(params: BalanceZonesParams = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.client_id) sp.set('client_id', params.client_id)
  if (params.search) sp.set('search', params.search)
  if (params.location) sp.set('location', params.location)
  if (params.op_status) sp.set('op_status', params.op_status)
  if (params.quality) sp.set('quality', params.quality)
  if (params.page) sp.set('page', String(params.page))
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.only_positive === false) sp.set('only_positive', 'false')
  const q = sp.toString()
  return request<BalanceZonesResponse>(`/balances/zones${q ? `?${q}` : ''}`, { signal })
}

export type ZoneRelocationPayload = {
  product_id:    string
  product_name:  string | null
  product_sku:   string | null
  color_id:      string | null
  color_name:    string | null
  size_id:       string | null
  size_name:     string | null
  client_id:     string | null
  client_name:   string | null
  /** Статус перемещаемого товара; меняется только место (по умолчанию storage). */
  op?:           InvOpStatus
  quality:       InvQuality
  from_zone_id:  string | null
  to_zone_id:    string | null
  qty:           number
  comment?:      string | null
}

export function createZoneRelocation(payload: ZoneRelocationPayload) {
  return request<{ message: string }>('/balances/relocations', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export type ZoneRelocationBulkItem = {
  product_id:    string
  product_name:  string | null
  product_sku:   string | null
  color_id:      string | null
  color_name:    string | null
  size_id:       string | null
  size_name:     string | null
  client_id:     string | null
  client_name:   string | null
  op:            InvOpStatus
  quality:       InvQuality
  from_zone_id:  string
  qty:           number
}

export type ZoneRelocationBulkPayload = {
  /** Массовая консолидация в одно место; статус и качество позиций сохраняются. */
  to_zone_id: string
  comment?:   string | null
  items:      ZoneRelocationBulkItem[]
}

export function createZoneRelocationsBulk(payload: ZoneRelocationBulkPayload) {
  return request<{ message: string; moved: number }>('/balances/relocations/bulk', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export type WriteOffPayload = {
  product_id:    string
  product_name:  string | null
  product_sku:   string | null
  color_id:      string | null
  color_name:    string | null
  size_id:       string | null
  size_name:     string | null
  client_id:     string | null
  client_name:   string | null
  /** Статус списываемого товара (по умолчанию storage). */
  op?:           InvOpStatus
  zone_id:       string
  quality:       InvQuality
  qty:           number
  reason:        WriteOffReason
  comment?:      string | null
}

export function createWriteOff(payload: WriteOffPayload) {
  return request<{ message: string }>('/balances/write-offs', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export type QualityChangePayload = {
  product_id:    string
  product_name:  string | null
  product_sku:   string | null
  color_id:      string | null
  color_name:    string | null
  size_id:       string | null
  size_name:     string | null
  client_id:     string | null
  client_name:   string | null
  /** Статус товара; вне storage разрешён только перевод good → defect (по умолчанию storage). */
  op?:           InvOpStatus
  zone_id:       string
  from_quality:  InvQuality
  to_quality:    InvQuality
  qty:           number
  comment?:      string | null
}

export function createQualityChange(payload: QualityChangePayload) {
  return request<{ message: string }>('/balances/quality-changes', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export type StockEntryLine = {
  product_id:   string
  product_name: string
  product_sku:  string
  color_id:     string | null
  color_name:   string | null
  size_id:      string | null
  size_name:    string | null
  zone_id:      string
  quality:      InvQuality
  qty:          number
}

export type StockEntryPayload = {
  client_id: string
  comment?:  string | null
  lines:     StockEntryLine[]
}

/** Историческое заведение остатков (то, что лежало до системы) — без документа. */
export function createStockEntry(payload: StockEntryPayload) {
  return request<{ message: string }>('/balances/stock-entry', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export type ZoneRelocationItem = {
  id:               string
  created_at:       string
  created_by_email: string | null
  from_op:          InvOpStatus | 'intake' | 'shipped' | 'written_off'
  to_op:            InvOpStatus | 'intake' | 'shipped' | 'written_off'
  from_quality:     InvQuality
  to_quality:       InvQuality
  product_name:     string | null
  product_sku:      string | null
  color_name:       string | null
  size_name:        string | null
  client_name:      string | null
  from_zone_name:   string | null
  to_zone_name:     string | null
  qty:              number
  reason:           string | null
  comment:          string | null
  /** id оригинала — заполнен у записей-сторно. */
  reverses_id:      string | null
  /** Запись уже откачена (по ней есть сторно). */
  is_reversed:      boolean
}

export type ZoneRelocationListParams = {
  page?:      number
  limit?:     number
  client_id?: string
  search?:    string
}

export type ZoneRelocationListResponse = {
  items: ZoneRelocationItem[]
  total: number
  page:  number
  limit: number
}

export function getZoneRelocations(params: ZoneRelocationListParams = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.page) sp.set('page', String(params.page))
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.client_id) sp.set('client_id', params.client_id)
  if (params.search) sp.set('search', params.search)
  const q = sp.toString()
  return request<ZoneRelocationListResponse>(`/balances/relocations${q ? `?${q}` : ''}`, { signal })
}

/** Откат ошибочного списания: возвращает товар из «Списан» обратно в исходный бакет/место. */
export function undoWriteOff(relocationId: string) {
  return request<{ message: string }>(`/balances/write-offs/${relocationId}/undo`, {
    method: 'POST',
  })
}

// --- Оборот запаса: приход → расход → остаток ---

/** Событие, меняющее общий остаток позиции (внутренние перемещения сюда не входят).
 *  defect_in/defect_out встречаются только в срезе по качеству: общий остаток
 *  переводы годный ↔ брак не меняют, а остаток среза — да. */
export type StockEventKind =
  | 'receipt'
  | 'stock_entry'
  | 'receipt_adjust'
  | 'shipment'
  | 'shipment_return'
  | 'write_off'
  | 'write_off_undo'
  | 'defect_in'
  | 'defect_out'

export const STOCK_EVENT_LABELS: Record<StockEventKind, string> = {
  receipt:         'Поступление',
  stock_entry:     'Заведение остатка',
  receipt_adjust:  'Корректировка приёмки',
  shipment:        'Отгрузка',
  shipment_return: 'Возврат отгрузки',
  write_off:       'Списание',
  write_off_undo:  'Откат списания',
  defect_in:       'Перевод в брак',
  defect_out:      'Возврат в годный',
}

/** Строка оборотной ведомости: closing = opening + receipt + stock_entry + adjustments − shipped − written_off. */
export type TurnoverItem = {
  product_id:   string
  product_name: string | null
  product_sku:  string | null
  client_id:    string | null
  client_name:  string | null
  color_id:     string | null
  color_name:   string | null
  size_id:      string | null
  size_name:    string | null
  opening:      number
  receipt:      number
  stock_entry:  number
  shipped:      number
  written_off:  number
  /** Переводы качества; ненулевые только при фильтре quality. */
  defect_in:    number
  defect_out:   number
  /** Корректировки приёмки со знаком (обычно отрицательные). */
  adjustments:  number
  closing:      number
}

export type TurnoverTotals = {
  opening:     number
  receipt:     number
  stock_entry: number
  shipped:     number
  written_off: number
  defect_in:   number
  defect_out:  number
  adjustments: number
  closing:     number
}

export type TurnoverListResponse = {
  items:      TurnoverItem[]
  totals:     TurnoverTotals
  total:      number
  page:       number
  limit:      number
  date_from:  string | null
  date_to:    string | null
}

export type TurnoverParams = {
  page?:        number
  limit?:       number
  client_id?:   string
  search?:      string
  date_from?:   string
  date_to?:     string
  only_moved?:  boolean
  quality?:     InvQuality
}

export function getStockTurnover(params: TurnoverParams = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.page) sp.set('page', String(params.page))
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.client_id) sp.set('client_id', params.client_id)
  if (params.search) sp.set('search', params.search)
  if (params.date_from) sp.set('date_from', params.date_from)
  if (params.date_to) sp.set('date_to', params.date_to)
  if (params.only_moved) sp.set('only_moved', 'true')
  if (params.quality) sp.set('quality', params.quality)
  const q = sp.toString()
  return request<TurnoverListResponse>(`/balances/turnover${q ? `?${q}` : ''}`, { signal })
}

export type StockHistoryEvent = {
  id:               string
  created_at:       string
  created_by_email: string | null
  kind:             StockEventKind
  quality:          InvQuality
  qty:              number
  /** Знаковое изменение остатка. */
  delta:            number
  /** Остаток позиции после события. */
  balance_after:    number
  zone_name:        string | null
  receipt_id:       string | null
  receipt_number:   string | null
  dispatch_id:      string | null
  dispatch_number:  string | null
  trip_id:          string | null
  trip_number:      string | null
  reason:           string | null
  comment:          string | null
}

export type StockHistoryResponse = {
  product_id:   string
  product_name: string | null
  product_sku:  string | null
  client_id:    string | null
  client_name:  string | null
  color_id:     string | null
  color_name:   string | null
  size_id:      string | null
  size_name:    string | null
  /** Остаток до первого показанного события. */
  opening:      number
  closing:      number
  events:       StockHistoryEvent[]
  total_events: number
  truncated:    boolean
}

export type StockHistoryParams = {
  product_id: string
  client_id?: string | null
  color_id?:  string | null
  size_id?:   string | null
  date_from?: string
  date_to?:   string
  quality?:   InvQuality
}

export function getStockHistory(params: StockHistoryParams, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  sp.set('product_id', params.product_id)
  if (params.client_id) sp.set('client_id', params.client_id)
  if (params.color_id) sp.set('color_id', params.color_id)
  if (params.size_id) sp.set('size_id', params.size_id)
  if (params.date_from) sp.set('date_from', params.date_from)
  if (params.date_to) sp.set('date_to', params.date_to)
  if (params.quality) sp.set('quality', params.quality)
  return request<StockHistoryResponse>(`/balances/turnover/history?${sp.toString()}`, { signal })
}
