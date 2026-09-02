import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { newRequestId } from '../api/http'
import { useNav, type PackFocus } from '../nav/NavContext'
import {
  advanceShipment,
  getShipment,
  SHIPMENT_STATUS_LABELS,
  type ShipmentDetail,
  type ShipmentLine,
} from '../api/shipmentsApi'
import { AppBar } from '../components/AppBar'
import { Icon } from '../components/Icon'
import { Sheet } from '../components/Sheet'
import { LineFiles } from '../components/LineFiles'
import { PackLineSheet } from '../components/PackLineSheet'
import { fmtDate, variantTitle } from '../utils/format'

function lineTitle(l: ShipmentLine): string {
  return variantTitle(l.product_name, [l.color_name, l.size_name])
}

// Сегментный прогресс упаковки: годный (зелёный) + брак (красный) к плану.
// `left` — остаток на упаковке без решения (из available_for_pack), не plan−good−defect.
function PackMeter({ good, defect, plan, left }: { good: number; defect: number; plan: number; left: number }) {
  const gw = plan > 0 ? Math.min(100, (good / plan) * 100) : 0
  const dw = plan > 0 ? Math.min(100 - gw, (defect / plan) * 100) : 0
  const done = left === 0
  return (
    <div className="pmeter">
      <div className="pmeter-track">
        {good > 0 && <span className="seg-good" style={{ width: `${gw}%` }} />}
        {defect > 0 && <span className="seg-defect" style={{ width: `${dw}%` }} />}
      </div>
      <div className="pmeter-row">
        <div className="pmeter-counts">
          <b className="good">{good}</b> годн <span className="faint">·</span>{' '}
          <b className={defect > 0 ? 'defect' : 'faint'}>{defect}</b> брак{' '}
          <span className="faint">· план {plan}</span>
        </div>
        {done ? (
          <span className="badge success"><Icon name="check" size={12} /> Готово</span>
        ) : (
          <span className="badge warning">осталось {left}</span>
        )}
      </div>
    </div>
  )
}

export function ShiftPackingDetailScreen({ shipmentId, focus }: { shipmentId: string; focus?: PackFocus }) {
  const { back } = useNav()
  const [doc, setDoc] = useState<ShipmentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [packLine, setPackLine] = useState<ShipmentLine | null>(null)
  const [confirmAdvance, setConfirmAdvance] = useState(false)

  const load = useCallback((signal?: AbortSignal) => {
    setError('')
    return getShipment(shipmentId, signal)
      .then((d) => { if (!signal?.aborted) setDoc(d) })
      .catch((err) => { if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Не удалось загрузить задачу') })
      .finally(() => { if (!signal?.aborted) setLoading(false) })
  }, [shipmentId])

  useEffect(() => {
    const ac = new AbortController()
    load(ac.signal)
    return () => ac.abort()
  }, [load])

  const reloadAc = useRef<AbortController | null>(null)
  const reload = useCallback(() => {
    reloadAc.current?.abort()
    const ac = new AbortController()
    reloadAc.current = ac
    return load(ac.signal)
  }, [load])
  useEffect(() => () => reloadAc.current?.abort(), [])

  // Стабильный request_id на «Передать кладовщику» (идемпотентность при обрыве сети).
  const advanceReqId = useRef<string>('')
  function advanceId(): string {
    return (advanceReqId.current ||= newRequestId())
  }

  const totalPool = useMemo(
    () => (doc?.lines ?? []).reduce((s, l) => s + Math.max(0, l.available_for_pack), 0),
    [doc],
  )

  // Переход со скана: подсветить и проскроллить строку отсканированного варианта.
  const focusLineId = useMemo(() => {
    if (!focus || !doc) return null
    const l = doc.lines.find(
      (l) =>
        l.product_id === focus.productId &&
        (l.color_id ?? null) === (focus.colorId ?? null) &&
        (l.size_id ?? null) === (focus.sizeId ?? null),
    )
    return l?.id ?? null
  }, [focus, doc])
  const focusScrolled = useRef(false)
  const focusRef = useCallback((el: HTMLDivElement | null) => {
    if (el && !focusScrolled.current) {
      focusScrolled.current = true
      el.scrollIntoView({ block: 'center' })
    }
  }, [])

  async function doAdvance() {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      await advanceShipment(shipmentId, advanceId())
      advanceReqId.current = ''
      setConfirmAdvance(false)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось передать кладовщику')
    } finally {
      setSaving(false)
    }
  }

  const onPacking = doc?.status === 'on_packing'

  return (
    <div className="screen">
      <AppBar
        title={doc ? doc.doc_number : 'Упаковка'}
        sub={doc ? `${doc.cargo_type === 'defect' ? 'Брак' : 'Упаковка'} · ${SHIPMENT_STATUS_LABELS[doc.status]}` : undefined}
        onBack={back}
        noProfile
      />

      <div className="scroll pad-nav">
        {error && !doc && (
          <div className="alert">
            <Icon name="alert" size={15} />
            {error}
          </div>
        )}

        {loading && !doc ? (
          <div className="center">
            <div className="spin" />
            <div>Загрузка…</div>
          </div>
        ) : !doc ? null : (
          <>
            <div className="summary">
              <div className="kv">
                <span className="k">Клиент</span>
                <span className="v">{doc.client_name ?? '—'}</span>
              </div>
              <div className="kv">
                <span className="k">Дата отгрузки</span>
                <span className="v">{fmtDate(doc.ship_date)}</span>
              </div>
            </div>
            {doc.repack_active && (
              <div className="tzcard">
                <div className="tztitle"><Icon name="refresh" size={12} /> Переупаковка</div>
                <div className="tzbody">
                  Задачу переделываем{doc.repack_reason ? `: ${doc.repack_reason}` : ''}. Сверьтесь с обновлённым ТЗ.
                </div>
              </div>
            )}
            {doc.comment && (
              <div className="tzcard">
                <div className="tztitle"><Icon name="file" size={12} /> Техническое задание</div>
                <div className="tzbody">{doc.comment}</div>
              </div>
            )}

            {onPacking ? (
              <>
                <div className="sec">
                  Упаковка — годный / брак
                  <span className="sec-count">{doc.lines.length}</span>
                </div>
                {doc.lines.map((l) => (
                  <div
                    key={l.id}
                    className={`line${l.id === focusLineId ? ' focus-flash' : ''}`}
                    ref={l.id === focusLineId ? focusRef : undefined}
                  >
                    <div className="line-name">{lineTitle(l)}</div>
                    <div className="line-sub mono">{l.product_sku}</div>
                    <LineFiles files={l.files} onError={setError} />
                    <PackMeter
                      good={l.packed_good}
                      defect={l.packed_defect}
                      plan={l.qty}
                      left={l.available_for_pack}
                    />
                    <button className="btn sm" style={{ width: '100%', marginTop: 4 }} onClick={() => setPackLine(l)}>
                      <Icon name="edit" size={15} /> Внести упаковку
                    </button>
                  </div>
                ))}
                <div className="actionbar">
                  {error && (
                    <div className="alert">
                      <Icon name="alert" size={15} />
                      {error}
                    </div>
                  )}
                  {totalPool > 0 && (
                    <div className="line-sub" style={{ color: 'var(--c-warning)', textAlign: 'center' }}>
                      На упаковке ещё {totalPool} шт без решения
                    </div>
                  )}
                  <button className="btn" disabled={saving} onClick={() => setConfirmAdvance(true)}>
                    <Icon name="check" size={18} /> Передать кладовщику
                  </button>
                </div>
              </>
            ) : doc.status === 'packing' ? (
              <div className="center">
                <div className="center-ico">
                  <Icon name="dolly" size={26} />
                </div>
                <div>Кладовщик перемещает товар в зону упаковки.</div>
                <div className="line-sub">Внести годный/брак можно, когда задача дойдёт до «На упаковке».</div>
              </div>
            ) : doc.status === 'relocating' ? (
              <>
                <div className="infocard">
                  <div className="infocard-ico">
                    <Icon name="layers" size={20} />
                  </div>
                  <div className="infocard-body">
                    <div className="infocard-title">Кладовщик раскладывает по местам</div>
                    <div className="infocard-sub">Упаковка завершена · ваше участие не требуется</div>
                  </div>
                </div>
                <div className="sec">
                  Упаковано
                  <span className="sec-count">{doc.lines.length}</span>
                </div>
                {doc.lines.map((l) => (
                  <div key={l.id} className="line">
                    <div className="line-name">{lineTitle(l)}</div>
                    <div className="line-sub mono">{l.product_sku}</div>
                    <div className="line-sub">
                      годный <b style={{ color: 'var(--c-success)' }}>{l.packed_good}</b> · брак{' '}
                      <b style={{ color: l.packed_defect > 0 ? 'var(--c-danger)' : 'var(--c-text-faint)' }}>{l.packed_defect}</b>
                    </div>
                  </div>
                ))}
              </>
            ) : (
              <div className="center">
                <div className="center-ico green">
                  <Icon name="check" size={26} />
                </div>
                <div>{SHIPMENT_STATUS_LABELS[doc.status]}</div>
              </div>
            )}
          </>
        )}
      </div>

      {packLine && (
        <PackLineSheet
          docId={shipmentId}
          line={packLine}
          onClose={() => setPackLine(null)}
          onDone={reload}
        />
      )}

      {confirmAdvance && (
        <Sheet onClose={() => setConfirmAdvance(false)} locked={saving}>
          <h3>Передать кладовщику?</h3>
          <p className="line-sub" style={{ fontSize: 13, marginTop: 0 }}>
            Упаковка завершена. Кладовщик разложит годный и брак по местам.
            {totalPool > 0 ? ` На упаковке ещё ${totalPool} шт без решения.` : ''}
          </p>
          <div className="dtf-actions">
            <button className="btn ghost" disabled={saving} onClick={() => setConfirmAdvance(false)}>
              Отмена
            </button>
            <button className="btn" disabled={saving} onClick={() => void doAdvance()}>
              {saving ? <span className="spin spin-sm" /> : 'Передать'}
            </button>
          </div>
        </Sheet>
      )}
    </div>
  )
}
