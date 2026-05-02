import { Navigate, useParams } from 'react-router-dom'
import { PageContainer } from '../components/PageContainer'
import { ProductsDictionaryListBlock } from './ProductsDictionaryListBlock'

/** Список товаров справочника: только `/dictionaries/products`. */
export function DictionariesPage() {
  const { section } = useParams<{ section: string }>()
  if (section !== 'products') {
    return <Navigate to="/dictionaries" replace />
  }
  return (
    <PageContainer maxWidth={1200} cardClassName="users-card product-dict-card">
      <ProductsDictionaryListBlock />
    </PageContainer>
  )
}
