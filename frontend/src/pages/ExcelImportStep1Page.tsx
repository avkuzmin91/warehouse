import { useCallback, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ActionBar } from '../components/ActionBar'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { MovementsExcelImportPreviewSection } from '../components/MovementsExcelImportPreviewSection'
import { PageContainer } from '../components/PageContainer'
import {
  deleteImportStaging,
  downloadMovementsImportTemplate,
  postImportExcelUploadWithProgress,
  postMovementsImportCommitStaged,
  postMovementsImportPreviewStaged,
  type InventoryOpType,
  type MovementImportPreviewResponse,
} from '../api'

const MAX_BYTES = 20 * 1024 * 1024

export type ExcelImportStep1PageProps = {
  opType: InventoryOpType
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function validateExcelFile(file: File): string | null {
  if (file.size > MAX_BYTES) {
    return 'Размер файла превышает допустимый лимит 20 MB'
  }
  const n = file.name.trim().toLowerCase()
  const ok = n.endsWith('.xlsx') || n.endsWith('.xlsm') || /\.xls$/.test(n)
  if (!ok) {
    return 'Неподдерживаемый формат файла'
  }
  return null
}

export function ExcelImportStep1Page({ opType }: ExcelImportStep1PageProps) {
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)

  const templateType = opType === 'in' ? 'receipt' : ('shipment' as const)

  const [uploadPct, setUploadPct] = useState<number | null>(null)
  const [checking, setChecking] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [error, setError] = useState('')
  const [uploaded, setUploaded] = useState<{ fileId: string; name: string; size: number } | null>(
    null,
  )
  const [checkPreview, setCheckPreview] = useState<MovementImportPreviewResponse | null>(null)
  const [doneSummary, setDoneSummary] = useState<string | null>(null)

  const busy = checking || committing
  const resetFile = useCallback(() => {
    setUploaded(null)
    setUploadPct(null)
    setError('')
    setCheckPreview(null)
    setDoneSummary(null)
    setChecking(false)
    setCommitting(false)
    if (inputRef.current) inputRef.current.value = ''
  }, [])

  const processFile = useCallback(
    async (file: File | null) => {
      setError('')
      setUploadPct(null)
      if (!file) {
        setUploaded(null)
        setCheckPreview(null)
        setDoneSummary(null)
        return
      }
      const v = validateExcelFile(file)
      if (v) {
        setError(v)
        setUploaded(null)
        setCheckPreview(null)
        setDoneSummary(null)
        if (inputRef.current) inputRef.current.value = ''
        return
      }
      setUploadPct(0)
      try {
        const res = await postImportExcelUploadWithProgress(
          { templateType, file },
          (pct) => setUploadPct(pct),
        )
        setUploaded({ fileId: res.file_id, name: res.file_name, size: res.file_size })
        setUploadPct(null)
        setCheckPreview(null)
        setDoneSummary(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Ошибка загрузки')
        setUploaded(null)
        setCheckPreview(null)
        setDoneSummary(null)
        setUploadPct(null)
        if (inputRef.current) inputRef.current.value = ''
      }
    },
    [templateType],
  )

  const [dragDepth, setDragDepth] = useState(0)

  const runCheck = useCallback(async () => {
    if (!uploaded || uploadPct !== null || busy) return
    setChecking(true)
    setError('')
    try {
      const preview = await postMovementsImportPreviewStaged(opType, uploaded.fileId)
      setCheckPreview(preview)
      setDoneSummary(null)
    } catch (e) {
      setCheckPreview(null)
      setError(e instanceof Error ? e.message : 'Ошибка проверки файла')
    } finally {
      setChecking(false)
    }
  }, [uploaded, uploadPct, busy, opType])

  async function onCommit() {
    if (!uploaded || !checkPreview) return
    setError('')
    setCommitting(true)
    try {
      const res = await postMovementsImportCommitStaged(opType, uploaded.fileId, false)
      setDoneSummary(`Загружено ${res.success} из ${res.total} строк`)
      setUploaded(null)
      setCheckPreview(null)
      if (inputRef.current) inputRef.current.value = ''
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки')
    } finally {
      setCommitting(false)
    }
  }

  async function onDeleteStagingAndReset() {
    if (!uploaded) return
    setError('')
    setCommitting(true)
    try {
      await deleteImportStaging(uploaded.fileId)
      resetFile()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось удалить файл')
    } finally {
      setCommitting(false)
    }
  }

  const afterSuccess = Boolean(doneSummary)

  const actionPrimaryLabel = checkPreview
    ? committing
      ? 'Загрузка…'
      : 'Продолжить импорт'
    : checking
      ? 'Проверяем файл...'
      : 'Проверить файл'

  const actionPrimaryDisabled = checkPreview
    ? busy || !checkPreview.import_ready
    : !uploaded || uploadPct !== null || busy

  const runActionPrimary = () => {
    if (checkPreview) void onCommit()
    else void runCheck()
  }

  return (
    <PageContainer
      maxWidth={944}
      cardClassName={`users-card product-create-card excel-import-page excel-import-page--glass${checkPreview ? ' excel-import-page--preview' : ''}`}
    >
      <Breadcrumbs />

      <section className="excel-import-page__section" aria-labelledby="excel-import-download-heading">
        <h2 id="excel-import-download-heading" className="excel-import-page__section-title">
          Скачать шаблон
        </h2>
        <div className="excel-import-page__download-row">
          <button
            type="button"
            className="excel-import-page__download-trigger"
            onClick={() =>
              downloadMovementsImportTemplate(opType).catch((e) =>
                setError(e instanceof Error ? e.message : String(e)),
              )
            }
          >
            <svg className="excel-import-page__download-icon" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>Скачать шаблон Excel</span>
          </button>
        </div>
      </section>

      <section className="excel-import-page__section" aria-labelledby="excel-import-upload-heading">
        <h2 id="excel-import-upload-heading" className="excel-import-page__section-title">
          Загрузка файла
        </h2>
        {!uploaded ? (
          <>
            <div
              className={`excel-import-page__dropzone${dragDepth > 0 ? ' excel-import-page__dropzone--active' : ''}`}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  inputRef.current?.click()
                }
              }}
              onDragEnter={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setDragDepth((d) => d + 1)
              }}
              onDragOver={(e) => {
                e.preventDefault()
                e.stopPropagation()
              }}
              onDragLeave={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setDragDepth((d) => Math.max(0, d - 1))
              }}
              onDrop={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setDragDepth(0)
                const f = e.dataTransfer.files?.[0] ?? null
                void processFile(f)
              }}
              onClick={() => inputRef.current?.click()}
            >
              <svg className="excel-import-page__upload-icon" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M12 16V7m0 0l-3.5 3.5M12 7l3.5 3.5M5 19h14"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <p className="excel-import-page__dropzone-hint">
                Перетащите Excel-файл сюда или{' '}
                <span
                  className="excel-import-page__inline-file-trigger"
                  role="button"
                  tabIndex={0}
                  onClick={(ev) => {
                    ev.stopPropagation()
                    inputRef.current?.click()
                  }}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                      ev.preventDefault()
                      ev.stopPropagation()
                      inputRef.current?.click()
                    }
                  }}
                >
                  выберите файл
                </span>
              </p>
              <p className="excel-import-page__dropzone-formats">Форматы: .xlsx, .xls · до 20 MB</p>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.xlsm"
              className="excel-import-page__file-input"
              aria-hidden
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null
                void processFile(f)
              }}
            />
          </>
        ) : null}

        {uploadPct !== null ? (
          <div className="excel-import-page__progress" aria-busy="true">
            <div className="excel-import-page__progress-track">
              <div className="excel-import-page__progress-fill" style={{ width: `${uploadPct}%` }} />
            </div>
            <span className="excel-import-page__progress-label">Загрузка… {uploadPct}%</span>
          </div>
        ) : null}

        {uploaded ? (
          <div className="excel-import-page__file-done">
            <div className="excel-import-page__file-done-inner">
              <div className="excel-import-page__file-main excel-import-page__file-main--static">
                <span className="excel-import-page__file-doc-icon" aria-hidden>
                  <svg viewBox="0 0 24 24" fill="none">
                    <path
                      d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M14 2v6h6M9 15h6M9 11h6"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
                <div>
                  <div className="excel-import-page__file-name excel-import-page__file-name--plain">{uploaded.name}</div>
                  <p className="excel-import-page__file-meta-line">
                    <span>{formatFileSize(uploaded.size)}</span>
                    <span className="excel-import-page__file-meta-sep" aria-hidden>
                      ·
                    </span>
                    <span className="excel-import-page__file-status-inline">Файл загружен</span>
                  </p>
                </div>
              </div>
              <div className="excel-import-page__file-actions">
                <button
                  type="button"
                  className="btn btn--secondary excel-import-page__file-remove-btn"
                  aria-label="Удалить файл"
                  title="Удалить файл"
                  disabled={busy}
                  onClick={() => void onDeleteStagingAndReset()}
                >
                  <svg className="excel-import-page__file-action-svg" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path
                      d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {checking ? (
          <p className="excel-import-page__loading" aria-busy="true">
            Проверяем файл...
          </p>
        ) : null}

        {error ? (
          <p className="error-text excel-import-page__error" role="alert">
            {error}
          </p>
        ) : null}

        {doneSummary ? (
          <p className="movements-import-modal__done excel-import-page__done-banner">{doneSummary}</p>
        ) : null}

        {checkPreview && uploaded && !doneSummary ? (
          <div className="excel-import-page__check-block" aria-labelledby="excel-import-check-result-heading">
            <h3 id="excel-import-check-result-heading" className="excel-import-page__section-title">
              Результат проверки
            </h3>
            <div className="excel-import-page__check-summary" aria-live="polite">
              <p className="excel-import-page__check-summary-lines">
                Всего строк: {checkPreview.summary_total}
                <br />
                Корректных: {checkPreview.summary_ok}
                <br />
                С ошибками: {checkPreview.summary_with_errors}
              </p>
              <p
                className={
                  checkPreview.import_ready
                    ? 'excel-import-page__file-status-badge excel-import-page__file-status-badge--ok'
                    : 'excel-import-page__file-status-badge excel-import-page__file-status-badge--bad'
                }
              >
                {checkPreview.file_status_label}
              </p>
            </div>
            <MovementsExcelImportPreviewSection preview={checkPreview} />
          </div>
        ) : null}
      </section>

      {!afterSuccess ? (
        <ActionBar
          primaryLabel={actionPrimaryLabel}
          primaryDisabled={actionPrimaryDisabled}
          onPrimary={runActionPrimary}
          secondaryLabel="Отмена"
          onSecondary={() => navigate(-1)}
        />
      ) : null}
    </PageContainer>
  )
}
