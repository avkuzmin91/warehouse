import type { MovementImportPreviewResponse, MovementImportPreviewRowResult } from '../api/domainTypes'

export type MovementsExcelImportPreviewSectionProps = {
  preview: MovementImportPreviewResponse
}

function rowClass(rr: MovementImportPreviewRowResult): string | undefined {
  if (rr.errors.length > 0) return 'movements-import-table__row--error'
  if (rr.warnings.length > 0) return 'movements-import-table__row--warn'
  return undefined
}

/** Таблица детализации проверки (ТЗ шаг 02). */
export function MovementsExcelImportPreviewSection({ preview }: MovementsExcelImportPreviewSectionProps) {
  const rowErrorsOnly = preview.errors.filter((e) => e.row === 0)

  return (
    <div className="movements-import-modal__preview movements-import-modal__preview--table-only">
      {rowErrorsOnly.length > 0 ? (
        <div className="movements-import-modal__errors" role="alert">
          <h3 className="movements-import-modal__sub">Ошибки файла</h3>
          <ul className="movements-import-modal__err-list">
            {rowErrorsOnly.map((e, i) => (
              <li key={`f-${i}`} className="movements-import-modal__err-item">
                {e.error}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="movements-import-modal__scroll">
        <table className="data-table movements-import-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Дата</th>
              <th>Штрих-код</th>
              <th>Цвет</th>
              <th>Размер</th>
              <th>Количество</th>
              <th>Статус</th>
              <th>Найденный товар</th>
              <th>Ошибки</th>
            </tr>
          </thead>
          <tbody>
            {preview.row_results.map((r) => (
              <tr key={r.excel_row} className={rowClass(r)}>
                <td>{r.excel_row}</td>
                <td>{r.date || '—'}</td>
                <td>{r.barcode || '—'}</td>
                <td>{r.color || '—'}</td>
                <td>{r.size?.trim() ? r.size : '—'}</td>
                <td>{r.quantity != null ? r.quantity : '—'}</td>
                <td>{r.status_display?.trim() ? r.status_display : '—'}</td>
                <td>{r.found_product_name?.trim() ? r.found_product_name : '—'}</td>
                <td>
                  {r.errors.length > 0 ? (
                    <ul className="movements-import-table__cell-errors">
                      {r.errors.map((t, i) => (
                        <li key={i}>{t}</li>
                      ))}
                    </ul>
                  ) : r.warnings.length > 0 ? (
                    <ul className="movements-import-table__cell-warnings">
                      {r.warnings.map((t, i) => (
                        <li key={i}>{t}</li>
                      ))}
                    </ul>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
