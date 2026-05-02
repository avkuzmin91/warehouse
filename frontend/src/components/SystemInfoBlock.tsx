import type { ReactNode } from 'react'

/** ТЗ: единый контракт audit-полей для отображения (значения с API). */
export type SystemInfo = {
  created_at: string
  created_by: string
  updated_at?: string | null
  updated_by?: string | null
}

function formatAuditDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export type SystemInfoBlockProps = {
  /** Данные после успешного GET; обязательны created_at и created_by для показа блока */
  info: SystemInfo
  className?: string
}

/**
 * Служебный блок аудита: только Edit/View, не Create.
 * Порядок на странице: поля формы → SystemInfoBlock → ActionBar.
 */
export function SystemInfoBlock({ info, className = '' }: SystemInfoBlockProps) {
  if (!info.created_at?.trim()) {
    return null
  }

  const noUpdate =
    (info.updated_at == null || String(info.updated_at).trim() === '') &&
    (info.updated_by == null || String(info.updated_by).trim() === '')

  const updatedAtDisplay = noUpdate ? '—' : formatAuditDate(info.updated_at)
  const updatedByDisplay = noUpdate ? '—' : info.updated_by?.trim() || '—'

  const rootClass = ['product-meta-block', 'product-meta-block--record', 'system-info-block', className]
    .filter(Boolean)
    .join(' ')

  return (
    <section className={rootClass} aria-label="Информация о записи">
      <p className="product-meta-block__title system-info-block__title">Информация о записи</p>
      <div className="system-info-block__groups">
        <div className="system-info-block__group">
          <MetaLine label="Создано" value={formatAuditDate(info.created_at)} />
          <MetaLine label="Создал" value={info.created_by?.trim() || '—'} />
        </div>
        <div className="system-info-block__group system-info-block__group--secondary">
          <MetaLine label="Последнее изменение" value={updatedAtDisplay} />
          <MetaLine label="Изменил" value={updatedByDisplay} />
        </div>
      </div>
    </section>
  )
}

function MetaLine({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="system-info-block__line">
      <span className="product-record-meta__k">{label}</span>
      <span className="product-record-meta__v">{value}</span>
    </div>
  )
}

/** Собрать SystemInfo из ответа API, где created_by может быть null (legacy). */
export function systemInfoFromApi(row: {
  created_at: string
  created_by?: string | null
  updated_at?: string | null
  updated_by?: string | null
}): SystemInfo | null {
  if (!row.created_at?.trim()) return null
  return {
    created_at: row.created_at,
    created_by: row.created_by?.trim() || '—',
    updated_at: row.updated_at,
    updated_by: row.updated_by,
  }
}
