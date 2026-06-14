export const ALLOWED_FILE_EXTS = ['pdf', 'png', 'jpg', 'jpeg']
export const MAX_FILE_BYTES = 10 * 1024 * 1024

export function validateLineFile(file: File): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (!ALLOWED_FILE_EXTS.includes(ext)) return 'Допустимы файлы: PDF, PNG, JPG'
  if (file.size > MAX_FILE_BYTES) return 'Файл слишком большой (максимум 10 МБ)'
  return null
}

export function isPdf(mime: string | null, filename: string): boolean {
  return filename.split('.').pop()?.toLowerCase() === 'pdf' || mime === 'application/pdf'
}

export function isImageFile(mime: string | null, filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return ['png', 'jpg', 'jpeg'].includes(ext) || (mime?.startsWith('image/') ?? false)
}

export function fileTypeIcon(mime: string | null, filename: string): 'filePdf' | 'fileImg' {
  return isPdf(mime, filename) ? 'filePdf' : 'fileImg'
}

/** Цвет глифа: красный для PDF (как в большинстве UI), accent для картинок. */
export function fileTypeColor(mime: string | null, filename: string): string {
  return isPdf(mime, filename) ? 'var(--c-danger)' : 'var(--c-accent)'
}

export function shortName(name: string, max = 16): string {
  if (name.length <= max) return name
  const ext = name.includes('.') ? '.' + name.split('.').pop() : ''
  const base = name.slice(0, max - ext.length - 1)
  return `${base}…${ext}`
}

export function printFile(url: string) {
  const frame = document.createElement('iframe')
  let cleaned = false
  let cleanupTimer: number | undefined

  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    if (cleanupTimer != null) window.clearTimeout(cleanupTimer)
    window.setTimeout(() => frame.remove(), 500)
  }

  frame.style.position = 'fixed'
  frame.style.right = '0'
  frame.style.bottom = '0'
  frame.style.width = '1px'
  frame.style.height = '1px'
  frame.style.border = '0'
  frame.style.opacity = '0'
  frame.style.pointerEvents = 'none'
  frame.src = url
  frame.onload = () => {
    window.setTimeout(() => {
      const printWindow = frame.contentWindow
      if (!printWindow) {
        cleanup()
        return
      }

      const cleanupAfterDialog = () => {
        window.setTimeout(cleanup, 1000)
      }

      printWindow.addEventListener('afterprint', cleanupAfterDialog, { once: true })
      window.addEventListener('focus', cleanupAfterDialog, { once: true })
      cleanupTimer = window.setTimeout(cleanup, 120000)

      printWindow.focus()
      printWindow.print()
    }, 700)
  }
  document.body.appendChild(frame)
}

export function fitWidthPreviewUrl(url: string): string {
  const [base] = url.split('#')
  return `${base}#zoom=page-width&view=FitH`
}
