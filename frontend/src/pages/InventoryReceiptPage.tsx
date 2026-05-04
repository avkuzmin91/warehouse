import { Breadcrumbs } from '../components/Breadcrumbs'
import { PageContainer } from '../components/PageContainer'
import { ReceiptForm } from '../components/ReceiptForm'

export function InventoryReceiptPage() {
  return (
    <PageContainer maxWidth={640} cardClassName="product-create-card">
      <Breadcrumbs />
      <ReceiptForm />
    </PageContainer>
  )
}
