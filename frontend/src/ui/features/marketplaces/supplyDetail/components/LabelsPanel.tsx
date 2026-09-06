import { useState } from 'react'
import { fetchMpSupplyLabels } from '../../../../../api/marketplacesApi'
import type { MpSupplyDetail } from '../../../../../api/marketplacesApi'
import { resolvePublicUploadSrc } from '../../../../../api/constants'
import { Icon } from '../../../../primitives/Icon'
import { useToast } from '../../../../feedback/Toast'
import { openOrderLabelSheet, POPUP_BLOCKED_HINT } from '../../../../../utils/qrLabelSheet'

/** Лента этикеток площадки на весь состав: печатается пачкой и клеится на заказы
 *  по ходу работы, а не по одной на станции упаковки.
 *
 *  Только WB и только после «Передать поставку WB»: стикер выдаётся заданию,
 *  лежащему в поставке продавца, а КИЗ уходит позже. Ozon отдаёт этикетку лишь
 *  после сборки отправления, которой обязан предшествовать КИЗ со скана упаковки. */
export function LabelsPanel({ detail, onChanged }: { detail: MpSupplyDetail; onChanged: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const selected = detail.orders.filter((o) => o.state === 'selected')
  const labels = selected.map((o) => o.label_url).filter((url): url is string => !!url)
  const ozon = detail.doc.marketplace === 'ozon'
  const transferred = !!detail.doc.mp_transferred_at
  const canFetch = !ozon && transferred

  const fetchLabels = async () => {
    setBusy(true)
    try {
      const res = await fetchMpSupplyLabels(detail.doc.id)
      if (res.error) toast(res.error, res.fetched ? 'info' : 'error')
      else if (res.fetched) toast(`Этикеток получено: ${res.fetched}`, 'success')
      else toast('Этикетки уже получены по всему составу', 'info')
      onChanged()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось получить этикетки', 'error')
    } finally {
      setBusy(false)
    }
  }

  const print = () => {
    if (!openOrderLabelSheet(labels.map(resolvePublicUploadSrc))) toast(POPUP_BLOCKED_HINT, 'error')
  }

  return (
    <div
      className="row gap-8"
      style={{
        padding: '10px 12px', marginBottom: 12, background: 'var(--c-bg-sunken)',
        borderRadius: 'var(--r-lg)', fontSize: 12.5, color: 'var(--c-text-muted)', alignItems: 'center',
      }}
    >
      <Icon name="barcode" size={14} />
      <span>
        Этикетки площадки: <b style={{ color: 'var(--c-text)' }}>{labels.length} из {selected.length}</b>
      </span>
      <span style={{ flex: 1, color: 'var(--c-text-subtle)' }}>
        {ozon
          ? 'Ozon отдаёт этикетку после сборки отправления — она приходит на станции упаковки, после скана кодов маркировки'
          : transferred
            ? 'Лента печатается пачкой и клеится на заказы по ходу работы'
            : 'Станут доступны после «Передать поставку WB» — стикеры выдаются заданиям в поставке продавца'}
      </span>
      {canFetch && labels.length < selected.length && (
        <button className="btn sm" disabled={busy} onClick={fetchLabels}>
          <Icon name="download" size={13} />Получить этикетки
        </button>
      )}
      {!ozon && labels.length > 0 && (
        <button className="btn sm" onClick={print}>
          <Icon name="print" size={13} />Печать ленты
        </button>
      )}
    </div>
  )
}
