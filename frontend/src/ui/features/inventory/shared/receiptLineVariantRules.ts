import type { InventoryProductLookup } from '../../../../api/domainTypes'

/**
 * Правила вариантов при добавлении строки поступления.
 * requires_color типа товара относится к карточке товара в справочнике,
 * а не к документу поступления — цвет строки всегда опционален.
 */
export function receiptLineColorRequired(_product: InventoryProductLookup | undefined): boolean {
  return false
}

export function receiptLineSizeRequired(product: InventoryProductLookup | undefined): boolean {
  return product?.requires_size ?? false
}
