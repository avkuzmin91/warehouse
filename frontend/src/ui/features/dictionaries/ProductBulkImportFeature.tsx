import { useMemo, useRef, useState, type DragEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  PRODUCT_IMPORT_ACTION_LABELS,
  commitProductImport,
  getProductImportReport,
  getProductImportTemplate,
  previewProductImport,
} from '../../../api/adminApi'
import type { ProductImportAction, ProductImportPreviewResponse } from '../../../api/domainTypes'
import { useLookups } from '../../../hooks/useLookups'
import { FormPage } from '../../layouts/FormPage'
import { Alert } from '../../primitives/Alert'
import { Badge, type BadgeTone } from '../../primitives/Badge'
import { Field } from '../../primitives/Input'
import { Icon } from '../../primitives/Icon'
import { Combobox } from '../../data/Combobox'
import type { ComboboxOption } from '../../data/Combobox'
import { useToast } from '../../feedback/Toast'

const BACK_TO = '/dictionaries?type=products'

const ACTION_TONE: Record<ProductImportAction, BadgeTone> = {
  create: 'success',
  append: 'info',
  skip: '',
  error: 'danger',
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div style={{ fontSize: 13 }}>
      <span style={{ color: 'var(--c-text-subtle)' }}>{label}: </span>
      <span style={{ fontWeight: 600, color: tone }}>{value}</span>
    </div>
  )
}

export function ProductBulkImportFeature() {
  const navigate = useNavigate()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)

  const { clients: clientLookups } = useLookups()
  const clients = useMemo<ComboboxOption[]>(
    () => clientLookups.map((c) => ({ value: c.id, label: c.name })),
    [clientLookups],
  )

  const [clientId, setClientId] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [checking, setChecking] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<ProductImportPreviewResponse | null>(null)

  const summary = preview?.summary

  const handleFile = async (file: File) => {
    if (!clientId) {
      setError('Сначала выберите клиента')
      return
    }
    setError('')
    setChecking(true)
    try {
      setPreview(await previewProductImport(clientId, file))
    } catch (ex) {
      setPreview(null)
      setError(ex instanceof Error ? ex.message : 'Не удалось проверить файл')
    } finally {
      setChecking(false)
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) void handleFile(file)
  }

  const handleTemplate = async () => {
    try {
      downloadBlob(await getProductImportTemplate(), 'Шаблон загрузки товаров.xlsx')
    } catch (ex) {
      toast(ex instanceof Error ? ex.message : 'Не удалось скачать шаблон', 'error')
    }
  }

  const handleReport = async () => {
    if (!preview) return
    try {
      downloadBlob(await getProductImportReport(preview.import_id), 'Проверка загрузки товаров.xlsx')
    } catch (ex) {
      toast(ex instanceof Error ? ex.message : 'Не удалось скачать отчёт', 'error')
    }
  }

  const handleCommit = async (partial: boolean) => {
    if (!preview || importing) return
    setImporting(true)
    setError('')
    try {
      const res = await commitProductImport(preview.import_id, partial)
      toast(res.message, 'success')
      navigate(BACK_TO)
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : 'Не удалось загрузить товары')
      setImporting(false)
    }
  }

  const resetFile = () => {
    setPreview(null)
    setError('')
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <FormPage
      title="Загрузка товаров из Excel"
      subtitle="Товары заводятся по выбранному клиенту: строка файла — вариант товара"
      backTo={BACK_TO}
      actions={
        <button type="button" className="btn ghost" onClick={handleTemplate}>
          <Icon name="download" size={14} />Скачать шаблон
        </button>
      }
    >
      <div style={{ maxWidth: 1080, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="card">
          <div className="card-head"><div className="card-head-title">Клиент и файл</div></div>
          <div className="card-body">
            <div style={{ maxWidth: 420 }}>
              <Field label="Клиент" required>
                <Combobox
                  value={clientId}
                  onChange={(v) => { setClientId(v ? String(v) : null); resetFile() }}
                  options={clients}
                  placeholder="Выберите клиента…"
                  clearable
                />
              </Field>
            </div>

            <div
              className="dropzone"
              style={{
                marginTop: 8,
                opacity: clientId ? 1 : 0.5,
                cursor: clientId ? 'pointer' : 'not-allowed',
                border: dragging ? '1.5px dashed var(--c-accent)' : undefined,
                background: dragging ? 'var(--c-accent-bg)' : undefined,
              }}
              onDragOver={(e) => { e.preventDefault(); if (clientId) setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { if (clientId) onDrop(e); else e.preventDefault() }}
              onClick={() => { if (clientId) fileRef.current?.click() }}
            >
              <Icon name="upload" size={26} style={{ color: 'var(--c-text-subtle)', marginBottom: 10 }} />
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>
                {checking ? 'Проверяем файл…' : 'Перетащите файл или нажмите для выбора'}
              </div>
              <div className="t-sub" style={{ fontSize: 12 }}>
                Поддерживаются .xlsx, .xlsm и .xls, до 20 МБ
              </div>
              {preview && (
                <div className="t-sub" style={{ fontSize: 12, marginTop: 8 }}>
                  Файл: {preview.file_name}
                </div>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xlsm,.xls"
              style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f) }}
            />

            {error && (
              <Alert tone="danger" icon={false} style={{ marginTop: 12 }}>{error}</Alert>
            )}
          </div>
        </div>

        {summary && preview && (
          <div className="card">
            <div className="card-head">
              <div className="card-head-title">Проверка файла</div>
              <Badge tone={summary.rows_with_errors ? 'danger' : summary.import_ready ? 'success' : 'warning'} dot>
                {preview.status_label}
              </Badge>
            </div>
            <div className="card-body">
              <div className="row gap-16" style={{ flexWrap: 'wrap', marginBottom: 14 }}>
                <Metric label="Строк" value={summary.rows_total} />
                <Metric label="Корректных" value={summary.rows_ok} tone="var(--c-success)" />
                {summary.rows_with_errors > 0 && (
                  <Metric label="С ошибками" value={summary.rows_with_errors} tone="var(--c-danger)" />
                )}
                {summary.rows_with_warnings > 0 && (
                  <Metric label="С предупреждениями" value={summary.rows_with_warnings} tone="var(--c-warning)" />
                )}
                <Metric label="Новых товаров" value={summary.products_new} />
                <Metric label="Новых вариантов" value={summary.variants_new} />
                {summary.variants_skipped > 0 && (
                  <Metric label="Уже заведено" value={summary.variants_skipped} />
                )}
                {summary.barcodes_new > 0 && (
                  <Metric label="Штрих-кодов" value={summary.barcodes_new} />
                )}
              </div>

              <div className="t-wrap" style={{ maxHeight: 480, overflowY: 'auto' }}>
                <table className="t">
                  <thead>
                    <tr>
                      <th className="th">#</th>
                      <th className="th">SKU базовый</th>
                      <th className="th">Название</th>
                      <th className="th">Тип</th>
                      <th className="th">Цвет</th>
                      <th className="th">Размер</th>
                      <th className="th">SKU варианта</th>
                      <th className="th">Действие</th>
                      <th className="th">Ошибки и предупреждения</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row) => (
                      <tr
                        key={row.row_no}
                        style={row.errors.length ? { background: 'var(--c-danger-bg)' } : undefined}
                      >
                        <td className="td t-sub" style={{ fontSize: 12 }}>{row.row_no}</td>
                        <td className="td mono" style={{ fontSize: 12 }}>{row.sku || '—'}</td>
                        <td className="td" style={{ fontSize: 12 }}>{row.name || '—'}</td>
                        <td className="td" style={{ fontSize: 12 }}>{row.type_name || '—'}</td>
                        <td className="td" style={{ fontSize: 12 }}>{row.color_name || '—'}</td>
                        <td className="td" style={{ fontSize: 12 }}>{row.size_name || '—'}</td>
                        <td className="td mono" style={{ fontSize: 12 }}>{row.variant_sku || '—'}</td>
                        <td className="td">
                          <Badge tone={ACTION_TONE[row.action]} dot>
                            {PRODUCT_IMPORT_ACTION_LABELS[row.action]}
                          </Badge>
                        </td>
                        <td className="td" style={{ fontSize: 12 }}>
                          {row.errors.map((e, i) => (
                            <div key={`e${i}`} style={{ color: 'var(--c-danger)' }}>{e}</div>
                          ))}
                          {row.warnings.map((w, i) => (
                            <div key={`w${i}`} style={{ color: 'var(--c-warning)' }}>{w}</div>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="row gap-8" style={{ marginTop: 16, flexWrap: 'wrap' }}>
                <button type="button" className="btn ghost" onClick={resetFile} disabled={importing}>
                  Другой файл
                </button>
                <button type="button" className="btn ghost" onClick={handleReport} disabled={importing}>
                  <Icon name="download" size={14} />Скачать отчёт
                </button>
                {summary.can_import_partial && (
                  <button type="button" className="btn" onClick={() => handleCommit(true)} disabled={importing}>
                    {importing ? 'Загрузка…' : `Только корректные (${summary.variants_new})`}
                  </button>
                )}
                {summary.import_ready && (
                  <button type="button" className="btn primary" onClick={() => handleCommit(false)} disabled={importing}>
                    {importing ? 'Загрузка…' : <><Icon name="check" size={14} />Импортировать ({summary.variants_new})</>}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </FormPage>
  )
}
