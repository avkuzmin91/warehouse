import { addReceiptLine } from '../../../../../api/receiptsApi'
import { MatrixAddDrawer } from '../../shared/MatrixAddDrawer'

type Props = {
  docId: string
  clientId: string
  open: boolean
  existingKeys?: string[]
  onClose: () => void
  onAdded: () => void
}

/**
 * Drawer для добавления строк в существующий документ поступления (draft/planned views).
 * Массовый ввод через матрицу цвет × размер; каждая ячейка пишется отдельной строкой
 * существующим append-only эндпоинтом.
 */
export function AddLineDrawer({ docId, clientId, open, existingKeys = [], onClose, onAdded }: Props) {
  return (
    <MatrixAddDrawer
      open={open}
      clientId={clientId}
      title="Добавить товары к приёмке"
      existingKeys={existingKeys}
      onClose={onClose}
      onSubmit={async (product, cells) => {
        for (const c of cells) {
          await addReceiptLine(docId, {
            product_id: product.id,
            product_name: product.name,
            product_sku: product.sku,
            color_id: c.color_id,
            color_name: c.color_name,
            size_id: c.size_id,
            size_name: c.size_name,
            planned_qty: c.qty,
          })
        }
        onAdded()
      }}
    />
  )
}
