import type { ContainerLabel } from '../../../api/containersApi'
import { openQrLabelSheet, POPUP_BLOCKED_HINT } from '../../../utils/qrLabelSheet'

/** Лист этикеток коробов: QR «wms:box:<id>» + человекочитаемый номер, лента 58×40 мм. */
export function printBoxLabels(labels: ContainerLabel[]): boolean {
  return openQrLabelSheet(labels.map((l) => ({ qr_svg: l.qr_svg, code: l.doc_number })))
}

export { POPUP_BLOCKED_HINT }
