// === Экраны: текущая форма (Сейчас) + редизайн по состояниям рейса ===

const { useState: useScr } = React;

// Обёртка «страница» внутри артборда (фон приложения + отступы).
const Page = ({ children, w = 1180, pad = 24 }) => (
  <div style={{ background: 'var(--c-bg)', height: '100%', overflow: 'hidden' }}>
    <div style={{ padding: pad, maxWidth: w, margin: '0 auto', height: '100%', boxSizing: 'border-box' }}>{children}</div>
  </div>
);

// мини-чеклист «готовность к передаче»
const MiniChecks = ({ items }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
    {items.map((c, i) => (
      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '5px 2px', fontSize: 12.5 }}>
        {c.ok
          ? <span style={{ width: 16, height: 16, borderRadius: 99, background: 'var(--c-success-bg)', color: 'var(--c-success)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="check" size={10} /></span>
          : <span style={{ width: 16, height: 16, borderRadius: 99, border: '1.5px dashed var(--c-text-faint)', flexShrink: 0 }} />}
        <span style={{ color: c.ok ? 'var(--c-text)' : 'var(--c-text-muted)' }}>{c.label}</span>
      </div>
    ))}
  </div>
);

// ════════════════════════════════════════════════════════════
// СЕЙЧАС — текущая форма создания рейса (то, что не нравится)
// ════════════════════════════════════════════════════════════
const BeforeScreen = () => (
  <Page w={1180}>
    {/* header */}
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', paddingBottom: 16, marginBottom: 16 }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <button className="btn ghost icon sm"><Icon name="arrowLeft" size={14} /></button>
          <span style={{ fontSize: 12.5, color: 'var(--c-text-muted)' }}>Новый рейс поступления</span>
        </div>
        <div style={{ fontSize: 20, fontWeight: 600 }}>Новый рейс</div>
      </div>
      <button className="btn primary"><Icon name="check" size={14} />Создать рейс</button>
    </div>

    {/* horizontal stepper */}
    <div className="stepper" style={{ marginBottom: 16 }}>
      {['Черновик', 'Передан', 'Разгрузка', 'Расценён', 'Закрыт'].map((s, i) => (
        <div key={s} className={`step ${i === 0 ? 'active' : ''}`}>
          <div className="row gap-8">
            <div className="step-num">{i + 1}</div>
            <span className="step-value">{s}</span>
          </div>
          <div className="step-label">{i === 0 ? 'в процессе' : ' '}</div>
        </div>
      ))}
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 20, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Транспорт — одна свалка полей */}
        <div className="card">
          <div className="card-head"><Icon name="truckIn" size={15} style={{ color: 'var(--c-accent)' }} /><span className="card-head-title">Транспорт</span></div>
          <div style={{ padding: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              {[['Откуда', ['—', 'Москва · Чёрная Грязь']], ['Перевозчик', ['—', 'ТК «Деловые Линии»']], ['Тип кузова', ['—', 'Тент']]].map(([lab, opts]) => (
                <div key={lab}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--c-text-muted)', marginBottom: 5 }}>{lab}</label>
                  <select className="input" defaultValue={opts[0]}>{opts.map((o) => <option key={o}>{o}</option>)}</select>
                </div>
              ))}
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--c-text-muted)', marginBottom: 5 }}>Стоимость логистики (план), ₽</label>
                <input className="input" type="number" placeholder="0" />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--c-text-muted)', marginBottom: 5 }}>Транспорт заказан</label>
                <input className="input" type="datetime-local" />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--c-text-muted)', marginBottom: 5 }}>Плановое прибытие</label>
                <input className="input" type="datetime-local" />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--c-text-muted)', marginBottom: 5 }}>Комментарий</label>
                <textarea className="input" rows={2} style={{ resize: 'vertical', height: 'auto', padding: 8 }} />
              </div>
            </div>
          </div>
        </div>

        {/* Поступления — ghost-кнопки */}
        <div className="card">
          <div className="card-head"><Icon name="truckIn" size={15} style={{ color: 'var(--c-accent)' }} /><span className="card-head-title">Поступления</span><span className="badge accent" style={{ marginLeft: 6 }}>2</span></div>
          <div style={{ padding: 14 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <input className="input sm" placeholder="Поиск: клиент, номер, поставщик…" style={{ flex: 1 }} />
              <button className="btn sm"><Icon name="plus" size={12} />Создать поступление</button>
            </div>
            {TRIP_RECEIPTS.slice(0, 2).map((r) => (
              <label key={r.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', marginBottom: 6, borderColor: 'var(--c-accent)', background: 'var(--c-accent-bg)' }}>
                <input type="checkbox" defaultChecked />
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}><span style={{ fontWeight: 500, fontSize: 13 }}>{r.client}</span><span className="mono t-sub" style={{ fontSize: 11.5 }}>{r.number}</span></div>
                  <div className="t-sub" style={{ fontSize: 11.5 }}>{r.sku} SKU · {r.qty} шт</div>
                </div>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* readiness */}
      <div className="card">
        <div className="card-head"><Icon name="check" size={15} style={{ color: 'var(--c-success)' }} /><span className="card-head-title">Готовность</span></div>
        <div style={{ padding: '4px 0' }}>
          {[['Пункт отправления указан', false], ['Перевозчик указан', false], ['Тип кузова указан', false], ['Стоимость (план) указана', false], ['Поступлений выбрано: 2', true]].map(([l, ok]) => (
            <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', fontSize: 13 }}>
              {ok ? <span style={{ width: 16, height: 16, borderRadius: 99, background: 'var(--c-success-bg)', color: 'var(--c-success)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="check" size={10} /></span>
                : <span style={{ width: 16, height: 16, borderRadius: 99, border: '1.5px dashed var(--c-text-faint)' }} />}
              <span style={{ color: ok ? 'var(--c-text)' : 'var(--c-text-muted)' }}>{l}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  </Page>
);

// ════════════════════════════════════════════════════════════
// РЕДИЗАЙН · Черновик (менеджер планирует)
// ════════════════════════════════════════════════════════════
const DraftScreen = () => {
  const [f, setF] = useScr({ origin: 'Москва · Чёрная Грязь', carrier: 'ТК «Деловые Линии»', vehicle: 'Тент', estimate: '48000' });
  const drafted = AVAILABLE_RECEIPTS.slice(0, 2).map((r) => ({ ...r, status: 'planned' }));
  return (
    <Page w={1200}>
      <TripHeader status="draft" action={
        <PrimaryAction icon="arrowRight" label="Передать на склад" hint="Рейс уйдёт кладовщику в очередь «Мои задачи»" />
      } />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <PhaseBlock icon="edit" title="Планирование транспорта" role="Менеджер" state="active">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div><FieldLabel required>Откуда</FieldLabel><SelectField value={f.origin} options={ORIGINS} leadIcon="pin" placeholder="Склад отправления" onChange={(v) => setF({ ...f, origin: v })} /></div>
              <div><FieldLabel required>Перевозчик</FieldLabel><SelectField value={f.carrier} options={CARRIERS} leadIcon="route" placeholder="Выбрать из справочника" onChange={(v) => setF({ ...f, carrier: v })} /></div>
              <div><FieldLabel required>Тип кузова</FieldLabel><SelectField value={f.vehicle} options={VEHICLES} leadIcon="truckIn" placeholder="Тент / реф / изотерм…" onChange={(v) => setF({ ...f, vehicle: v })} /></div>
              <div><FieldLabel required>Стоимость логистики (план)</FieldLabel><MoneyField value={f.estimate} onChange={(v) => setF({ ...f, estimate: v })} /></div>
              <div><FieldLabel>Транспорт заказан</FieldLabel><TimeField value="02 июн, 11:40" /></div>
              <div><FieldLabel>Плановое прибытие</FieldLabel><TimeField value="03 июн, 14:00" /></div>
              <div style={{ gridColumn: '1 / -1' }}>
                <FieldLabel>Комментарий</FieldLabel>
                <textarea className="input" rows={2} defaultValue={TRIP.comment} style={{ resize: 'vertical', height: 'auto', padding: '8px 10px', lineHeight: 1.5 }} />
              </div>
            </div>
          </PhaseBlock>

          <Panel icon="inbox" title="Поступления в рейсе" right={<span className="badge accent">{drafted.length}</span>}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {drafted.map((r) => <ReceiptCard key={r.id} r={r} removable />)}
              <button className="dropzone" style={{ padding: 14, fontSize: 12.5, display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center', cursor: 'pointer', marginTop: 2 }}>
                <Icon name="plus" size={14} />Привязать поступление · или создать новое прямо в рейсе
              </button>
            </div>
          </Panel>

          <PhaseBlock icon="forklift" title="Исполнение на складе" role="Кладовщик" state="locked" hint="Заполнит кладовщик, когда машина приедет">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              {['Прибытие', 'Окончание разгрузки', 'Загруженность'].map((l) => (
                <div key={l}><FieldLabel>{l}</FieldLabel><div style={{ height: 34, borderRadius: 'var(--r-md)', border: '1px dashed var(--c-border-strong)', background: 'var(--c-bg-sunken)', display: 'flex', alignItems: 'center', padding: '0 10px', fontSize: 12, color: 'var(--c-text-faint)' }}>после прибытия</div></div>
              ))}
            </div>
          </PhaseBlock>

          <PhaseBlock icon="ruble" title="Закрытие и стоимость" role="Менеджер" state="locked" hint="Внесёте факт после разгрузки">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {['Логистика (факт)', 'Стоимость простоя'].map((l) => (
                <div key={l}><FieldLabel>{l}</FieldLabel><div style={{ height: 34, borderRadius: 'var(--r-md)', border: '1px dashed var(--c-border-strong)', background: 'var(--c-bg-sunken)', display: 'flex', alignItems: 'center', padding: '0 10px', fontSize: 12, color: 'var(--c-text-faint)' }}>после разгрузки</div></div>
              ))}
            </div>
          </PhaseBlock>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Panel icon="route" title="Процесс рейса" bodyPad={false}><div style={{ padding: '10px 12px' }}><ProcessRail status="draft" /></div></Panel>
          <Panel icon="check" iconColor="var(--c-success)" title="Готово к передаче">
            <MiniChecks items={[{ ok: true, label: 'Откуда указано' }, { ok: true, label: 'Перевозчик указан' }, { ok: true, label: 'Тип кузова указан' }, { ok: true, label: 'Стоимость (план) указана' }, { ok: true, label: 'Поступлений: 2' }]} />
          </Panel>
        </div>
      </div>
    </Page>
  );
};

// ════════════════════════════════════════════════════════════
// РЕДИЗАЙН · Экран кладовщика (оператор): ожидает прибытия / разгрузка
// ════════════════════════════════════════════════════════════
const OperatorScreen = () => {
  const [phase, setPhase] = useScr('unloading'); // 'awaiting' | 'unloading'
  const [load, setLoad] = useScr('full');
  const totalQty = TRIP_RECEIPTS.reduce((a, r) => a + r.qty, 0);
  return (
    <Page w={760} pad={20}>
      {/* демо-переключатель состояния */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <span style={{ fontSize: 11, color: 'var(--c-text-faint)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>демо</span>
        <Segmented value={phase} onChange={setPhase} options={[{ value: 'awaiting', label: 'Ожидает прибытия' }, { value: 'unloading', label: 'Разгрузка' }]} />
      </div>

      {/* шапка рейса */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button className="btn ghost icon"><Icon name="arrowLeft" size={15} /></button>
        <span style={{ fontSize: 24, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{TRIP.number}</span>
        <Badge tone="info" dot>{phase === 'awaiting' ? 'Ожидает прибытия' : 'Разгрузка'}</Badge>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 7 }}>
          {[['truckIn', TRIP.vehicle], ['route', 'Деловые Линии'], ['pin', 'Москва']].map(([ic, t]) => (
            <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--c-text-muted)', padding: '4px 9px', background: 'var(--c-bg-elev)', border: '1px solid var(--c-border)', borderRadius: 99 }}><Icon name={ic} size={12} />{t}</span>
          ))}
        </div>
      </div>

      {/* активная задача — крупно */}
      <div style={{ border: '1px solid var(--c-info)', borderRadius: 'var(--r-xl)', background: 'var(--c-bg-elev)', overflow: 'hidden', boxShadow: '0 0 0 3px color-mix(in oklab, var(--c-info) 8%, transparent)', marginBottom: 14 }}>
        <div style={{ padding: '20px 22px' }}>
          {phase === 'awaiting' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
              <div style={{ width: 56, height: 56, borderRadius: 14, background: 'var(--c-info-bg)', color: 'var(--c-info)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="clock" size={26} /></div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 17, fontWeight: 600 }}>Ждём машину</div>
                <div style={{ fontSize: 13, color: 'var(--c-text-muted)', marginTop: 2 }}>Плановое прибытие <b className="mono">03 июн, 14:00</b> · перевозчик подтвердил заказ</div>
              </div>
              <button className="btn primary" style={{ height: 48, fontSize: 15, padding: '0 22px' }}><Icon name="truckIn" size={18} />Машина приехала</button>
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
                <div style={{ width: 56, height: 56, borderRadius: 14, background: 'var(--c-info-bg)', color: 'var(--c-info)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, position: 'relative' }}><Icon name="forklift" size={26} /></div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 17, fontWeight: 600 }}>Идёт разгрузка</div>
                  <div style={{ fontSize: 13, color: 'var(--c-text-muted)', marginTop: 2 }}>Прибыла в <b className="mono">14:20</b> · в работе <b className="mono">45 мин</b></div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--c-border)' }}>
                <div>
                  <FieldLabel>Загруженность машины</FieldLabel>
                  <Segmented value={load} onChange={setLoad} options={[{ value: 'full', label: 'Полная', icon: 'check' }, { value: 'partial', label: 'Неполная', icon: 'alert' }]} />
                </div>
                <button className="btn primary" style={{ height: 48, fontSize: 15, padding: '0 22px' }}><Icon name="check" size={18} />Завершить разгрузку</button>
              </div>
            </div>
          )}
        </div>
        {phase === 'unloading' && (
          <div style={{ padding: '10px 22px', background: 'var(--c-bg-sunken)', borderTop: '1px solid var(--c-border)', fontSize: 12, color: 'var(--c-text-muted)', display: 'flex', alignItems: 'center', gap: 7 }}>
            <Icon name="arrowRight" size={13} style={{ color: 'var(--c-text-subtle)' }} />
            После завершения {TRIP_RECEIPTS.length} поступления уйдут в статус <b>«На приёмке»</b>, а рейс — менеджеру на уточнение стоимости.
          </div>
        )}
      </div>

      {/* в машине */}
      <Panel icon="inbox" title="В машине" right={<span style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>{TRIP_RECEIPTS.length} поступления · <b className="mono" style={{ color: 'var(--c-text)' }}>{totalQty}</b> шт</span>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {TRIP_RECEIPTS.map((r) => <ReceiptCard key={r.id} r={{ ...r, status: null }} />)}
        </div>
      </Panel>
    </Page>
  );
};

// ════════════════════════════════════════════════════════════
// РЕДИЗАЙН · Уточнение стоимости (менеджер)
// ════════════════════════════════════════════════════════════
const CostingScreen = () => {
  const [c, setC] = useScr({ actual: '52000', waiting: '6000', mins: '40' });
  const total = (Number(c.actual) || 0) + (Number(c.waiting) || 0);
  return (
    <Page w={1200}>
      <TripHeader status="costing" action={
        <PrimaryAction icon="check" label="Закрыть рейс" hint="Поступления досчитываются отдельным процессом" />
      } />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <PhaseBlock icon="edit" title="Планирование транспорта" role="Менеджер" state="done">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 28, rowGap: 0 }}>
              <ReadRow label="Откуда">{TRIP.origin}</ReadRow>
              <ReadRow label="Перевозчик">{TRIP.carrier}</ReadRow>
              <ReadRow label="Тип кузова">{TRIP.vehicle}</ReadRow>
              <ReadRow label="Транспорт заказан" mono>{TRIP.orderedAt}</ReadRow>
            </div>
            <button className="btn ghost sm" style={{ marginTop: 8 }}><Icon name="edit" size={12} />Изменить транспорт</button>
          </PhaseBlock>

          <PhaseBlock icon="forklift" title="Исполнение на складе" role="Кладовщик" state="done">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 28 }}>
              <ReadRow label="Прибытие" mono>{TRIP.arrivedAt}</ReadRow>
              <ReadRow label="Окончание разгрузки" mono>{TRIP.unloadFinishedAt}</ReadRow>
              <ReadRow label="Загруженность">Полная</ReadRow>
              <ReadRow label="Длительность разгрузки"><span style={{ color: 'var(--c-info)', fontWeight: 600 }}>{TRIP.unloadMinutes} мин</span></ReadRow>
            </div>
          </PhaseBlock>

          <PhaseBlock icon="ruble" title="Закрытие и стоимость" role="Менеджер" state="active">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, alignItems: 'end' }}>
              <div><FieldLabel required>Логистика (факт)</FieldLabel><MoneyField value={c.actual} onChange={(v) => setC({ ...c, actual: v })} /></div>
              <div><FieldLabel>Стоимость простоя</FieldLabel><MoneyField value={c.waiting} onChange={(v) => setC({ ...c, waiting: v })} /></div>
              <div><FieldLabel>Время простоя, мин</FieldLabel>
                <div style={{ display: 'flex', alignItems: 'center', height: 34, padding: '0 10px', borderRadius: 'var(--r-md)', border: '1px solid var(--c-border-strong)', background: 'var(--c-bg-elev)' }}>
                  <input value={c.mins} onChange={(e) => setC({ ...c, mins: e.target.value.replace(/[^\d]/g, '') })} style={{ flex: 1, border: 0, outline: 'none', background: 'transparent', fontFamily: 'var(--font-mono)', fontSize: 13.5, fontWeight: 500, textAlign: 'right', minWidth: 0 }} />
                  <span style={{ marginLeft: 6, color: 'var(--c-text-subtle)', fontSize: 13 }}>мин</span>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, padding: '10px 14px', background: 'color-mix(in oklab, var(--c-accent) 6%, var(--c-bg-elev))', borderRadius: 'var(--r-md)', border: '1px solid var(--c-accent-border)' }}>
              <Icon name="ruble" size={15} style={{ color: 'var(--c-accent)' }} />
              <span style={{ fontSize: 13, color: 'var(--c-text-muted)' }}>Итого по рейсу</span>
              <span className="mono" style={{ marginLeft: 'auto', fontSize: 18, fontWeight: 600 }}>{money(total)}</span>
            </div>
          </PhaseBlock>

          <Panel icon="inbox" title="Поступления в рейсе" right={<span className="badge accent">{TRIP_RECEIPTS.length}</span>}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>{TRIP_RECEIPTS.map((r) => <ReceiptCard key={r.id} r={r} />)}</div>
          </Panel>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Panel icon="route" title="Процесс рейса" bodyPad={false}><div style={{ padding: '10px 12px' }}><ProcessRail status="costing" /></div></Panel>
          <Panel icon="ruble" title="Стоимость"><CostLedger estimate={TRIP.estimate} actual={Number(c.actual)} waiting={Number(c.waiting)} showActual /></Panel>
          <Journal />
        </div>
      </div>
    </Page>
  );
};

// ════════════════════════════════════════════════════════════
// РЕДИЗАЙН · Закрыт (итоговая read-only карточка-отчёт)
// ════════════════════════════════════════════════════════════
const ClosedScreen = () => {
  const finals = [{ ...TRIP_RECEIPTS[0], status: 'done' }, { ...TRIP_RECEIPTS[1], status: 'on_review' }, { ...TRIP_RECEIPTS[2], status: 'on_review' }];
  const kpis = [
    { label: 'Итого по рейсу', value: money(TRIP.actual + TRIP.waitingCost), ic: 'ruble' },
    { label: 'Разгрузка', value: `${TRIP.unloadMinutes} мин`, ic: 'forklift' },
    { label: 'Простой', value: `${TRIP.waitingMinutes} мин · ${money(TRIP.waitingCost)}`, ic: 'hourglass' },
    { label: 'Загруженность', value: 'Полная', ic: 'check' },
  ];
  return (
    <Page w={1200}>
      <TripHeader status="closed" action={<button className="btn"><Icon name="download" size={14} />Экспорт</button>} />
      {/* KPI band */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        {kpis.map((k) => (
          <div className="kpi" key={k.label}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Icon name={k.ic} size={14} style={{ color: 'var(--c-text-subtle)' }} /><span className="kpi-label">{k.label}</span></div>
            <div className="kpi-value" style={{ fontSize: 21, marginTop: 6 }}>{k.value}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Panel icon="route" title="Маршрут и транспорт">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 28 }}>
              <ReadRow label="Откуда">{TRIP.origin}</ReadRow>
              <ReadRow label="Перевозчик">{TRIP.carrier}</ReadRow>
              <ReadRow label="Тип кузова">{TRIP.vehicle}</ReadRow>
              <ReadRow label="Транспорт заказан" mono>{TRIP.orderedAt}</ReadRow>
              <ReadRow label="Прибытие" mono>{TRIP.arrivedAt}</ReadRow>
              <ReadRow label="Окончание разгрузки" mono>{TRIP.unloadFinishedAt}</ReadRow>
            </div>
          </Panel>
          <Panel icon="inbox" title="Поступления в рейсе" right={<span className="badge accent">{finals.length}</span>}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>{finals.map((r) => <ReceiptCard key={r.id} r={r} />)}</div>
            <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--c-text-subtle)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="alert" size={12} />Рейс закрыт независимо от приёмки — поступления досчитываются своим процессом.
            </div>
          </Panel>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Panel icon="route" title="Процесс рейса" bodyPad={false}><div style={{ padding: '10px 12px' }}><ProcessRail status="closed" /></div></Panel>
          <Panel icon="ruble" title="Стоимость"><CostLedger estimate={TRIP.estimate} actual={TRIP.actual} waiting={TRIP.waitingCost} showActual /></Panel>
          <Journal />
        </div>
      </div>
    </Page>
  );
};

// журнал (правая колонка)
const JOURNAL = [
  { op: 'Рейс создан', who: 'Орлова М. (менеджер)', t: '02 июн, 11:30' },
  { op: 'Передан на склад', who: 'Орлова М.', t: '02 июн, 16:30' },
  { op: 'Прибытие отмечено: 14:20', who: 'Гусев П. (кладовщик)', t: '03 июн, 14:20' },
  { op: 'Разгрузка завершена · загрузка полная', who: 'Гусев П.', t: '03 июн, 15:05' },
  { op: 'Логистика факт: 52 000 ₽ · простой 6 000 ₽', who: 'Орлова М.', t: '03 июн, 17:55' },
];
const Journal = () => (
  <Panel icon="layers" title="Журнал">
    <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
      {JOURNAL.map((j, i) => (
        <div key={i} style={{ display: 'flex', gap: 9 }}>
          <div style={{ width: 6, height: 6, borderRadius: 99, background: 'var(--c-border-strong)', marginTop: 6, flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12.5, lineHeight: 1.35 }}>{j.op}</div>
            <div style={{ fontSize: 11, color: 'var(--c-text-subtle)', marginTop: 1 }}>{j.t} · {j.who}</div>
          </div>
        </div>
      ))}
    </div>
  </Panel>
);

// ════════════════════════════════════════════════════════════
// РЕДИЗАЙН · Список рейсов
// ════════════════════════════════════════════════════════════
const LIST_ROWS = [
  { n: 'TR-00014', st: 'draft', origin: 'СПб · Шушары', carrier: 'ПЭК', veh: 'Тент', clients: 1, rc: 1, eta: '04 июн, 10:00', plan: 22000, fact: null, role: 'Менеджер' },
  { n: 'TR-00013', st: 'awaiting_arrival', origin: 'Екб · Кольцово', carrier: 'Байкал-Сервис', veh: 'Изотерм', clients: 2, rc: 2, eta: '03 июн, 19:30', plan: 31000, fact: null, role: 'Кладовщик' },
  { n: 'TR-00012', st: 'unloading', origin: 'Москва · Чёрная Грязь', carrier: 'Деловые Линии', veh: 'Тент', clients: 3, rc: 3, eta: '03 июн, 14:00', plan: 48000, fact: null, role: 'Кладовщик' },
  { n: 'TR-00011', st: 'costing', origin: 'Москва · Чёрная Грязь', carrier: 'ИП Соколов', veh: 'Рефрижератор', clients: 2, rc: 2, eta: '02 июн, 09:00', plan: 40000, fact: 44000, role: 'Менеджер' },
  { n: 'TR-00010', st: 'closed', origin: 'Новосибирск · Пашино', carrier: 'Байкал-Сервис', veh: 'Тент', clients: 4, rc: 5, eta: '01 июн, 16:00', plan: 61000, fact: 58000, role: '—' },
  { n: 'TR-00009', st: 'closed', origin: 'СПб · Шушары', carrier: 'ПЭК', veh: 'Бортовой', clients: 1, rc: 1, eta: '31 мая, 12:00', plan: 18000, fact: 19500, role: '—' },
];
const ListScreen = () => {
  const [filter, setFilter] = useScr('all');
  const tone = { draft: '', awaiting_arrival: 'info', unloading: 'info', costing: 'warning', closed: 'success' };
  const chips = [['all', 'Все'], ['draft', 'Черновики'], ['awaiting_arrival', 'На складе'], ['costing', 'Уточнение'], ['closed', 'Закрыты']];
  const rows = filter === 'all' ? LIST_ROWS : LIST_ROWS.filter((r) => (filter === 'awaiting_arrival' ? (r.st === 'awaiting_arrival' || r.st === 'unloading') : r.st === filter));
  const kpis = [
    { label: 'Активных рейсов', value: '4', ic: 'truckIn' },
    { label: 'В очереди склада', value: '2', ic: 'forklift' },
    { label: 'Простой за июнь', value: '12 000 ₽', ic: 'hourglass' },
    { label: 'Ср. разгрузка', value: '38 мин', ic: 'clock' },
  ];
  return (
    <Page w={1320}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', paddingBottom: 16, marginBottom: 16 }}>
        <div><div style={{ fontSize: 20, fontWeight: 600 }}>Рейсы</div><div style={{ fontSize: 13, color: 'var(--c-text-muted)', marginTop: 3 }}>Транспортные поездки на склад · поступления</div></div>
        <button className="btn primary"><Icon name="plus" size={14} />Новый рейс</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        {kpis.map((k) => (
          <div className="kpi" key={k.label}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Icon name={k.ic} size={14} style={{ color: 'var(--c-text-subtle)' }} /><span className="kpi-label">{k.label}</span></div>
            <div className="kpi-value" style={{ fontSize: 22, marginTop: 6 }}>{k.value}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center' }}>
        {chips.map(([v, l]) => (
          <button key={v} className={`chip ${filter === v ? 'active' : ''}`} onClick={() => setFilter(v)}>{l}</button>
        ))}
        <div style={{ marginLeft: 'auto' }} />
        <button className="chip"><Icon name="route" size={13} />Перевозчик</button>
        <button className="chip"><Icon name="calendar" size={13} />Период</button>
      </div>
      <div className="t-wrap">
        <table className="t" style={{ tableLayout: 'fixed' }}>
          <thead><tr>
            <th style={{ width: 96 }}>Номер</th>
            <th style={{ width: 150 }}>Статус</th>
            <th>Откуда</th>
            <th style={{ width: 130 }}>Перевозчик</th>
            <th style={{ width: 64, textAlign: 'center' }}>Кли.</th>
            <th style={{ width: 76, textAlign: 'center' }}>Пост.</th>
            <th style={{ width: 110 }}>План. прибытие</th>
            <th style={{ width: 90, textAlign: 'right' }}>План ₽</th>
            <th style={{ width: 90, textAlign: 'right' }}>Факт ₽</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.n}>
                <td className="mono" style={{ fontWeight: 500 }}>{r.n}</td>
                <td><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Badge tone={tone[r.st]} dot>{STATUS_META[r.st].short}</Badge></div></td>
                <td><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Icon name={r.veh === 'Рефрижератор' ? 'snow' : 'truckIn'} size={13} style={{ color: 'var(--c-text-faint)', flexShrink: 0 }} /><span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.origin}</span></div></td>
                <td className="t-sub" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.carrier}</td>
                <td style={{ textAlign: 'center' }} className="mono">{r.clients}</td>
                <td style={{ textAlign: 'center' }} className="mono">{r.rc}</td>
                <td className="mono t-sub" style={{ fontSize: 12 }}>{r.eta}</td>
                <td className="num">{r.plan.toLocaleString('ru-RU')}</td>
                <td className="num" style={{ color: r.fact == null ? 'var(--c-text-faint)' : 'var(--c-text)' }}>{r.fact == null ? '—' : r.fact.toLocaleString('ru-RU')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Page>
  );
};

// ════════════════════════════════════════════════════════════
// РЕДИЗАЙН · Виджет «Мои задачи» (Главная)
// ════════════════════════════════════════════════════════════
const TASKS = [
  { kind: 'unload', icon: 'forklift', title: 'Завершить разгрузку', doc: 'TR-00012', sub: '3 поступления · Деловые Линии', age: '2 ч', overdue: false, role: 'wh' },
  { kind: 'arrive', icon: 'truckIn', title: 'Встретить рейс', doc: 'TR-00013', sub: 'Прибытие 19:30 · Байкал-Сервис', age: 'через 1 ч', overdue: false, role: 'wh' },
  { kind: 'intake', icon: 'inbox', title: 'Принять товары', doc: 'WH-00231', sub: 'ООО «Мангуст» · 270 шт', age: '4 ч', overdue: true, role: 'wh' },
];
const MyTasksWidget = () => (
  <Page w={520} pad={20}>
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 13, color: 'var(--c-text-muted)' }}>Доброе утро, Пётр</div>
      <div style={{ fontSize: 19, fontWeight: 600, marginTop: 2 }}>Мои задачи</div>
    </div>
    <div className="card">
      <div className="card-head">
        <Icon name="userCheck" size={15} style={{ color: 'var(--c-accent)' }} />
        <span className="card-head-title">Сейчас ждёт вас</span>
        <span className="badge accent" style={{ marginLeft: 6 }}>{TASKS.length}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--c-text-subtle)' }}>роль: кладовщик</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {TASKS.map((t, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderTop: i ? '1px solid var(--c-border)' : 'none', cursor: 'pointer' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--c-bg-hover)')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
            <div style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: t.overdue ? 'var(--c-danger-bg)' : 'var(--c-accent-bg)', color: t.overdue ? 'var(--c-danger)' : 'var(--c-accent)' }}>
              <Icon name={t.icon} size={17} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 13.5, fontWeight: 500 }}>{t.title}</span>
                <span className="mono" style={{ fontSize: 11.5, color: 'var(--c-text-subtle)' }}>{t.doc}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--c-text-subtle)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.sub}</div>
            </div>
            <span style={{ fontSize: 11.5, fontWeight: 500, color: t.overdue ? 'var(--c-danger)' : 'var(--c-text-subtle)', display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              {t.overdue && <Icon name="alert" size={12} />}{t.overdue ? 'просрочено' : t.age}
            </span>
            <Icon name="chev" size={14} style={{ color: 'var(--c-text-faint)', flexShrink: 0 }} />
          </div>
        ))}
      </div>
    </div>
    <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--c-text-subtle)', display: 'flex', alignItems: 'center', gap: 6 }}>
      <Icon name="layers" size={12} />Очередь собрана из рейсов и поступлений по статусу и роли · старые сверху.
    </div>
  </Page>
);

Object.assign(window, { BeforeScreen, DraftScreen, OperatorScreen, CostingScreen, ClosedScreen, ListScreen, MyTasksWidget });
