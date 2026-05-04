import { useParams } from 'react-router-dom'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { PageContainer } from '../components/PageContainer'
import { ShipmentForm } from '../components/ShipmentForm'

export function InventoryShipmentEditPage() {
  const { shipmentId } = useParams<{ shipmentId: string }>()
  return (
    <PageContainer maxWidth={640} cardClassName="product-create-card">
      <Breadcrumbs />
      <ShipmentForm shipmentId={shipmentId} />
    </PageContainer>
  )
}
