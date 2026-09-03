import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../../primitives/Icon'
import { EmptyState } from '../../primitives/EmptyState'
import { DICTIONARY_TYPES, type DictionaryTypeId } from './types'
import { useDictionaryRoute } from './useDictionaryRoute'
import { DictionariesSidebar } from './DictionariesSidebar'
import { ProductsDict } from './ProductsDict'
import { SimpleDict } from './SimpleDict'
import { ClientsDict } from './ClientsDict'
import { LocationsDict } from './LocationsDict'
import { SimpleDictSheet } from './SimpleDictSheet'
import { ClientSheet } from './ClientSheet'
import { PackingPricesFeature } from '../finance/pricing/PackingPricesFeature'
import { PalletPricesFeature } from '../finance/pricing/PalletPricesFeature'
import { BoxPricesFeature } from '../finance/pricing/BoxPricesFeature'
import { StoragePricesFeature } from '../finance/pricing/StoragePricesFeature'
import type { DictionaryItem, ProductTypeDictionaryItem, SizeItem } from '../../../api/domainTypes'
import { useCurrentUser } from '../../../hooks/useCurrentUser'
import { canManageOwnWarehouses, canViewCosts } from '../../../utils/access'

type AnyDictItem = DictionaryItem | ProductTypeDictionaryItem | SizeItem
type SimpleDictionaryTypeId = Extract<DictionaryTypeId, 'product-types' | 'sizes' | 'colors' | 'suppliers' | 'warehouses' | 'own-warehouses' | 'carriers' | 'vehicle-types' | 'positions' | 'reasons'>

type SheetState =
  | { type: 'simple'; apiType: 'colors' | 'sizes' | 'product-types' | 'suppliers' | 'warehouses' | 'own-warehouses' | 'carriers' | 'vehicle-types' | 'positions' | 'reasons'; kind: string; isNew: boolean; initial: AnyDictItem | null }
  | { type: 'client'; isNew: boolean; initial: DictionaryItem | null }
  | null

function isSimpleDictionaryType(id: DictionaryTypeId): id is SimpleDictionaryTypeId {
  return id === 'product-types'
    || id === 'sizes'
    || id === 'colors'
    || id === 'suppliers'
    || id === 'warehouses'
    || id === 'own-warehouses'
    || id === 'carriers'
    || id === 'vehicle-types'
    || id === 'positions'
    || id === 'reasons'
}

export function DictionariesFeature() {
  const navigate = useNavigate()
  const { user } = useCurrentUser()
  const isAdmin = canManageOwnWarehouses(user)
  const hasFinanceAccess = canViewCosts(user)
  const [active, setActive] = useDictionaryRoute()
  const [sheet, setSheet] = useState<SheetState>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [visitedPanels, setVisitedPanels] = useState({
    products: active === 'products',
    clients: true,
    simple: true,
  })

  const dictDef = DICTIONARY_TYPES.find((d) => d.id === active)

  useEffect(() => {
    setVisitedPanels((prev) => ({
      products: prev.products || active === 'products',
      clients: true,
      simple: true,
    }))
  }, [active])

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
      setSheet({ type: 'simple', apiType: 'warehouses', kind: 'Точка логистики', isNew: true, initial: null })
    } else if (active === 'own-warehouses') {
      setSheet({ type: 'simple', apiType: 'own-warehouses', kind: 'Склад', isNew: true, initial: null })
    } else if (active === 'carriers') {
      setSheet({ type: 'simple', apiType: 'carriers', kind: 'Перевозчик', isNew: true, initial: null })
    } else if (active === 'vehicle-types') {
      setSheet({ type: 'simple', apiType: 'vehicle-types', kind: 'Тип кузова', isNew: true, initial: null })
    } else if (active === 'positions') {
      setSheet({ type: 'simple', apiType: 'positions', kind: 'Должность', isNew: true, initial: null })
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
      active === 'own-warehouses' ? 'own-warehouses' :
      active === 'carriers' ? 'carriers' :
      active === 'vehicle-types' ? 'vehicle-types' :
      active === 'positions' ? 'positions' :
      active === 'reasons' ? 'reasons' :
      'colors'
    const kind = dictDef?.sheetKind ?? 'Значение'
    setSheet({ type: 'simple', apiType, kind, isNew: false, initial: item })
  }

  const openClientEdit = (item: DictionaryItem) => {
    setSheet({ type: 'client', isNew: false, initial: item })
  }

  const handleSaved = () => setRefreshKey((k) => k + 1)

  const activeForbidden =
    (!!dictDef?.adminOnly && !isAdmin) || (!!dictDef?.financeOnly && !hasFinanceAccess)

  const createLabel =
    activeForbidden ? undefined :
    active === 'products' ? 'Новый товар' :
    active === 'clients' ? 'Новый клиент' :
    active === 'locations' ? undefined : // у панели «Места хранения» собственные действия
    dictDef?.group === 'pricing' ? undefined : // тарифы заводятся из строки, шторкой
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
          {active === 'products' && !activeForbidden && (
            <button className="btn" onClick={() => navigate('/dictionaries/products/import')}>
              <Icon name="upload" size={14} />Импорт из Excel
            </button>
          )}
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
          isAdmin={isAdmin}
          hasFinanceAccess={hasFinanceAccess}
        />
        <div>
          {visitedPanels.products && (
            <div style={{ display: active === 'products' ? 'block' : 'none' }}>
              <ProductsDict refreshKey={refreshKey} visible={active === 'products'} />
            </div>
          )}

          {visitedPanels.clients && (
            <div style={{ display: active === 'clients' ? 'block' : 'none' }}>
              <ClientsDict refreshKey={refreshKey} onEdit={openClientEdit} />
            </div>
          )}

          {activeForbidden && (
            <div style={{ padding: 40 }}>
              <EmptyState
                title="Недостаточно прав"
                sub={dictDef?.financeOnly
                  ? 'Этот справочник доступен только менеджеру и администратору'
                  : 'Этот справочник доступен только администратору'}
              />
            </div>
          )}

          {active === 'locations' && (
            <LocationsDict refreshKey={refreshKey} />
          )}

          {!activeForbidden && dictDef?.group === 'pricing' && (
            <div className="dict-embed">
              {active === 'packing-pricing' && <PackingPricesFeature />}
              {active === 'pallet-pricing' && <PalletPricesFeature />}
              {active === 'box-pricing' && <BoxPricesFeature />}
              {active === 'storage-pricing' && <StoragePricesFeature />}
            </div>
          )}

          {!activeForbidden && visitedPanels.simple && (
            (DICTIONARY_TYPES
              .filter((d): d is typeof d & { id: SimpleDictionaryTypeId } => isSimpleDictionaryType(d.id) && (!d.adminOnly || isAdmin))
              .map((d) => d.id) as SimpleDictionaryTypeId[]).map((typeId) => (
              <div key={typeId} style={{ display: active === typeId ? 'block' : 'none' }}>
                <SimpleDict
                  typeId={typeId}
                  refreshKey={refreshKey}
                  title={DICTIONARY_TYPES.find((d) => d.id === typeId)?.sheetKind ?? 'Значение'}
                  onEdit={openSimpleEdit}
                />
              </div>
            ))
          )}

          {!isSimpleDictionaryType(active) && active !== 'products' && active !== 'clients' && active !== 'locations' && dictDef?.group !== 'pricing' && (
            <div style={{ padding: 40 }}>
              <EmptyState
                title="Данные появятся при подключении API"
                sub={`Справочник «${dictDef?.name ?? active}» ещё не подключён`}
              />
            </div>
          )}
        </div>
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
