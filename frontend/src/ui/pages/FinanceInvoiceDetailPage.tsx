import { useParams } from 'react-router-dom'
import { InvoiceDetailFeature } from '../features/finance/InvoiceDetailFeature'

export function FinanceInvoiceDetailPage() {
  const { invoiceId } = useParams<{ invoiceId: string }>()
  if (!invoiceId) return null
  return <InvoiceDetailFeature invoiceId={invoiceId} />
}
