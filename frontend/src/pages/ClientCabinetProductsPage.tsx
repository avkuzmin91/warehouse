import { ProductsDictionaryListBlock } from './ProductsDictionaryListBlock'

/** Список товаров ЛК: тот же UI, что справочник товаров; данные только через /client-portal/products. */
export function ClientCabinetProductsPage() {
  return <ProductsDictionaryListBlock variant="client_cabinet" />
}
