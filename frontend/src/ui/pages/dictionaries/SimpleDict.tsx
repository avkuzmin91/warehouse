import { useState, useEffect, useCallback } from 'react'
import {
  fetchSimpleDictionaryPage,
  fetchProductTypesPage,
  getSizes,
} from '../../../api/adminApi'
import type { DictionaryItem, ProductTypeDictionaryItem, SizeItem } from '../../../api/domainTypes'
import type { DictionaryTypeId } from './types'
import { Icon } from '../../primitives/Icon'
import { Badge } from '../../primitives/Badge'
import { Checkbox } from '../../primitives/Checkbox'
import { Avatar, getInitials } from '../../primitives/Avatar'
import { EmptyState } from '../../primitives/EmptyState'

type AnyDictItem = DictionaryItem | ProductTypeDictionaryItem | SizeItem

interface SimpleDictProps {
  typeId: DictionaryTypeId
  title: string
  onEdit: (item: AnyDictItem) => void
  onTotalLoaded: (total: number) => void
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('ru', { day: 'numeric', month: 'short' })
}

export function SimpleDict({ typeId, title, onEdit, onTotalLoaded }: SimpleDictProps) {
  const [items, setItems] = useState<AnyDictItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const load = useCallback(async (q: string) => {
    setLoading(true)
    try {
      if (typeId === 'product-types') {
        const res = await fetchProductTypesPage({ page: 1, limit: 100, name: q || undefined })
        setItems(res.items)
        onTotalLoaded(res.total)
      } else if (typeId === 'sizes') {
        const res = await getSizes({ page: 1, limit: 100, name: q || undefined })
        setItems(res.items)
        onTotalLoaded(res.total)
      } else if (typeId === 'colors') {
        const res = await fetchSimpleDictionaryPage('/colors', 'name', { page: 1, limit: 100, name: q || undefined })
        setItems(res.items)
        onTotalLoaded(res.total)
      } else if (typeId === 'suppliers') {
        const res = await fetchSimpleDictionaryPage('/suppliers', 'name', { page: 1, limit: 100, name: q || undefined })
        setItems(res.items)
        onTotalLoaded(res.total)
      } else if (typeId === 'warehouses') {
        const res = await fetchSimpleDictionaryPage('/warehouses', 'name', { page: 1, limit: 100, name: q || undefined })
        setItems(res.items)
        onTotalLoaded(res.total)
      } else if (typeId === 'carriers') {
        const res = await fetchSimpleDictionaryPage('/carriers', 'name', { page: 1, limit: 100, name: q || undefined })
        setItems(res.items)
        onTotalLoaded(res.total)
      } else if (typeId === 'reasons') {
        const res = await fetchSimpleDictionaryPage('/defect-reasons', 'name', { page: 1, limit: 100, name: q || undefined })
        setItems(res.items)
        onTotalLoaded(res.total)
      } else {
        // Fallback for unknown simple types — should not reach here (those get EmptyState at page level)
        setItems([])
        onTotalLoaded(0)
      }
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [typeId, onTotalLoaded])

  useEffect(() => {
    setSearch('')
    setItems([])
  }, [typeId])

  useEffect(() => {
    const timer = setTimeout(() => load(search), 250)
    return () => clearTimeout(timer)
  }, [search, load])

  return (
    <div className="t-wrap">
      <div className="card-head">
        <div className="card-head-title">{title}</div>
        <div className="right row gap-8">
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
            <th style={{ width: 30 }}>
              {/* TODO: реализовать массовые действия */}
              <Checkbox checked={false} onChange={() => {}} />
            </th>
            <th>{title}</th>
            <th style={{ width: 130 }}>Создано</th>
            <th style={{ width: 150 }}>Кем</th>
            <th style={{ width: 100 }}>Статус</th>
            <th style={{ width: 30 }}></th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24 }}>
              <span className="text-sm muted">Загрузка…</span>
            </td></tr>
          ) : items.length === 0 ? (
            <tr><td colSpan={6} style={{ padding: 32 }}>
              <EmptyState title="Нет записей" sub="Нажмите «Создать запись» чтобы добавить первую" />
            </td></tr>
          ) : (
            items.map((item) => (
              <tr key={item.id} onClick={() => onEdit(item)} style={{ cursor: 'pointer' }}>
                <td onClick={(e) => e.stopPropagation()}>
                  {/* TODO: реализовать массовые действия */}
                  <Checkbox checked={false} onChange={() => {}} />
                </td>
                <td style={{ fontWeight: 450 }}>{item.name}</td>
                <td className="text-sm muted">{formatDate(item.created_at)}</td>
                <td>
                  <div className="row gap-8">
                    {item.created_by
                      ? <><Avatar initials={getInitials(item.created_by)} /><span className="text-sm">{item.created_by}</span></>
                      : <span className="faint text-sm">—</span>}
                  </div>
                </td>
                <td>
                  <Badge tone={item.is_active ? 'success' : ''} dot>
                    {item.is_active ? 'Активно' : 'Архив'}
                  </Badge>
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <button className="btn ghost icon sm"><Icon name="more" size={14} /></button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
