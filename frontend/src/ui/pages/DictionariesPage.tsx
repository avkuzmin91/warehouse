import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../primitives/Icon'
import { EmptyState } from '../primitives/EmptyState'
import { DICTIONARY_TYPES, type DictionaryTypeId } from './dictionaries/types'
import { useDictionaryRoute } from './dictionaries/useDictionaryRoute'
import { DictionariesSidebar } from './dictionaries/DictionariesSidebar'
import { ProductsDict } from './dictionaries/ProductsDict'
import { SimpleDict } from './dictionaries/SimpleDict'
import { ClientsDict } from './dictionaries/ClientsDict'
import { SimpleDictSheet } from './dictionaries/SimpleDictSheet'
import { ClientSheet } from './dictionaries/ClientSheet'
import type { DictionaryItem, ProductTypeDictionaryItem, SizeItem } from '../../api/domainTypes'

type AnyDictItem = DictionaryItem | ProductTypeDictionaryItem | SizeItem

type SheetState =
  | { type: 'simple'; apiType: 'colors' | 'sizes' | 'product-types' | 'suppliers' | 'warehouses' | 'carriers' | 'reasons'; kind: string; isNew: boolean; initial: AnyDictItem | null }
  | { type: 'client'; isNew: boolean; initial: DictionaryItem | null }
  | null

export function DictionariesPage() {
  const navigate = useNavigate()
  const [active, setActive] = useDictionaryRoute()
  const [sheet, setSheet] = useState<SheetState>(null)
  const [counts, setCounts] = useState<Partial<Record<DictionaryTypeId, number>>>({})
  const [refreshKey, setRefreshKey] = useState(0)

  const dictDef = DICTIONARY_TYPES.find((d) => d.id === active)

  const handleCreate = () => {
    if (active === 'products') {
      navigate('/dictionaries/products/new')
    } else if (active === 'clients') {
      setSheet({ type: 'client', isNew: true, initial: null })
    } else if (active === 'product-types') {
      setSheet({ type: 'simple', apiType: 'product-types', kind: 'Тип товара', isNew: true, initial: null })
    } else if (active === 'sizes') {
      setSheet({ type: 'simple', apiType: 'sizes', kind: 'Размер', isNew: true, initial: null })
    } else if (active === 'colors') {
      setSheet({ type: 'simple', apiType: 'colors', kind: 'Цвет', isNew: true, initial: null })
    } else if (active === 'suppliers') {
      setSheet({ type: 'simple', apiType: 'suppliers', kind: 'Поставщик', isNew: true, initial: null })
    } else if (active === 'warehouses') {
      setSheet({ type: 'simple', apiType: 'warehouses', kind: 'Склад', isNew: true, initial: null })
    } else if (active === 'carriers') {
      setSheet({ type: 'simple', apiType: 'carriers', kind: 'Перевозчик', isNew: true, initial: null })
    } else if (active === 'reasons') {
      setSheet({ type: 'simple', apiType: 'reasons', kind: 'Причина брака', isNew: true, initial: null })
    }
  }

  const openSimpleEdit = (item: AnyDictItem) => {
    const apiType =
      active === 'product-types' ? 'product-types' :
      active === 'sizes' ? 'sizes' :
      active === 'suppliers' ? 'suppliers' :
      active === 'warehouses' ? 'warehouses' :
      active === 'carriers' ? 'carriers' :
      active === 'reasons' ? 'reasons' :
      'colors'
    const kind = dictDef?.sheetKind ?? 'Значение'
    setSheet({ type: 'simple', apiType, kind, isNew: false, initial: item })
  }

  const openClientEdit = (item: DictionaryItem) => {
    setSheet({ type: 'client', isNew: false, initial: item })
  }

  const handleTotalLoaded = useCallback((id: DictionaryTypeId) => (total: number) => {
    setCounts((prev) => prev[id] === total ? prev : { ...prev, [id]: total })
  }, [])

  const handleSaved = () => setRefreshKey((k) => k + 1)

  const renderContent = () => {
    if (active === 'products') {
      return <ProductsDict key={`products-${refreshKey}`} onTotalLoaded={handleTotalLoaded('products')} />
    }
    if (active === 'clients') {
      return <ClientsDict key={`clients-${refreshKey}`} onEdit={openClientEdit} onTotalLoaded={handleTotalLoaded('clients')} />
    }
    if (active === 'product-types' || active === 'sizes' || active === 'colors' || active === 'suppliers' || active === 'warehouses' || active === 'carriers' || active === 'reasons') {
      return (
        <SimpleDict
          key={`${active}-${refreshKey}`}
          typeId={active}
          title={dictDef?.sheetKind ?? 'Значение'}
          onEdit={openSimpleEdit}
          onTotalLoaded={handleTotalLoaded(active)}
        />
      )
    }
    // warehouses, reasons, carriers — no API endpoint yet
    return (
      <div style={{ padding: 40 }}>
        <EmptyState
          title="Данные появятся при подключении API"
          sub={`Справочник «${dictDef?.name ?? active}» ещё не подключён`}
        />
        {/* TODO: подключить API для {active} */}
      </div>
    )
  }

  const createLabel =
    active === 'products' ? 'Новый товар' :
    active === 'clients' ? 'Новый клиент' :
    dictDef?.kind === 'empty' ? undefined :
    'Создать запись'

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Справочники</div>
          <div className="page-subtitle">Базовые сущности системы и правила их создания</div>
        </div>
        <div className="row gap-8">
          <button className="btn">
            <Icon name="upload" size={14} />Импорт
          </button>
          {createLabel && (
            <button className="btn primary" onClick={handleCreate}>
              <Icon name="plus" size={14} />
              {createLabel}
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 20, alignItems: 'start' }}>
        <DictionariesSidebar
          active={active}
          onSelect={setActive}
          counts={counts}
        />
        <div>{renderContent()}</div>
      </div>

      {sheet?.type === 'simple' && (
        <SimpleDictSheet
          open
          onClose={() => setSheet(null)}
          onSaved={handleSaved}
          isNew={sheet.isNew}
          kind={sheet.kind}
          apiType={sheet.apiType}
          initial={sheet.initial}
        />
      )}
      {sheet?.type === 'client' && (
        <ClientSheet
          open
          onClose={() => setSheet(null)}
          onSaved={handleSaved}
          isNew={sheet.isNew}
          initial={sheet.initial}
        />
      )}
    </div>
  )
}
