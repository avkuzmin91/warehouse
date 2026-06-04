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
