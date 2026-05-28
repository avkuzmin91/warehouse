/** Соответствие op_type → tone (для иконки в журнале операций приёмки). */
export const OP_TONES: Record<string, string> = {
  doc_create: 'accent',
  doc_update: '',
  line_add: 'accent',
  line_update: '',
  line_delete: 'danger',
  plan_fix: 'info',
  arrival_fix: 'info',
  receiving: 'success',
  defect_fix: 'warning',
  qc_complete: 'success',
  cancel: 'danger',
  line_qc_complete: 'success',
  line_qc_reopen: 'info',
  receiving_correction: 'warning',
  defect_correction: 'warning',
}

/** Соответствие op_type → имя иконки. */
export const OP_ICONS: Record<string, string> = {
  doc_create: 'plus',
  doc_update: 'edit',
  line_add: 'plus',
  line_update: 'edit',
  line_delete: 'trash',
  plan_fix: 'arrowRight',
  arrival_fix: 'check',
  receiving: 'check',
  defect_fix: 'alert',
  qc_complete: 'shield',
  cancel: 'x',
  line_qc_complete: 'check',
  line_qc_reopen: 'edit',
  receiving_correction: 'edit',
  defect_correction: 'edit',
}
