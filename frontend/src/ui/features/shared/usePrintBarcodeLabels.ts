import { useMemo, useState } from 'react'
import { getBarcodeLabels } from '../../../api/adminApi'
import type { BarcodeLabelItem, BarcodeLabelMissingItem, BarcodeLabelRequestItem } from '../../../api/domainTypes'
import { useApi } from '../../../hooks/useApi'
import { openBarcodeLabelSheet, POPUP_BLOCKED_HINT } from '../../../utils/qrLabelSheet'
import { useToast } from '../../feedback/Toast'

/** Ключ варианта в составе документа: строки знают товар и цвето-размер, не variant_id. */
export function variantLabelKey(item: { product_id: string; color_id?: string | null; size_id?: string | null }): string {
  return `${item.product_id}|${item.color_id ?? ''}|${item.size_id ?? ''}`
}

/** Чем маркируют строку, когда файла в ней нет.
 *
 * `choose` — кандидаты из разных кабинетов: печатать любой нельзя, чужой код площадка
 * не примет. Однородные кандидаты печатаются по умолчанию (`count > 1`), код можно
 * сменить, но работа из-за этого не встаёт. */
export type LineLabelState =
  | { kind: 'loading' }
  | { kind: 'code'; barcode: string; barcodeSvg: string; modules: number; count: number; chosen: boolean }
  | { kind: 'choose'; count: number }
  | { kind: 'missing'; reason: string }

const CHUNK = 200

/** Печать этикеток ШК: цифры кода живут в карточке товара, картинка рисуется
 * backend'ом на каждый запрос и не хранится. Точки входа — справочник товаров,
 * приёмка рейса и задача упаковки. */
export function usePrintBarcodeLabels() {
  const toast = useToast()
  const [printing, setPrinting] = useState(false)

  async function printLabels(items: BarcodeLabelRequestItem[]) {
    if (printing || items.length === 0) return
    setPrinting(true)
    try {
      const res = await getBarcodeLabels(items)
      if (res.items.length === 0) {
        toast(`Печатать нечего: ${res.missing.map((m) => `${m.label} — ${m.reason}`).join('; ')}`, 'error')
        return
      }
      const opened = openBarcodeLabelSheet(res.items.map((l) => ({
        barcode: l.barcode,
        barcode_svg: l.barcode_svg,
        modules: l.modules,
        title: l.product_name,
        sub: [l.color_name, l.size_name].filter(Boolean).join(' / ') || undefined,
        qty: l.qty,
      })))
      if (!opened) {
        toast(POPUP_BLOCKED_HINT, 'error')
        return
      }
      if (res.missing.length > 0) {
        toast(`Без штрих-кода, не напечатано: ${res.missing.map((m) => m.label).join(', ')}`, 'info')
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось напечатать этикетки', 'error')
    } finally {
      setPrinting(false)
    }
  }

  return { printLabels, printing }
}

/** Состояние этикетки по каждой строке состава — одним запросом на весь документ.
 *
 * Строка показывает, чем её будут маркировать, до всякого клика: поле «прикрепите
 * файл» читалось как «класть нечего», хотя код в карточке есть почти всегда. */
export function useLineBarcodeLabels(keys: BarcodeLabelRequestItem[]) {
  const signature = keys
    .map((k) => `${variantLabelKey(k)}|${k.store_id ?? ''}|${k.barcode ?? ''}`)
    .sort()
    .join(',')
  const { data, loading } = useApi(
    async (signal) => {
      const unique = new Map<string, BarcodeLabelRequestItem>()
      for (const k of keys) unique.set(variantLabelKey(k), { ...k, qty: 1 })
      if (unique.size === 0) return { items: [], missing: [] }
      const chunks: BarcodeLabelRequestItem[][] = []
      for (let i = 0; i < unique.size; i += CHUNK) chunks.push([...unique.values()].slice(i, i + CHUNK))
      const pages = await Promise.all(chunks.map((items) => getBarcodeLabels(items, { signal })))
      return {
        items: pages.flatMap((p) => p.items),
        missing: pages.flatMap((p) => p.missing),
      }
    },
    [signature],
  )

  return useMemo(() => {
    const byKey = new Map<string, BarcodeLabelItem>()
    for (const item of data?.items ?? []) byKey.set(variantLabelKey(item), item)
    const missingByKey = new Map<string, BarcodeLabelMissingItem>()
    for (const item of data?.missing ?? []) missingByKey.set(variantLabelKey(item), item)

    return (key: BarcodeLabelRequestItem): LineLabelState => {
      const found = byKey.get(variantLabelKey(key))
      if (found) {
        if (found.mixed_origin && !found.chosen && found.barcode_count > 1) {
          return { kind: 'choose', count: found.barcode_count }
        }
        return {
          kind: 'code',
          barcode: found.barcode,
          barcodeSvg: found.barcode_svg,
          modules: found.modules,
          count: found.barcode_count,
          chosen: found.chosen,
        }
      }
      const gone = missingByKey.get(variantLabelKey(key))
      if (gone) return { kind: 'missing', reason: gone.reason }
      // Пока грузим — «нет ШК» показывать нельзя: это пугающее состояние, и мигать им
      // на каждом открытии документа хуже, чем короткий скелет.
      return loading || !data ? { kind: 'loading' } : { kind: 'missing', reason: 'У варианта нет штрих-кода' }
    }
  }, [data, loading])
}
