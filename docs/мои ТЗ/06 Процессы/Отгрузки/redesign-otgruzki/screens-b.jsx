// === Экраны B: На упаковке, шторка упаковки, Перемещение, Ожидает рейс, Завершён ===

// Сводка «Основная информация» для пройденных фаз (read-only)
const InfoDone = ({ withTrip, actual }) => (
  <PhaseBlock icon="file" title="Основная информация" role="Менеджер" state="done">
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
      <ReadField label="Клиент">{SH.client}</ReadField>
      <ReadField label="Рейс">
        {withTrip ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--c-accent)' }}>
            <Icon name="truckOut" size={13} /><span className="mono">{SH.trip}</span>
          </span>
        ) : '—'}
      </ReadField>
      <ReadField label="Тип груза">Годный товар</ReadField>
      <ReadField label="Дата отгрузки (план)" mono>{SH.shipDate}</ReadField>
      <ReadField label="Дата отгрузки (факт)" mono>{actual ? SH.actualShipDate : '—'}</ReadField>
      <ReadField label="Стоимость логистики" mono>{shMoney(SH.logistics)}</ReadField>
      <div style={{ gridColumn: '1 / -1' }}>
        <ReadField label="Техническое задание">{SH.comment}</ReadField>
      </div>
    </div>
  </PhaseBlock>
);

// Свёрнутая сводка состава для пройденных фаз
const LinesDone = ({ title = 'Состав отгрузки' }) => (
  <PhaseBlock icon="boxes" title={title} role="Менеджер" state="done">
    <StatStrip items={[
      { label: 'SKU', value: 3 },
      { label: 'План', value: 500 },
      { label: 'Упаковано', value: 460 },
      { label: 'Годный', value: 442, color: 'var(--c-success)' },
      { label: 'Брак', value: 18, color: 'var(--c-danger)' },
    ]} />
  </PhaseBlock>
);

// ─────────────────────────────────────────────────────────────
// «На упаковке» — начальник смены вносит годный и брак
// ─────────────────────────────────────────────────────────────
const OnPackingScreen = () => (
  <div style={{ padding: 20, background: 'var(--c-bg)', height: '100%' }}>
    <ShipHeader status="on_packing" priority={2} action={
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <button className="btn ghost"><Icon name="layers" size={14} />Журнал <span style={{ opacity: 0.6 }}>(9)</span></button>
        <PrimaryAction icon="forklift" label="Передать кладовщику" hint="уйдёт кладовщику — статус «Перемещение»" />
      </div>
    } />

    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 332px', gap: 18, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <InfoDone />

        <PhaseBlock icon="box" title="Состав отгрузки · упаковка" role="Нач. смены" state="active"
          hint="«Внести упаковку» — количество годного и брака в шторке; при браке кладовщик подвозит товар">
          <ShipTable mode="packing" />
        </PhaseBlock>

        <PhaseBlock icon="archive" title="Раскладка и рейс" role="Кладовщик" state="locked"
          hint="Места хранения и готовность к рейсу — после упаковки">
          <LockedGrid labels={['Места хранения', 'Готово к рейсу']} />
        </PhaseBlock>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <RailPanel status="on_packing" />
        <Panel icon="box" title="Итог упаковки">
          <div style={{ padding: '0 2px' }}>
            <ReadRow label="План" mono>500 шт</ReadRow>
            <ReadRow label="На упаковке" mono>120 шт</ReadRow>
            <ReadRow label="Годный" mono><span style={{ color: 'var(--c-success)' }}>442</span></ReadRow>
            <ReadRow label="Брак" mono><span style={{ color: 'var(--c-danger)' }}>18</span></ReadRow>
            <div style={{ borderTop: '1px solid var(--c-border)', marginTop: 4, paddingTop: 6 }}>
              <ReadRow label="Осталось до плана" mono strong>58 шт</ReadRow>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────
// Шторка «Внести упаковку» — годный и брак с датой
// ─────────────────────────────────────────────────────────────
const PACK_ENTRIES = [
  { date: '08.06', good: 42, defect: 0, by: 'smena@pack-men.ru', reversed: false },
  { date: '07.06', good: 36, defect: 2, by: 'smena@pack-men.ru', reversed: false },
  { date: '07.06', good: 40, defect: 0, by: 'smena@pack-men.ru', reversed: true },
];

const PackDrawer = () => (
  <DrawerFrame
    title="Внести упаковку"
    subtitle="Худи oversize «Forest» · HD-201"
    footer={
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button className="btn ghost">Закрыть</button>
        <button className="btn primary"><Icon name="check" size={14} />Записать</button>
      </div>
    }>
    <StatStrip items={[
      { label: 'План', value: 120 },
      { label: 'На упаковке', value: 40 },
      { label: 'Упаковано', value: '78 / 2', color: 'var(--c-success)', right: true },
    ]} />

    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 12, marginTop: 14,
      borderRadius: 'var(--r-lg)', background: 'var(--c-bg-sunken)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 64, fontSize: 12.5, color: 'var(--c-text-subtle)' }}>Дата</span>
        <div style={{ flex: 1 }}><DateField value="09 июн 2026" /></div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 64, fontSize: 12.5, fontWeight: 600, color: 'var(--c-success)' }}>Годный</span>
        <NumberStep value={36} width={120} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 64, fontSize: 12.5, fontWeight: 600, color: 'var(--c-danger)' }}>Брак</span>
        <NumberStep value={4} width={120} />
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)' }}>
        Годного с учётом записи: 114 из 120 по плану · на упаковке доступно 40 шт
      </div>
    </div>

    <div style={{ marginTop: 20 }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c-text-subtle)', marginBottom: 8 }}>История упаковки</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {PACK_ENTRIES.map((e, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
            borderRadius: 'var(--r-md)', border: '1px solid var(--c-border)', background: 'var(--c-bg-elev)',
            opacity: e.reversed ? 0.55 : 1 }}>
            <span className="mono" style={{ fontSize: 12.5, textDecoration: e.reversed ? 'line-through' : 'none' }}>{e.date}</span>
            <span style={{ fontSize: 12.5, textDecoration: e.reversed ? 'line-through' : 'none' }}>
              {e.good > 0 && <span style={{ color: 'var(--c-success)' }}>+{e.good} годн</span>}
              {e.good > 0 && e.defect > 0 && <span style={{ color: 'var(--c-text-faint)' }}> · </span>}
              {e.defect > 0 && <span style={{ color: 'var(--c-danger)' }}>+{e.defect} брак</span>}
            </span>
            <span style={{ fontSize: 11.5, color: 'var(--c-text-faint)' }}>{e.by}</span>
            <span style={{ marginLeft: 'auto' }}>
              {e.reversed
                ? <span style={{ fontSize: 11.5, color: 'var(--c-text-faint)' }}>Отменено</span>
                : <button className="btn ghost sm"><Icon name="undo" size={12} />Отменить</button>}
            </span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--c-text-subtle)', display: 'flex', alignItems: 'center', gap: 6 }}>
        <Icon name="shield" size={11} />Запись отменяется компенсирующим движением — история не редактируется.
      </div>
    </div>
  </DrawerFrame>
);

// ─────────────────────────────────────────────────────────────
// «Перемещение» — кладовщик раскладывает годный и брак по местам
// ─────────────────────────────────────────────────────────────
const RELOC = [
  { l: SH_LINES[0], good: [{ zone: 'Стеллаж C-04', qty: 50 }, { zone: 'Стеллаж C-05', qty: 28 }], defect: [{ zone: 'Зона брака D-01', qty: 2 }] },
  { l: SH_LINES[1], good: [{ zone: 'Стеллаж A-21', qty: 300 }], defect: [{ zone: 'Зона брака D-01', qty: 12 }] },
  { l: SH_LINES[2], good: [{ zone: null, qty: 64 }], defect: [{ zone: 'Зона брака D-01', qty: 4 }] },
];

const KindBlock = ({ title, tone, target, rows }) => {
  const placed = rows.reduce((s, r) => s + (r.zone ? r.qty : 0), 0);
  const left = target - placed;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 12.5 }}>
        <span style={{ color: tone, fontWeight: 600 }}>{title}</span>
        <span style={{ color: 'var(--c-text-subtle)' }}>план <b className="mono" style={{ color: 'var(--c-text)', fontWeight: 600 }}>{target}</b></span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: left === 0 ? 'var(--c-success)' : 'var(--c-warning)' }}>
          {left === 0 ? 'разложено' : `осталось ${left}`}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <SelectField value={r.zone} placeholder="Выберите место" leadIcon="pin" />
            </div>
            <NumberStep value={r.qty} width={88} />
            <button className="btn ghost icon sm" title="Убрать строку"><Icon name="x" size={13} /></button>
          </div>
        ))}
      </div>
      <button className="btn ghost sm" style={{ marginTop: 8 }}><Icon name="plus" size={12} />Добавить место</button>
    </div>
  );
};

const RelocatingScreen = () => (
  <div style={{ padding: 20, background: 'var(--c-bg)', height: '100%' }}>
    <ShipHeader status="relocating" priority={2} action={
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <button className="btn ghost"><Icon name="layers" size={14} />Журнал <span style={{ opacity: 0.6 }}>(14)</span></button>
      </div>
    } />

    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 332px', gap: 18, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <InfoDone />
        <LinesDone />

        <PhaseBlock icon="archive" title="Раскладка по местам хранения" role="Кладовщик" state="active"
          hint="Разложите весь годный и брак, затем «Готово к рейсу»"
          right={
            <button className="btn sm primary" style={{ opacity: 0.55, cursor: 'default' }}>
              <Icon name="check" size={12} />Готово к рейсу
            </button>
          }>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {RELOC.map((row, i) => (
              <div key={i} style={{ border: '1px solid var(--c-border)', borderRadius: 'var(--r-lg)', padding: 12,
                background: 'var(--c-bg-elev)' }}>
                <div style={{ marginBottom: 10 }}><LineIdentity l={row.l} /></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <KindBlock title="Годный" tone="var(--c-success)" target={row.l.good} rows={row.good} />
                  <KindBlock title="Брак" tone="var(--c-danger)" target={row.l.defect} rows={row.defect} />
                </div>
              </div>
            ))}
          </div>
        </PhaseBlock>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <RailPanel status="relocating" />
        <Panel icon="chart" title="Итог раскладки">
          <div style={{ padding: '0 2px' }}>
            <ReadRow label="Годный" mono><span style={{ color: 'var(--c-success)' }}>442 шт</span></ReadRow>
            <ReadRow label="Брак" mono><span style={{ color: 'var(--c-danger)' }}>18 шт</span></ReadRow>
            <ReadRow label="Разложено" mono>396 из 460</ReadRow>
            <ReadRow label="Мест задействовано" mono>5</ReadRow>
          </div>
        </Panel>
      </div>
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────
// «Ожидает рейс» — товар разложен, ждёт отправки рейса
// ─────────────────────────────────────────────────────────────
const AwaitingScreen = () => (
  <div style={{ padding: 20, background: 'var(--c-bg)', height: '100%' }}>
    <ShipHeader status="awaiting_trip" priority={2} action={
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <button className="btn ghost"><Icon name="layers" size={14} />Журнал <span style={{ opacity: 0.6 }}>(16)</span></button>
        <button className="btn"><Icon name="truckOut" size={14} />Открыть рейс {SH.trip}</button>
      </div>
    } />

    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', marginBottom: 16,
      borderRadius: 'var(--r-lg)', background: 'var(--c-warning-bg)', color: 'var(--c-warning)', fontSize: 13 }}>
      <Icon name="clock" size={15} style={{ flexShrink: 0 }} />
      <span>Товар разложен по местам хранения. Отгрузка ожидает отправки рейса — спишется при отправке привязанного рейса.</span>
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 332px', gap: 18, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <InfoDone withTrip />
        <PhaseBlock icon="boxes" title="Состав отгрузки" role="Менеджер" state="done">
          <ShipTable mode="result" />
        </PhaseBlock>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <RailPanel status="awaiting_trip" />
        <Panel icon="truckOut" title="Рейс отгрузки">
          <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 11px' }}>
            <div style={{ width: 30, height: 30, borderRadius: 7, background: 'var(--c-accent-bg)', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--c-accent)' }}>
              <Icon name="truckOut" size={15} />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span className="mono" style={{ fontWeight: 600, fontSize: 13 }}>{SH.trip}</span>
                <Badge tone="info" dot>Ожидает прибытия</Badge>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', marginTop: 2 }}>
                ТК «Деловые Линии» · отправление 09 июн, 08:00
              </div>
            </div>
          </div>
          <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--c-text-subtle)', lineHeight: 1.5 }}>
            Дата отгрузки (факт) и списание остатков проставятся автоматически при отправке рейса.
          </div>
        </Panel>
      </div>
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────
// «Завершён» — итоговая карточка-отчёт
// ─────────────────────────────────────────────────────────────
const SHIP_OPS = [
  { t: 'Рейс TR-00037 отправлен — остатки списаны', ts: '09 июн, 08:15', by: 'manager@pack-men.ru' },
  { t: 'Готов к рейсу — товар разложен по местам', ts: '07 июн, 11:30', by: 'sklad@pack-men.ru' },
  { t: 'Упакован — передан кладовщику', ts: '06 июн, 16:05', by: 'smena@pack-men.ru' },
  { t: 'Создан', ts: '05 июн, 09:12', by: 'manager@pack-men.ru' },
];

const ShippedScreen = () => (
  <div style={{ padding: 20, background: 'var(--c-bg)', height: '100%' }}>
    <ShipHeader status="shipped" action={
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <button className="btn ghost"><Icon name="layers" size={14} />Журнал <span style={{ opacity: 0.6 }}>(18)</span></button>
        <button className="btn"><Icon name="truckOut" size={14} />Открыть рейс {SH.trip}</button>
      </div>
    } />

    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 332px', gap: 18, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <InfoDone withTrip actual />
        <PhaseBlock icon="boxes" title="Состав отгрузки" role="Менеджер" state="done">
          <ShipTable mode="result" />
        </PhaseBlock>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <RailPanel status="shipped" />
        <Panel icon="chart" title="Итог отгрузки">
          <div style={{ padding: '0 2px' }}>
            <ReadRow label="План" mono>500 шт</ReadRow>
            <ReadRow label="Отгружено годного" mono><span style={{ color: 'var(--c-success)' }}>442 шт</span></ReadRow>
            <ReadRow label="Брак (остался на складе)" mono><span style={{ color: 'var(--c-danger)' }}>18 шт</span></ReadRow>
            <ReadRow label="Логистика для клиента" mono>{shMoney(SH.logistics)}</ReadRow>
            <div style={{ borderTop: '1px solid var(--c-border)', marginTop: 4, paddingTop: 6 }}>
              <ReadRow label="Отгружено" mono strong>09.06.2026</ReadRow>
            </div>
          </div>
        </Panel>
        <Panel icon="layers" title="Журнал" bodyPad={false}>
          <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {SHIP_OPS.map((op, i) => (
              <div key={i} style={{ fontSize: 12.5 }}>
                <div>{op.t}</div>
                <div style={{ fontSize: 11, color: 'var(--c-text-subtle)', marginTop: 1 }}>
                  <span className="mono">{op.ts}</span> · {op.by}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  </div>
);

Object.assign(window, { InfoDone, LinesDone, OnPackingScreen, PackDrawer, KindBlock, RelocatingScreen, AwaitingScreen, ShippedScreen });
