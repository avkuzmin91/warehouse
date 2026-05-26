import { useState, useRef, type DragEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  postImportExcelUploadWithProgress,
  downloadMovementsImportTemplate,
} from '../../api/importApi'
import type { InventoryOpType } from '../../api/importApi'
import { FormPage } from '../layouts/FormPage'
import { Icon } from '../primitives/Icon'

interface Props {
  opType: InventoryOpType
}

export function ExcelImportStep1Page({ opType }: Props) {
  const navigate = useNavigate()
  const [dragging, setDragging] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const label = opType === 'in' ? 'поступлений' : 'отгрузок'
  const backTo = opType === 'in' ? '/inventory/receipts' : '/inventory/shipments'
  const previewPath = opType === 'in' ? '/inventory/receipts/import/excel/preview' : '/inventory/shipments/import/excel/preview'

  async function handleFile(file: File) {
    setError('')
    setProgress(0)
    try {
      const res = await postImportExcelUploadWithProgress(
        { templateType: opType === 'in' ? 'receipt' : 'shipment', file },
        (p) => setProgress(p),
      )
      sessionStorage.setItem('import_file_id', res.file_id)
      sessionStorage.setItem('import_file_name', res.file_name)
      sessionStorage.setItem('import_op_type', opType)
      navigate(previewPath)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки')
      setProgress(null)
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  return (
    <FormPage title={`Импорт ${label} из Excel`} subtitle="Шаг 1 из 2: Загрузка файла" backTo={backTo}>
      <div style={{ maxWidth: 580 }}>
        <div
          className={`dropzone`}
          style={{ marginBottom: 16, border: dragging ? '1.5px dashed var(--c-accent)' : undefined, background: dragging ? 'var(--c-accent-bg)' : undefined }}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
        >
          <Icon name="upload" size={28} style={{ color: dragging ? 'var(--c-accent)' : 'var(--c-text-subtle)', marginBottom: 12 }} />
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>
            Перетащите файл или нажмите для выбора
          </div>
          <div className="text-sm subtle">Поддерживаются файлы .xlsx, .xls</div>
          {progress !== null && (
            <div style={{ marginTop: 16 }}>
              <div className="prog" style={{ height: 6, maxWidth: 300, margin: '0 auto' }}>
                <div className="prog-fill" style={{ width: `${progress}%`, transition: 'width 200ms' }} />
              </div>
              <div className="text-xs subtle" style={{ marginTop: 6 }}>{progress}%</div>
            </div>
          )}
        </div>
        <input ref={inputRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />

        {error && <div style={{ color: 'var(--c-danger)', fontSize: 12.5, marginBottom: 12 }}>{error}</div>}

        <button
          className="btn ghost sm"
          onClick={() => downloadMovementsImportTemplate(opType)}
        >
          <Icon name="download" size={13} />Скачать шаблон
        </button>
      </div>
    </FormPage>
  )
}
