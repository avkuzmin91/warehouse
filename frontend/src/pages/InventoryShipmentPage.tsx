import { Breadcrumbs } from '../components/Breadcrumbs'
import { PageContainer } from '../components/PageContainer'
import { ShipmentForm } from '../components/ShipmentForm'

export function InventoryShipmentPage() {
  return (
    <PageContainer maxWidth={640} cardClassName="product-create-card">
      <Breadcrumbs />
      <ShipmentForm />
    </PageContainer>
  )
}
