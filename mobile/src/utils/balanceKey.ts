/** Стабильный ключ остатка/строки по триплету product + color + size (зеркало веба). */
export function balanceKey(item: { product_id: string; color_id: string | null; size_id: string | null }): string {
  return `${item.product_id}__${item.color_id ?? ''}__${item.size_id ?? ''}`
}
