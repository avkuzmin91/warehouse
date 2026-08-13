import { useEffect, useState } from 'react'
import { lookupProductByBarcode } from '../../../api/adminApi'
import type { BarcodeOwnerMatch } from '../../../api/adminApi'

/**
 * Проверка вводимого штрих-кода на дубль по мере ввода (debounce), чтобы владелец
 * кода был виден под полем до отправки формы, а не 409-ошибкой после неё.
 * Пустая/короткая строка — проверка не выполняется, owner = null.
 */
export function useBarcodeDupCheck(code: string): { owner: BarcodeOwnerMatch | null } {
  const [owner, setOwner] = useState<BarcodeOwnerMatch | null>(null)

  useEffect(() => {
    const trimmed = code.trim()
    setOwner(null)
    if (trimmed.length < 4) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      lookupProductByBarcode(trimmed, controller.signal)
        .then((res) => setOwner(res.found ? res.match : null))
        .catch(() => setOwner(null))
    }, 400)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [code])

  return { owner }
}

export function barcodeOwnerLabel(owner: BarcodeOwnerMatch): string {
  const variant = [owner.color_name, owner.size_name].filter(Boolean).join(' / ')
  return `«${owner.product_name}»${variant ? ` (${variant})` : ''}${owner.client_name ? ` · ${owner.client_name}` : ''}`
}
