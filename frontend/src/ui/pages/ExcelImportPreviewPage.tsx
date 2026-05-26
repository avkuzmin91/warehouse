import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  postMovementsImportPreviewStaged,
  postMovementsImportCommitStaged,
} from '../../api/importApi'
import type { InventoryOpType, MovementImportPreviewRowResult } from '../../api/importApi'
import { FormPage } from '../layouts/FormPage'
import { Icon } from '../primitives/Icon'
import { Badge } from '../primitives/Badge'

interface Props {
  opType: InventoryOpType
}

export function ExcelImportPreviewPage({ opType }: Props) {
  const navigate = useNavigate()
  const backTo = opType === 'in' ? '/inventory/receipts/import/excel' : '/inventory/shipments/import/excel'
  const successTo = opType === 'in' ? '/inventory/receipts' : '/inventory/shipments'
  const label = opType === 'in' ? 'поступлений' : 'отгрузок'

  const [rowResults, setRowResults] = useState<MovementImportPreviewRowResult[]>([])
  const [summaryTotal, setSummaryTotal] = useState(0)
  const [summaryOk, setSummaryOk] = useState(0)
  const [summaryErrors, setSummaryErrors] = useState(0)
  const [importReady, setImportReady] = useState(false)
  const [loading, setLoading] = useState(true)
  const [committing, setCommitting] = useState(false)
  const [error, setError] = useState('')
  const [fileId, setFileId] = useState('')
  const [fileName, setFileName] = useState('')

  useEffect(() => {
    const id = sessionStorage.getItem('import_file_id') ?? ''
    const name = sessionStorage.getItem('import_file_name') ?? ''
    setFileId(id)
    setFileName(name)
    if (!id) {
      setError('Файл не найден. Вернитесь к шагу 1.')
      setLoading(false)
      return
    }
    postMovementsImportPreviewStaged(opType, id)
      .then((res) => {
        setRowResults(res.row_results)
        setSummaryTotal(res.summary_total)
        setSummaryOk(res.summary_ok)
        setSummaryErrors(res.summary_with_errors)
        setImportReady(res.import_ready)
        setLoading(false)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Ошибка предпросмотра')
        setLoading(false)
      })
  }, [opType])

  async function handleCommit(partial: boolean) {
    if (!fileId) return
    try {
      setCommitting(true)
      setError('')
      await postMovementsImportCommitStaged(opType, fileId, partial)
      sessionStorage.removeItem('import_file_id')
      sessionStorage.removeItem('import_file_name')
      sessionStorage.removeItem('import_op_type')
      navigate(successTo)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка импорта')
      setCommitting(false)
    }
  }

  return (
    <FormPage
      title={`Импорт ${label} из Excel`}
      subtitle={`Шаг 2 из 2: Предпросмотр${fileName ? ` · ${fileName}` : ''}`}
      backTo={backTo}
    >
      <div style={{ maxWidth: 960 }}>
        {loading && (
          <div style={{ color: 'var(--c-text-subtle)', fontSize: 13 }}>Анализируем файл…</div>
        )}

        {!loading && error && (
          <div style={{ color: 'var(--c-danger)', fontSize: 13, marginBottom: 16 }}>{error}</div>
        )}

        {!loading && rowResults.length > 0 && (
          <>
            <div className="row gap-16" style={{ marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ fontSize: 13 }}>
                Строк: <span style={{ fontWeight: 600 }}>{summaryTotal}</span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--c-success)' }}>
                Корректных: <span style={{ fontWeight: 600 }}>{summaryOk}</span>
              </div>
              {summaryErrors > 0 && (
                <div style={{ fontSize: 13, color: 'var(--c-danger)' }}>
                  С ошибками: <span style={{ fontWeight: 600 }}>{summaryErrors}</span>
                </div>
              )}
            </div>

            <div className="t-wrap" style={{ marginBottom: 20, maxHeight: 460, overflowY: 'auto' }}>
              <table className="t">
                <thead>
                  <tr>
                    <th className="th">#</th>
                    <th className="th">Дата</th>
                    <th className="th">Штрихкод</th>
                    <th className="th">Цвет</th>
                    <th className="th">Размер</th>
                    <th className="th">Кол-во</th>
                    <th className="th">Статус</th>
                    <th className="th">Товар / Ошибки</th>
                  </tr>
                </thead>
                <tbody>
                  {rowResults.map((row, i) => {
                    const hasErr = row.errors.length > 0
                    return (
                      <tr key={i} style={{ background: hasErr ? 'var(--c-danger-bg, rgba(220,38,38,0.05))' : undefined }}>
                        <td className="td" style={{ color: 'var(--c-text-subtle)', fontSize: 12 }}>{row.excel_row}</td>
                        <td className="td" style={{ fontSize: 12 }}>{row.date || '—'}</td>
                        <td className="td" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{row.barcode || '—'}</td>
                        <td className="td" style={{ fontSize: 12 }}>{row.color || '—'}</td>
                        <td className="td" style={{ fontSize: 12 }}>{row.size ?? '—'}</td>
                        <td className="td">{row.quantity ?? '—'}</td>
                        <td className="td">
                          <Badge tone={hasErr ? 'danger' : 'success'} dot>
                            {row.status_display || (hasErr ? 'Ошибка' : 'OK')}
                          </Badge>
                        </td>
                        <td className="td" style={{ fontSize: 12 }}>
                          {row.found_product_name && (
                            <div style={{ color: 'var(--c-text)', marginBottom: row.errors.length ? 4 : 0 }}>
                              {row.found_product_name}
                            </div>
                          )}
                          {row.errors.map((e, ei) => (
                            <div key={ei} style={{ color: 'var(--c-danger)' }}>{e}</div>
                          ))}
                          {row.warnings.map((w, wi) => (
                            <div key={wi} style={{ color: 'var(--c-warning, #d97706)' }}>{w}</div>
                          ))}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {error && (
              <div style={{ color: 'var(--c-danger)', fontSize: 12.5, marginBottom: 12 }}>{error}</div>
            )}

            <div className="row gap-8">
              <button className="btn ghost" onClick={() => navigate(backTo)} disabled={committing}>
                Назад
              </button>
              {summaryErrors > 0 && summaryOk > 0 && (
                <button className="btn" onClick={() => handleCommit(true)} disabled={committing}>
                  {committing ? 'Импорт…' : (
                    <><Icon name="check" size={14} />Только корректные ({summaryOk})</>
                  )}
                </button>
              )}
              {importReady && (
                <button className="btn primary" onClick={() => handleCommit(false)} disabled={committing}>
                  {committing ? 'Импорт…' : (
                    <><Icon name="check" size={14} />Импортировать все ({summaryTotal})</>
                  )}
                </button>
              )}
            </div>
          </>
        )}

        {!loading && rowResults.length === 0 && !error && (
          <div style={{ color: 'var(--c-text-subtle)', fontSize: 13 }}>
            Файл не содержит строк для импорта.
          </div>
        )}
      </div>
    </FormPage>
  )
}
