import { useParams } from 'react-router-dom'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { PageContainer } from '../components/PageContainer'
import { ReceiptForm } from '../components/ReceiptForm'

export function InventoryReceiptEditPage() {
  const { receiptId } = useParams<{ receiptId: string }>()
  return (
    <PageContainer maxWidth={640} cardClassName="product-create-card">
      <Breadcrumbs />
      <ReceiptForm receiptId={receiptId} />
    </PageContainer>
  )
}
