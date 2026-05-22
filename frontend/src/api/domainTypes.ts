export type DictionaryItem = {
  id: string
  name: string
  is_active: boolean
  is_deleted?: boolean
  deleted_at?: string | null
  deleted_by?: string | null
  created_at: string
  created_by: string | null
  updated_at: string | null
  updated_by: string | null
}

export type ProductTypeDictionaryItem = DictionaryItem & {
  requires_color: boolean
  requires_size: boolean
}

export type SizeItem = {
  id: string
  name: string
  is_active: boolean
  is_deleted?: boolean
  deleted_at?: string | null
  deleted_by?: string | null
  created_at: string
  created_by: string | null
  updated_at: string | null
  updated_by: string | null
}

export type UserListItem = {
  id: string
  email: string
  role: 'user' | 'manager' | 'admin' | 'client' | 'warehouse_manager'
  created_at: string
  client_id?: string | null
  client_name?: string | null
}

export type AssignableUserRole = 'user' | 'manager' | 'client'

export type RecordActualityFilterItem = {
  id: string
  name: string
}

export type InventoryOpType = 'in' | 'out'

export type ProductVariantDimension = {
  length: number
  width: number
  height: number
}

export type ProductVariantItem = {
  id: string
  color_id: string
  dimension: ProductVariantDimension
  size_id: string | null
  sku: string
  images: string[]
  is_active: boolean
}

export type ProductVariantWriteItem = {
  id: string | null
  sku?: string | null
  color_id: string
  dimension: ProductVariantDimension
  size_id: string | null
  images: string[]
  is_active: boolean
}

export type ProductItem = {
  id: string
  name: string
  type_id: string
  type_name: string | null
  sku_base: string
  requires_color: boolean
  requires_size: boolean
  client_id: string | null
  client_name: string | null
  variant_count: number
  is_active: boolean
  is_deleted?: boolean
  deleted_at?: string | null
  deleted_by?: string | null
  created_at: string
  created_by: string | null
  updated_at: string | null
  updated_by: string | null
  image_urls?: string[]
}

export type SizeListResponse = {
  items: SizeItem[]
  total: number
  page: number
  limit: number
}

export type ProductListResponse = {
  items: ProductItem[]
  total: number
  page: number
  limit: number
}

export type DictionaryListResponse = {
  items: DictionaryItem[]
  total: number
  page: number
  limit: number
}

export type ProductTypeListResponse = {
  items: ProductTypeDictionaryItem[]
  total: number
  page: number
  limit: number
}

export type DictionaryListQueryParams = {
  page?: number
  limit?: number
  search?: string
  actuality_id?: string
  sort?: string
  date_from?: string
  date_to?: string
}

export type SizeListQueryParams = {
  page?: number
  limit?: number
  name?: string
  actuality_id?: string
  sort?: string
}

export type SimpleDictionaryListParams = {
  page?: number
  limit?: number
  name?: string
  search?: string
  actuality_id?: string
  sort?: string
  date_from?: string
  date_to?: string
}

export type ProductListQueryParams = {
  page?: number
  limit?: number
  name?: string
  sku?: string
  type_id?: string
  client_id?: string
  actuality_id?: string
  sort?: string
}

export type InventoryProductTypeLookup = {
  id: string
  name: string
  requires_color: boolean
  requires_size: boolean
}

export type InventoryProductLookup = {
  id: string
  name: string
  sku: string
  type_id: string
  type_name: string
  supplier_id: string | null
  supplier_name: string | null
  requires_color: boolean
  requires_size: boolean
}

export type ReceiptStatus =
  | 'pending'
  | 'accepted'
  | 'awaiting_inspection'
  | 'partially_inspected'
  | 'inspected'

export type InventoryOperationItem = {
  id: string
  op_type: InventoryOpType
  client_id: string | null
  client_name: string | null
  product_id: string
  product_name: string
  product_type_id: string | null
  product_type_name: string | null
  supplier_id: string | null
  supplier_name: string | null
  color_id: string | null
  color_name: string | null
  size_id: string | null
  size_name: string | null
  variant_sku?: string | null
  product_sku?: string | null
  preview_image_url?: string | null
  receipt_status?: ReceiptStatus | null
  shipment_status?: 'pending' | 'shipped' | null
  shipment_type?: 'standard' | 'defect' | null
  quantity: number
  note: string | null
  created_at: string
  created_by: string | null
}

export type InventoryOperationListResponse = {
  items: InventoryOperationItem[]
  total: number
  page: number
  limit: number
}

export type InventoryBalanceItem = {
  product_id: string
  product_name: string
  product_sku: string
  preview_image_url?: string | null
  product_type_id: string | null
  product_type_name: string | null
  client_id: string | null
  client_name: string | null
  supplier_id: string | null
  supplier_name: string | null
  color_id: string | null
  color_name: string | null
  size_id: string | null
  size_name: string | null
  quantity: number
  good_qty: number
  defect_qty: number
  uninspected_qty: number
}

export type InventoryBalanceListResponse = {
  items: InventoryBalanceItem[]
  total: number
  page: number
  limit: number
}

export type AnalyticsGroup = 'day' | 'week' | 'month'

export type AnalyticsPeriod = { date_from: string; date_to: string }
export type AnalyticsFilters = {
  client_ids: string[]
  product_id: string | null
  type_id: string | null
}

export type MovementBucket = { period: string; inflow: number; outflow: number }
export type MovementReport = {
  report: 'movement'
  chart: 'line'
  explanation: string
  group: AnalyticsGroup
  period: AnalyticsPeriod
  filters: AnalyticsFilters
  data: MovementBucket[]
}

export type StockSnapshotItem = {
  product_id: string
  product: string
  type_id: string | null
  type_name: string | null
  client_id: string | null
  client: string | null
  color_id: string | null
  color: string | null
  size_id: string | null
  size: string | null
  stock: number
}
export type StockSnapshotReport = {
  report: 'stock_snapshot'
  chart: 'table'
  explanation: string
  at_date: string
  filters: AnalyticsFilters
  data: StockSnapshotItem[]
}

export type TopProductItem = {
  product_id: string
  product: string
  type_name: string | null
  total_outflow: number
}
export type TopProductsReport = {
  report: 'top_products'
  chart: 'bar'
  explanation: string
  period: AnalyticsPeriod
  filters: AnalyticsFilters
  limit: number
  data: TopProductItem[]
}

export type DeadStockItem = {
  product_id: string
  product: string
  client_id: string | null
  client: string | null
  color_id: string | null
  color: string | null
  size_id: string | null
  size: string | null
  stock: number
  last_movement_at: string | null
  days_without_movement: number
}
export type DeadStockReport = {
  report: 'dead_stock'
  chart: 'table'
  explanation: string
  days_threshold: number
  filters: AnalyticsFilters
  data: DeadStockItem[]
}

export type ClientActivityItem = {
  client_id: string
  client: string
  total_outflow: number
  operations: number
}
export type ClientActivityReport = {
  report: 'client_activity'
  chart: 'bar'
  explanation: string
  period: AnalyticsPeriod
  filters: AnalyticsFilters
  data: ClientActivityItem[]
}

export type BalanceReport = {
  report: 'balance'
  chart: 'bar'
  explanation: string
  period: AnalyticsPeriod
  filters: AnalyticsFilters
  inflow: number
  outflow: number
  delta: number
  prev_inflow: number
  prev_outflow: number
  prev_delta: number
  inflow_change_pct: number | null
  outflow_change_pct: number | null
  delta_trend: 'up' | 'down' | 'flat'
}

export type ByTypeItem = {
  type_id: string | null
  type_name: string
  stock: number
  outflow: number
  inflow: number
}
export type ByTypeReport = {
  report: 'by_type'
  chart: 'bar'
  explanation: string
  period: AnalyticsPeriod
  filters: AnalyticsFilters
  data: ByTypeItem[]
}

export type AdminDashboardStockByClient = {
  client_id: string
  client: string
  stock: number
}

export type AdminDashboardClientMovement = {
  client_id: string
  client: string
  inflow: number
  outflow: number
}

export type AdminDashboardReport = {
  report: 'admin_dashboard'
  period: AnalyticsPeriod
  filters: AnalyticsFilters
  at_date: string
  total_inflow: number
  total_outflow: number
  stock_total: number
  active_clients: number
  movement_clients_limit: number
  stock_by_client: AdminDashboardStockByClient[]
  client_movement: AdminDashboardClientMovement[]
  explanation: string
}

export type AnalyticsCommonParams = {
  date_from?: string
  date_to?: string
  client_ids?: string[]
  client_id?: string
  product_id?: string
  type_id?: string
}

export type MovementImportPreviewErrorItem = { row: number; error: string }
export type MovementImportPreviewWarningItem = { row: number; warning: string }
export type MovementImportPreviewRowResult = {
  excel_row: number
  date: string
  barcode: string
  color: string
  size?: string | null
  quantity: number | null
  status_display: string
  found_product_name?: string | null
  errors: string[]
  warnings: string[]
}
export type MovementImportPreviewRow = {
  excel_row: number
  date: string
  name: string
  barcode: string
  color: string
  size?: string | null
  quantity: number
  status: string
  receipt_status?: string | null
  shipment_status?: string | null
  comment?: string | null
  product_name: string
  client_name?: string | null
  preview_image_url?: string | null
  warnings: string[]
}

export type MovementImportPreviewResponse = {
  summary_total: number
  summary_ok: number
  summary_with_errors: number
  import_ready: boolean
  file_status_label: string
  row_results: MovementImportPreviewRowResult[]
  valid_rows: MovementImportPreviewRow[]
  errors: MovementImportPreviewErrorItem[]
  warnings: MovementImportPreviewWarningItem[]
}

export type MovementImportCommitResponse = {
  total: number
  success: number
  failed: number
  warnings: number
}

export type ImportExcelUploadResponse = {
  file_id: string
  file_name: string
  file_size: number
}
