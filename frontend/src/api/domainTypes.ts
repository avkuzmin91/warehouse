export type DictionaryItem = {
  id: string
  name: string
  color_hex?: string | null
  is_packing_zone?: boolean
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
  role: 'user' | 'manager' | 'admin' | 'client' | 'warehouse_manager' | 'shift_supervisor'
  created_at: string
  client_id?: string | null
  client_name?: string | null
}

export type AssignableUserRole = 'user' | 'manager' | 'warehouse_manager' | 'shift_supervisor' | 'client'

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
  color_id: string | null
  color_name: string | null
  dimension: ProductVariantDimension
  size_id: string | null
  size_name: string | null
  sku: string
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
  weight_grams: number | null
  items_per_pallet: number | null
  requires_color: boolean
  requires_size: boolean
  client_id: string | null
  client_name: string | null
  client_locked?: boolean
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
  search?: string
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

