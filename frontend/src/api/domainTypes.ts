/** Строка состава документа-кандидата на дубль (для показа в предупреждении). */
export type DuplicateMatchLine = {
  product_sku: string | null
  product_name: string | null
  color_name: string | null
  size_name: string | null
  qty: number
}

/** Найденный сегодняшний документ с тем же составом (потенциальный дубль). */
export type DuplicateMatch = {
  id: string
  doc_number: string
  status: string
  status_label: string
  created_at: string
  created_by_name: string | null
  lines: DuplicateMatchLine[]
}

export type DuplicateCheckResponse = {
  matches: DuplicateMatch[]
}

export type DictionaryItem = {
  id: string
  name: string
  color_hex?: string | null
  rent_monthly_kopecks?: number | null
  is_packing_zone?: boolean
  is_shipping_zone?: boolean
  is_active: boolean
  is_deleted?: boolean
  deleted_at?: string | null
  deleted_by?: string | null
  created_at: string
  created_by: string | null
  updated_at: string | null
  updated_by: string | null
}

export type ClientStoreItem = {
  id: string
  client_id: string
  name: string
  is_active: boolean
  mp_account_id?: string | null
  mp_account_name?: string | null
  mp_marketplace?: string | null
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
  sort_order?: number | null
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
  display_name?: string | null
  role: 'user' | 'manager' | 'admin' | 'client' | 'warehouse_manager' | 'shift_supervisor' | 'warehouse_head' | 'picker'
  created_at: string
  client_id?: string | null
  client_name?: string | null
}

export type AssignableUserRole = 'user' | 'manager' | 'warehouse_manager' | 'shift_supervisor' | 'warehouse_head' | 'picker' | 'client'

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

export type ProductBarcodeFileItem = {
  id: string
  filename: string
  url: string
  mime_type: string | null
}

export type ProductBarcodeItem = {
  id: string
  barcode: string
  source: string | null
  files: ProductBarcodeFileItem[]
}

/** Этикетка из карточки товара для выбора в документах (плоский список).
 * Код принадлежит варианту — цвет/размер нужны для фильтра по строке документа. */
export type ProductFileItem = {
  id: string
  barcode: string
  variant_id: string | null
  color_id: string | null
  size_id: string | null
  color_name: string | null
  size_name: string | null
  filename: string
  url: string
  mime_type: string | null
}

export type ProductVariantItem = {
  id: string
  color_id: string | null
  color_name: string | null
  dimension: ProductVariantDimension
  size_id: string | null
  size_name: string | null
  sku: string
  barcodes: ProductBarcodeItem[]
  images: string[]
  is_active: boolean
  stock: number
  defect_qty: number
  has_receipts?: boolean
}

export type ProductVariantWriteItem = {
  id: string | null
  sku?: string | null
  color_id: string | null
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
  sku_pending?: boolean
  weight_grams: number | null
  items_per_box: number | null
  boxes_per_pallet: number | null
  requires_color: boolean
  requires_size: boolean
  client_id: string | null
  client_name: string | null
  client_locked?: boolean
  variant_count: number
  stock_total: number
  defect_total: number
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

export type ProductImportAction = 'create' | 'append' | 'skip' | 'error'

export type ProductImportRowItem = {
  row_no: number
  sku: string
  name: string
  type_name: string
  color_name: string
  size_name: string
  variant_sku: string
  action: ProductImportAction
  errors: string[]
  warnings: string[]
}

export type ProductImportSummary = {
  rows_total: number
  rows_ok: number
  rows_with_errors: number
  rows_with_warnings: number
  products_new: number
  products_existing: number
  variants_new: number
  variants_skipped: number
  barcodes_new: number
  import_ready: boolean
  can_import_partial: boolean
}

export type ProductImportPreviewResponse = {
  import_id: string
  client_id: string
  client_name: string | null
  file_name: string
  status_label: string
  summary: ProductImportSummary
  rows: ProductImportRowItem[]
}

export type ProductImportCommitResponse = {
  message: string
  summary: ProductImportSummary
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
  search?: string
  name?: string
  sku?: string
  type_id?: string
  client_id?: string
  actuality_id?: string
  sku_pending?: boolean
  sort?: string
}

export type InventoryProductTypeLookup = {
  id: string
  name: string
  requires_color: boolean
  requires_size: boolean
}

export type InventoryProductBarcode = {
  barcode: string
  color_id: string | null
  size_id: string | null
}

export type InventoryProductLookup = {
  id: string
  name: string
  sku: string
  sku_pending?: boolean
  type_id: string
  type_name: string
  supplier_id: string | null
  supplier_name: string | null
  requires_color: boolean
  requires_size: boolean
  barcodes?: InventoryProductBarcode[]
}

