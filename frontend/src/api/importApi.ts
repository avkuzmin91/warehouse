import { scheduleHardRedirectToAuth } from '../auth/redirectToAuth'
import { SessionExpiredError } from '../auth/sessionError'
import { API_BASE_URL, AUTH_FETCH_CREDENTIALS } from './constants'
import { formatApiErrorDetail, requestForm, throwIfUnauthorizedApi } from './http'
import { clearToken, getToken } from './sessionAuth'
import type {
  ImportExcelUploadResponse,
  InventoryOpType,
  MovementImportCommitResponse,
  MovementImportPreviewResponse,
} from './domainTypes'

export type {
  ImportExcelUploadResponse,
  InventoryOpType,
  MovementImportCommitResponse,
  MovementImportPreviewResponse,
  MovementImportPreviewRow,
  MovementImportPreviewRowResult,
} from './domainTypes'

const IMPORT_TEMPLATE_DOWNLOAD_NAME: Record<InventoryOpType, string> = {
  in: 'Поступление.xlsx',
  out: 'Отгрузка.xlsx',
}

export function postImportExcelUploadWithProgress(
  params: { templateType: 'receipt' | 'shipment'; file: File },
  onProgress: (percent: number) => void,
): Promise<ImportExcelUploadResponse> {
  const token = getToken()
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_BASE_URL}/import/upload`)
    xhr.withCredentials = true
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    }
    xhr.responseType = 'json'
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) {
        onProgress(Math.min(100, Math.round((100 * ev.loaded) / Math.max(ev.total, 1))))
      }
    }
    xhr.onerror = () => reject(new Error('Ошибка сети при загрузке файла'))
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response as ImportExcelUploadResponse)
        return
      }
      if (xhr.status === 401 && token) {
        clearToken()
        scheduleHardRedirectToAuth()
        reject(new SessionExpiredError())
        return
      }
      const body = xhr.response
      reject(new Error(formatApiErrorDetail(body, xhr.status)))
    }
    const form = new FormData()
    form.append('template_type', params.templateType)
    form.append('file', params.file)
    xhr.send(form)
  })
}

export async function deleteImportStaging(fileId: string): Promise<void> {
  const token = getToken()
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  const path = `/import/staging/${encodeURIComponent(fileId.trim())}`
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'DELETE',
    credentials: AUTH_FETCH_CREDENTIALS,
    headers,
  })
  throwIfUnauthorizedApi(path, res, headers)
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(formatApiErrorDetail(body, res.status))
  }
}

export function postMovementsImportPreviewStaged(opType: InventoryOpType, fileId: string) {
  const q = `op_type=${encodeURIComponent(opType)}&file_id=${encodeURIComponent(fileId.trim())}`
  const form = new FormData()
  return requestForm<MovementImportPreviewResponse>(`/import/movements/preview-staged?${q}`, {
    method: 'POST',
    body: form,
  })
}

export function postMovementsImportCommitStaged(
  opType: InventoryOpType,
  fileId: string,
  partial: boolean,
) {
  const p = partial ? '1' : '0'
  const q = `op_type=${encodeURIComponent(opType)}&file_id=${encodeURIComponent(fileId.trim())}&partial=${p}`
  const form = new FormData()
  return requestForm<MovementImportCommitResponse>(`/import/movements/commit-staged?${q}`, {
    method: 'POST',
    body: form,
  })
}

export function postMovementsImportPreview(opType: InventoryOpType, file: File) {
  const form = new FormData()
  form.append('file', file)
  return requestForm<MovementImportPreviewResponse>(
    `/import/movements/preview?op_type=${encodeURIComponent(opType)}`,
    { method: 'POST', body: form },
  )
}

export function postMovementsImportCommit(opType: InventoryOpType, file: File, partial: boolean) {
  const form = new FormData()
  form.append('file', file)
  const p = partial ? '1' : '0'
  return requestForm<MovementImportCommitResponse>(
    `/import/movements/commit?op_type=${encodeURIComponent(opType)}&partial=${p}`,
    { method: 'POST', body: form },
  )
}

export async function downloadMovementsImportTemplate(opType: InventoryOpType) {
  const token = getToken()
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  const path = `/import/movements/template?op_type=${encodeURIComponent(opType)}`
  const r = await fetch(`${API_BASE_URL}${path}`, {
    credentials: AUTH_FETCH_CREDENTIALS,
    headers,
  })
  throwIfUnauthorizedApi(path, r, headers)
  if (!r.ok) {
    const body = await r.json().catch(() => null)
    throw new Error(formatApiErrorDetail(body, r.status))
  }
  const blob = await r.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = IMPORT_TEMPLATE_DOWNLOAD_NAME[opType]
  a.click()
  URL.revokeObjectURL(url)
}
