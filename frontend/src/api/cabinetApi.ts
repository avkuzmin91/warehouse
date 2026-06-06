import { request } from './http'
import type { ProductItem, ProductListResponse, ProductVariantItem } from './domainTypes'
import type { BalanceListResponse } from './balancesApi'

export type CabinetBalanceListParams = {
  page?: number
  limit?: number
  search?: string
  only_positive?: boolean
  has_defect?: boolean
}

export type CabinetProductListParams = {
  page?: number
  limit?: number
  search?: string
  sort?: string
}

export function getCabinetBalances(params: CabinetBalanceListParams = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.page) sp.set('page', String(params.page))
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.search) sp.set('search', params.search)
  if (params.only_positive === false) sp.set('only_positive', 'false')
  if (params.has_defect) sp.set('has_defect', 'true')
  const q = sp.toString()
  return request<BalanceListResponse>(`/cabinet/balances${q ? `?${q}` : ''}`, { signal })
}

export function getCabinetProducts(params: CabinetProductListParams = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.page) sp.set('page', String(params.page))
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.search) sp.set('search', params.search)
  if (params.sort) sp.set('sort', params.sort)
  const q = sp.toString()
  return request<ProductListResponse>(`/cabinet/products${q ? `?${q}` : ''}`, { signal })
}

export function getCabinetProduct(productId: string, signal?: AbortSignal) {
  return request<ProductItem>(`/cabinet/products/${productId}`, { signal })
}

export function getCabinetProductVariants(productId: string, signal?: AbortSignal) {
  return request<ProductVariantItem[]>(`/cabinet/products/${productId}/variants`, { signal })
}
