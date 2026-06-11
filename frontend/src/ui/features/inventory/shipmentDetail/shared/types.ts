import type { ShipmentLine, ShipmentLineFile } from '../../../../../api/shipmentsApi'

export type EditableShipmentLine = ShipmentLine & { _key: string; available: number }

export type LineDraft = {
  qty: number
  storeId: string
  storeName: string | null
}

export type StoreChoice = { id: string; name: string }

export type FilePreviewMeta = {
  productName: string
  sku: string
  colorName: string | null
  sizeName: string | null
  qty: number
}

export type LineFilePreview = FilePreviewMeta & { file: ShipmentLineFile }
