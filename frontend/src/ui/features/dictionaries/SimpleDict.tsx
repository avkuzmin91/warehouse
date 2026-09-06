import { useState, useEffect, useCallback } from 'react'
import {
  fetchSimpleDictionaryPage,
  fetchProductTypesPage,
  getSizes,
  reorderDictionaryItems,
} from '../../../api/adminApi'
import type { DictionaryItem, ProductTypeDictionaryItem, SizeItem } from '../../../api/domainTypes'
import type { DictionaryTypeId } from './types'
import { Icon } from '../../primitives/Icon'
import { Badge } from '../../primitives/Badge'
import { EmptyState } from '../../primitives/EmptyState'
import { useToast } from '../../feedback/Toast'
import { reorderByDrag } from './reorderByDrag'

/** Пути API простых справочников. */
const SIMPLE_DICT_PATHS: Partial<Record<DictionaryTypeId, string>> = {
  sizes: '/sizes',
  'product-types': '/product-types',
  colors: '/colors',
  suppliers: '/suppliers',
  warehouses: '/warehouses',
  'own-warehouses': '/own-warehouses',
  carriers: '/carriers',
  'vehicle-types': '/vehicle-types',
  positions: '/positions',
  reasons: '/defect-reasons',
}

type AnyDictItem = DictionaryItem | ProductTypeDictionaryItem | SizeItem

function isPackingZone(item: AnyDictItem): boolean {
  return 'is_packing_zone' in item && !!item.is_packing_zone
}

function isShippingZone(item: AnyDictItem): boolean {
  return 'is_shipping_zone' in item && !!item.is_shipping_zone
}

interface SimpleDictProps {
  typeId: DictionaryTypeId
  title: string
  refreshKey: number
  onEdit: (item: AnyDictItem) => void
}

function itemRentKopecks(item: AnyDictItem): number | null {
  return 'rent_monthly_kopecks' in item && item.rent_monthly_kopecks != null ? item.rent_monthly_kopecks : null
}

function normalizeColorHex(value: string | null | undefined): string | null {
  const s = String(value ?? '').trim()
  if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(s)) return s
  if (/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(s)) return `#${s}`
  return null
}

function itemColorHex(item: AnyDictItem): string | null {
  return 'color_hex' in item ? normalizeColorHex(item.color_hex) : null
}

export function SimpleDict({ typeId, title, refreshKey, onEdit }: SimpleDictProps) {
  const [items, setItems] = useState<AnyDictItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadedOnce, setLoadedOnce] = useState(false)
  const [search, setSearch] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const toast = useToast()

  // Перетаскивание переставляет значения относительно всего справочника, поэтому
  // при поиске оно недоступно: видна выборка, а не порядок.
  const canReorder = search.trim() === ''

  const load = useCallback(async (q: string) => {
    setLoading(true)
    try {
      if (typeId === 'product-types') {
        const res = await fetchProductTypesPage({ page: 1, limit: 100, name: q || undefined })
        setItems(res.items)
      } else if (typeId === 'sizes') {
        const res = await getSizes({ page: 1, limit: 100, name: q || undefined })
        setItems(res.items)
      } else {
        const path = SIMPLE_DICT_PATHS[typeId]
        if (!path) {
          // Fallback for unknown simple types — should not reach here (those get EmptyState at page level)
          setItems([])
        } else {
          const res = await fetchSimpleDictionaryPage(path, 'name', { page: 1, limit: 100, name: q || undefined })
          setItems(res.items)
        }
      }
      setLoadedOnce(true)
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [typeId])

  useEffect(() => {
    setSearch('')
  }, [typeId])

  useEffect(() => {
    const timer = setTimeout(() => load(search), 250)
    return () => clearTimeout(timer)
  }, [search, load, refreshKey])

  const dropOn = async (targetId: string) => {
    const sourceId = dragId
    setDragId(null)
    setOverId(null)
    if (!sourceId || sourceId === targetId) return
    const next = reorderByDrag(items, sourceId, targetId)
    if (next === items) return
    setItems(next)
    const path = SIMPLE_DICT_PATHS[typeId]
    if (!path) return
    try {
      await reorderDictionaryItems(path, next.map((i) => i.id))
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось сохранить порядок', 'error')
    } finally {
      await load(search)
    }
  }

  const dragIndex = dragId ? items.findIndex((i) => i.id === dragId) : -1
  const overIndex = overId ? items.findIndex((i) => i.id === overId) : -1

  const dropClass = (id: string) => {
    if (!dragId || dragId === id || overId !== id || dragIndex < 0 || overIndex < 0) return ''
    return dragIndex > overIndex ? 'dict-row-drop-before' : 'dict-row-drop-after'
  }

  return (
    <div className="t-wrap">
      <div className="card-head">
        <div className="card-head-title">{title}</div>
        <div className="right row gap-8">
          {loading && loadedOnce && <span className="text-xs subtle">Обновление...</span>}
          <div className="topbar-search" style={{ minWidth: 220, height: 26 }}>
            <Icon name="search" size={12} />
            <input
              style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 13, flex: 1 }}
              placeholder="Поиск…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>
      <table className="t">
        <thead>
          <tr>
            <th>{title}</th>
            <th style={{ width: 110 }} title="Перетащите строку за ручку — номер проставится сам.">Порядок</th>
            <th style={{ width: 110 }}>Статус</th>
          </tr>
        </thead>
        <tbody>
          {loading && !loadedOnce ? (
            <tr><td colSpan={3} style={{ textAlign: 'center', padding: 24 }}>
              <span className="text-sm muted">Загрузка…</span>
            </td></tr>
          ) : items.length === 0 ? (
            <tr><td colSpan={3} style={{ padding: 32 }}>
              <EmptyState title="Нет записей" sub="Нажмите «Создать запись» чтобы добавить первую" />
            </td></tr>
          ) : (
            items.map((item, index) => (
              <tr
                key={item.id}
                onClick={() => onEdit(item)}
                className={`${dragId === item.id ? 'dict-row-dragging' : ''} ${dropClass(item.id)}`.trim()}
                style={{ cursor: 'pointer' }}
                onDragOver={(e) => {
                  if (!dragId) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  setOverId(item.id)
                }}
                onDrop={(e) => { e.preventDefault(); void dropOn(item.id) }}
              >
                <td style={{ fontWeight: 450 }}>
                  {typeId === 'colors' ? (
                    <div className="row gap-8">
                      <span
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: 5,
                          background: itemColorHex(item) ?? 'var(--c-bg-sunken)',
                          border: '1px solid var(--c-border)',
                          flexShrink: 0,
                        }}
                      />
                      <span>{item.name}</span>
                    </div>
                  ) : item.name}
                  {isPackingZone(item) && (
                    <Badge tone="info" style={{ marginLeft: 8 }}>Зона упаковки</Badge>
                  )}
                  {isShippingZone(item) && (
                    <Badge tone="warning" style={{ marginLeft: 8 }}>Зона отгрузки</Badge>
                  )}
                  {typeId === 'own-warehouses' && itemRentKopecks(item) != null && (
                    <span className="text-xs subtle" style={{ marginLeft: 8 }}>
                      {Math.round(itemRentKopecks(item)! / 100).toLocaleString('ru-RU')} ₽/мес
                    </span>
                  )}
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <div className="dict-order-cell">
                    <span
                      className={`dict-order-grip${canReorder ? '' : ' disabled'}`}
                      draggable={canReorder}
                      title={canReorder ? 'Перетащите, чтобы изменить порядок' : 'Порядок меняется без поиска'}
                      onDragStart={(e) => {
                        // Firefox не начинает перетаскивание без данных в dataTransfer
                        e.dataTransfer.setData('text/plain', item.id)
                        e.dataTransfer.effectAllowed = 'move'
                        setDragId(item.id)
                      }}
                      onDragEnd={() => { setDragId(null); setOverId(null) }}
                    >
                      <Icon name="menu" size={13} />
                    </span>
                    <span className="dict-order-value">{index + 1}</span>
                  </div>
                </td>
                <td>
                  <Badge tone={item.is_active ? 'success' : ''} dot>
                    {item.is_active ? 'Активно' : 'Архив'}
                  </Badge>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
