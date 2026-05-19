import { Navigate } from 'react-router-dom'
import type { InventoryOpType } from '../api/domainTypes'

export type ExcelImportPreviewPageProps = {
  opType: InventoryOpType
}

/** Результат проверки показывается на странице импорта; отдельный URL сохранён для совместимости. */
export function ExcelImportPreviewPage({ opType }: ExcelImportPreviewPageProps) {
  const to = opType === 'in' ? '/inventory/receipts/import/excel' : '/inventory/shipments/import/excel'
  return <Navigate to={to} replace />
}
