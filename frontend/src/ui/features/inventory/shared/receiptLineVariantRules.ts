import type { InventoryProductLookup } from '../../../../api/domainTypes'

/**
 * Правила вариантов при добавлении строки поступления.
 * В поступлении цвет является частью складского варианта, поэтому обязателен для любой строки.
 */
export function receiptLineColorRequired(_product: InventoryProductLookup | undefined): boolean {
  return true
}

export function receiptLineSizeRequired(product: InventoryProductLookup | undefined): boolean {
  return product?.requires_size ?? false
}

/**
 * Ключ складского варианта строки поступления (товар + цвет + размер).
 * Одинаковый ключ = дубль, который нельзя добавлять второй строкой.
 */
export function receiptLineVariantKey(line: {
  product_id: string
  color_id?: string | null
  size_id?: string | null
}): string {
  return [line.product_id, line.color_id || '', line.size_id || ''].join('|')
}
