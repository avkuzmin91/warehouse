// === Рейсы поступления — общие блоки редизайна ===
// Дизайн-идея: рейс = путь машины. Карточка строится как ПРОЦЕСС с фазами,
// у каждой фазы — свой ответственный (менеджер / кладовщик), своё время и
// свой статус (активна / заполнит позже / завершена). Никаких «голых»
// селектов и свалки полей в одну сетку.

const { useState: useSt } = React;

// ─────────────────────────────────────────────────────────────
// Справочники и мок-данные
// ─────────────────────────────────────────────────────────────
const ORIGINS = [
  { id: 'w1', name: 'Москва · Чёрная Грязь' },
  { id: 'w2', name: 'СПб · Шушары' },
  { id: 'w3', name: 'Екатеринбург · Кольцово' },
  { id: 'w4', name: 'Новосибирск · Пашино' },
];
const CARRIERS = [
  { id: 'c1', name: 'ТК «Деловые Линии»' },
  { id: 'c2', name: 'Байкал-Сервис' },
  { id: 'c3', name: 'ИП Соколов А. В.' },
  { id: 'c4', name: 'ПЭК' },
];
const VEHICLES = [
  { id: 'v1', name: 'Тент', icon: 'truckIn' },
  { id: 'v2', name: 'Рефрижератор', icon: 'snow' },
  { id: 'v3', name: 'Изотерм', icon: 'box' },
  { id: 'v4', name: 'Бортовой', icon: 'truckOut' },
];

const RECEIPT_RU = {
  planned: 'В плане', on_intake: 'На приёмке', on_review: 'На проверке', done: 'Принято',
};
const RECEIPT_TONE = {
  planned: '', on_intake: 'info', on_review: 'warning', done: 'success',
};

// Поступления, привязанные к рейсу TR-00012
const TRIP_RECEIPTS = [
  { id: 'r1', number: 'WH-00231', client: 'ООО «Мангуст»', sku: 5, qty: 270, status: 'on_intake' },
  { id: 'r2', number: 'WH-00232', client: 'ИП Лебедева Е. К.', sku: 2, qty: 80, status: 'on_intake' },
  { id: 'r3', number: 'WH-00235', client: 'ООО «СпортЛайн»', sku: 8, qty: 412, status: 'planned' },
];
// Поступления-кандидаты (в статусе «В плане») для привязки в черновике
const AVAILABLE_RECEIPTS = [
  { id: 'a1', number: 'WH-00238', client: 'ООО «Текстиль-Юг»', sku: 4, qty: 190, eta: '03 июн' },
  { id: 'a2', number: 'WH-00240', client: 'ИП Громов', sku: 1, qty: 36, eta: '04 июн' },
  { id: 'a3', number: 'WH-00241', client: 'ООО «Аметист»', sku: 6, qty: 305, eta: '04 июн' },
];

// Шапка рейса
const TRIP = {
  number: 'TR-00012',
  origin: 'Москва · Чёрная Грязь',
  carrier: 'ТК «Деловые Линии»',
  vehicle: 'Тент', vehicleIcon: 'truckIn',
  orderedAt: '02 июн, 11:40',
  eta: '03 июн, 14:00',
  estimate: 48000,
  comment: 'Догруз по пути от трёх клиентов. Разгрузка с торца, ворота №4.',
  arrivedAt: '03 июн, 14:20',
  unloadFinishedAt: '03 июн, 15:05',
  unloadMinutes: 45,
  loadFactor: 'full',
  actual: 52000,
  waitingCost: 6000,
  waitingMinutes: 40,
};

// Метки времени для процессной шкалы (по статусам)
const TRIP_TS = {
  draft: '02 июн, 11:30',
  awaiting_arrival: '02 июн, 16:30',
  unloading: '03 июн, 14:20',
  costing: '03 июн, 15:05',
  closed: '03 июн, 18:10',
};

const STATUS_ORDER = ['draft', 'awaiting_arrival', 'unloading', 'costing', 'closed'];
const STATUS_META = {
  draft:            { title: 'Планирование',         short: 'Черновик',           role: 'Менеджер',  icon: 'edit' },
  awaiting_arrival: { title: 'Ожидает прибытия',      short: 'Ожидает прибытия',   role: 'Кладовщик', icon: 'clock' },
  unloading:        { title: 'Разгрузка',             short: 'Разгрузка',          role: 'Кладовщик', icon: 'forklift' },
  costing:          { title: 'Уточнение стоимости',   short: 'Уточнение стоимости', role: 'Менеджер', icon: 'ruble' },
  closed:           { title: 'Закрыт',                short: 'Закрыт',             role: '—',         icon: 'check' },
};

// ─────────────────────────────────────────────────────────────
// Базовые элементы
// ─────────────────────────────────────────────────────────────
const Badge = ({ tone = '', children, dot }) => (
  <span className={`badge ${tone}`}>{dot && <span className="dot" />}{children}</span>
);

const money = (v) => (v == null ? '—' : `${v.toLocaleString('ru-RU')} ₽`);

// Роль-чип: менеджер (индиго) / кладовщик (синий). Цвет кодирует, КТО владеет шагом.
const RoleChip = ({ role, faded }) => {
  const map = {
    'Менеджер':  { ic: 'user', color: 'var(--c-accent)',  bg: 'var(--c-accent-bg)' },
    'Кладовщик': { ic: 'forklift', color: 'var(--c-info)', bg: 'var(--c-info-bg)' },
  };
  const m = map[role];
  if (!m) return null;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, height: 20, padding: '0 8px 0 6px',
      borderRadius: 99, fontSize: 11.5, fontWeight: 500,
      color: faded ? 'var(--c-text-subtle)' : m.color,
      background: faded ? 'var(--c-bg-sunken)' : m.bg,
    }}>
      <Icon name={m.ic} size={12} />{role}
    </span>
  );
};

// ─────────────────────────────────────────────────────────────
// Процессная шкала — вертикальный таймлайн фаз с ролями и временем.
// Заменяет горизонтальный stepper: видно ПУТЬ рейса и ПЕРЕДАЧИ между людьми.
// ─────────────────────────────────────────────────────────────
const ProcessRail = ({ status }) => {
  const curIdx = STATUS_ORDER.indexOf(status);
  return (
    <div style={{ padding: '6px 4px' }}>
      {STATUS_ORDER.map((s, i) => {
        const m = STATUS_META[s];
        const state = i < curIdx ? 'done' : i === curIdx ? 'active' : 'future';
        const ts = TRIP_TS[s];
        const last = i === STATUS_ORDER.length - 1;
        const dotColor = state === 'done' ? 'var(--c-success)'
          : state === 'active' ? (m.role === 'Кладовщик' ? 'var(--c-info)' : 'var(--c-accent)')
          : 'var(--c-border-strong)';
        return (
          <div key={s} style={{ display: 'flex', gap: 12, position: 'relative' }}>
            {/* линия + узел */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 22 }}>
              <div style={{
                width: 22, height: 22, borderRadius: 99, flexShrink: 0, zIndex: 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: state === 'future' ? 'var(--c-bg-elev)' : dotColor,
                border: state === 'future' ? '1.5px dashed var(--c-border-strong)' : `1.5px solid ${dotColor}`,
                color: state === 'future' ? 'var(--c-text-faint)' : '#fff',
                boxShadow: state === 'active' ? `0 0 0 4px color-mix(in oklab, ${dotColor} 16%, transparent)` : 'none',
              }}>
                {state === 'done' ? <Icon name="check" size={11} />
                  : <Icon name={m.icon} size={11} />}
              </div>
              {!last && <div style={{ width: 2, flex: 1, minHeight: 26,
                background: i < curIdx ? 'var(--c-success)' : 'var(--c-border)' }} />}
            </div>
            {/* контент */}
            <div style={{ paddingBottom: last ? 0 : 16, flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: state === 'active' ? 600 : 500,
                  color: state === 'future' ? 'var(--c-text-subtle)' : 'var(--c-text)' }}>{m.title}</span>
                {state === 'active' && <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.04em',
                  textTransform: 'uppercase', color: dotColor }}>сейчас</span>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
                {m.role !== '—' && <RoleChip role={m.role} faded={state === 'future'} />}
                <span className="mono" style={{ fontSize: 11, color: 'var(--c-text-subtle)' }}>
                  {state === 'future' ? '—' : ts}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Фазовый блок — секция формы с заголовком, ролью и состоянием.
// state: 'active' (заполняется сейчас) · 'locked' (заполнит позже) ·
//        'done' (готово, read-only).
// ─────────────────────────────────────────────────────────────
const PhaseBlock = ({ icon, title, role, state = 'active', hint, children }) => {
  const accent = role === 'Кладовщик' ? 'var(--c-info)' : 'var(--c-accent)';
  const isLocked = state === 'locked';
  return (
    <div style={{
      border: `1px solid ${state === 'active' ? accent : 'var(--c-border)'}`,
      borderRadius: 'var(--r-lg)', background: 'var(--c-bg-elev)', overflow: 'hidden',
      boxShadow: state === 'active' ? `0 0 0 3px color-mix(in oklab, ${accent} 8%, transparent)` : 'none',
      opacity: isLocked ? 0.72 : 1,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 9, padding: '11px 14px',
        borderBottom: '1px solid var(--c-border)',
        background: state === 'active' ? `color-mix(in oklab, ${accent} 5%, var(--c-bg-elev))` : 'var(--c-bg-sunken)',
      }}>
        <div style={{
          width: 24, height: 24, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: state === 'done' ? 'var(--c-success-bg)' : isLocked ? 'var(--c-bg-active)' : `color-mix(in oklab, ${accent} 14%, transparent)`,
          color: state === 'done' ? 'var(--c-success)' : isLocked ? 'var(--c-text-faint)' : accent, flexShrink: 0,
        }}>
          {state === 'done' ? <Icon name="check" size={13} /> : isLocked ? <Icon name="lock" size={12} /> : <Icon name={icon} size={14} />}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.2 }}>{title}</div>
          {hint && <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', marginTop: 1 }}>{hint}</div>}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {state === 'done' && <span style={{ fontSize: 11.5, color: 'var(--c-success)', fontWeight: 500 }}>готово</span>}
          {role && <RoleChip role={role} faded={isLocked} />}
        </div>
      </div>
      <div style={{ padding: '14px' }}>{children}</div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Поля
// ─────────────────────────────────────────────────────────────
const FieldLabel = ({ children, required }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
    <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--c-text-muted)' }}>{children}</span>
    {required && <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--c-text-faint)' }}>обяз.</span>}
  </div>
);

const ctrlStyle = (empty) => ({
  display: 'flex', alignItems: 'center', gap: 8, width: '100%', height: 34,
  padding: '0 10px', borderRadius: 'var(--r-md)', cursor: 'pointer',
  border: '1px solid var(--c-border-strong)', background: 'var(--c-bg-elev)',
  fontSize: 13, color: empty ? 'var(--c-text-subtle)' : 'var(--c-text)', textAlign: 'left',
});

// Селект-кнопка с поповером (опции + иконки). Заменяет голый <select>.
const SelectField = ({ value, options, placeholder, leadIcon, onChange }) => {
  const [open, setOpen] = useSt(false);
  const sel = options.find((o) => o.name === value || o.id === value);
  const label = sel ? sel.name : null;
  return (
    <div style={{ position: 'relative' }}>
      <button style={ctrlStyle(!label)} onClick={() => setOpen((o) => !o)}>
        {leadIcon && <Icon name={sel?.icon || leadIcon} size={14} style={{ color: 'var(--c-text-subtle)', flexShrink: 0 }} />}
        <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label || placeholder}</span>
        <Icon name="chevDown" size={13} style={{ color: 'var(--c-text-faint)', flexShrink: 0 }} />
      </button>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setOpen(false)} />
          <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 50, minWidth: 200,
            background: 'var(--c-bg-elev)', border: '1px solid var(--c-border)', borderRadius: 'var(--r-md)',
            boxShadow: 'var(--sh-3)', padding: 4, maxHeight: 240, overflowY: 'auto' }}>
            {options.map((o) => (
              <button key={o.id} onClick={() => { onChange && onChange(o.name); setOpen(false); }}
                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 8px', border: 0,
                  borderRadius: 'var(--r-sm)', background: (o.name === value) ? 'var(--c-bg-hover)' : 'transparent',
                  fontSize: 12.5, color: 'var(--c-text)', cursor: 'pointer', textAlign: 'left' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--c-bg-hover)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = (o.name === value) ? 'var(--c-bg-hover)' : 'transparent')}>
                {o.icon && <Icon name={o.icon} size={14} style={{ color: 'var(--c-text-subtle)' }} />}
                <span style={{ flex: 1 }}>{o.name}</span>
                {o.name === value && <Icon name="check" size={13} style={{ color: 'var(--c-accent)' }} />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

// Поле даты/времени — стилизованный контрол с иконкой (мок: статичное значение).
const TimeField = ({ value, placeholder = 'Выбрать дату' }) => (
  <div style={ctrlStyle(!value)}>
    <Icon name="calendar" size={14} style={{ color: 'var(--c-text-subtle)', flexShrink: 0 }} />
    <span className={value ? 'mono' : ''} style={{ flex: 1, fontSize: value ? 12.5 : 13 }}>{value || placeholder}</span>
  </div>
);

// Денежное поле — ввод с ₽-суффиксом, моноширинный, по правому краю.
const MoneyField = ({ value, onChange, placeholder = '0' }) => (
  <div style={{ display: 'flex', alignItems: 'center', height: 34, padding: '0 10px', borderRadius: 'var(--r-md)',
    border: '1px solid var(--c-border-strong)', background: 'var(--c-bg-elev)' }}>
    <input value={value} placeholder={placeholder}
      onChange={(e) => onChange && onChange(e.target.value.replace(/[^\d]/g, ''))}
      style={{ flex: 1, border: 0, outline: 'none', background: 'transparent', fontFamily: 'var(--font-mono)',
        fontSize: 13.5, fontWeight: 500, textAlign: 'right', fontVariantNumeric: 'tabular-nums', minWidth: 0,
        color: 'var(--c-text)' }} />
    <span style={{ marginLeft: 6, color: 'var(--c-text-subtle)', fontSize: 13 }}>₽</span>
  </div>
);

// Read-only пара «ключ → значение» для завершённых фаз.
const ReadRow = ({ label, children, mono, strong }) => (
  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, padding: '5px 0' }}>
    <span style={{ fontSize: 12.5, color: 'var(--c-text-muted)' }}>{label}</span>
    <span className={mono ? 'mono' : ''} style={{ fontSize: mono ? 12.5 : 13, fontWeight: strong ? 600 : 500,
      color: 'var(--c-text)', textAlign: 'right' }}>{children}</span>
  </div>
);

// Сегментированный переключатель (загруженность, состояния).
const Segmented = ({ value, options, onChange }) => (
  <div style={{ display: 'inline-flex', gap: 3, padding: 3, background: 'var(--c-bg-sunken)', borderRadius: 8 }}>
    {options.map((o) => {
      const on = o.value === value;
      return (
        <button key={o.value} onClick={() => onChange && onChange(o.value)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', border: 0, cursor: 'pointer',
            borderRadius: 6, fontSize: 12.5, fontWeight: 500, fontFamily: 'inherit',
            background: on ? 'var(--c-bg-elev)' : 'transparent', color: on ? 'var(--c-text)' : 'var(--c-text-muted)',
            boxShadow: on ? 'var(--sh-1)' : 'none' }}>
          {o.icon && <Icon name={o.icon} size={13} />}{o.label}
        </button>
      );
    })}
  </div>
);

// Карточка привязанного поступления.
const ReceiptCard = ({ r, removable, onRemove }) => (
  <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 11px' }}>
    <div style={{ width: 30, height: 30, borderRadius: 7, background: 'var(--c-bg-sunken)', flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--c-text-subtle)' }}>
      <Icon name="inbox" size={15} />
    </div>
    <div style={{ minWidth: 0, flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontWeight: 500, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.client}</span>
        <span className="mono" style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', flexShrink: 0 }}>{r.number}</span>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', marginTop: 1 }}>
        {r.sku} SKU · {r.qty} шт{r.eta ? ` · прибытие ${r.eta}` : ''}
      </div>
    </div>
    {r.status && <Badge tone={RECEIPT_TONE[r.status]} dot>{RECEIPT_RU[r.status]}</Badge>}
    {removable && (
      <button className="btn ghost icon sm" title="Отвязать" onClick={onRemove}><Icon name="x" size={13} /></button>
    )}
  </div>
);

// Денежный «леджер» рейса: план → факт + простой → итого.
const CostLedger = ({ estimate, actual, waiting, showActual }) => {
  const total = (actual || 0) + (waiting || 0);
  const delta = (actual != null && estimate != null) ? actual - estimate : null;
  return (
    <div style={{ padding: '4px 2px' }}>
      <ReadRow label="Логистика (план)" mono>{money(estimate)}</ReadRow>
      {showActual ? (
        <>
          <ReadRow label="Логистика (факт)" mono>{money(actual)}</ReadRow>
          <ReadRow label="Простой" mono>{money(waiting)}</ReadRow>
          {delta != null && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '2px 0 6px' }}>
              <span style={{ fontSize: 11, fontWeight: 600,
                color: delta > 0 ? 'var(--c-danger)' : delta < 0 ? 'var(--c-success)' : 'var(--c-text-faint)' }}>
                {delta > 0 ? `▲ +${money(delta)} к плану` : delta < 0 ? `▼ ${money(delta)} к плану` : '= по плану'}
              </span>
            </div>
          )}
          <div style={{ borderTop: '1px solid var(--c-border)', marginTop: 4, paddingTop: 6 }}>
            <ReadRow label="Итого по рейсу" mono strong>{money(total)}</ReadRow>
          </div>
        </>
      ) : (
        <div style={{ marginTop: 4, fontSize: 11.5, color: 'var(--c-text-faint)' }}>
          Факт и простой внесёт менеджер после разгрузки.
        </div>
      )}
    </div>
  );
};

// Карточка-обёртка для правой колонки / секций.
const Panel = ({ icon, iconColor = 'var(--c-accent)', title, right, children, bodyPad = true }) => (
  <div className="card">
    <div className="card-head">
      {icon && <Icon name={icon} size={15} style={{ color: iconColor }} />}
      <span className="card-head-title">{title}</span>
      {right && <span style={{ marginLeft: 'auto' }}>{right}</span>}
    </div>
    <div style={{ padding: bodyPad ? 14 : 0 }}>{children}</div>
  </div>
);

// Контекстная главная кнопка + подсказка о передаче.
const PrimaryAction = ({ icon, label, hint, tone = 'primary', onClick }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
    <button className={`btn lg ${tone}`} onClick={onClick}>
      <Icon name={icon} size={15} />{label}
    </button>
    {hint && <span style={{ fontSize: 11.5, color: 'var(--c-text-subtle)' }}>{hint}</span>}
  </div>
);

// Хедер карточки рейса.
const TripHeader = ({ status, action }) => {
  const m = STATUS_META[status];
  const tone = { draft: '', awaiting_arrival: 'info', unloading: 'info', costing: 'warning', closed: 'success' }[status];
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16,
      paddingBottom: 16, marginBottom: 18, borderBottom: '1px solid var(--c-border)' }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <button className="btn ghost icon sm"><Icon name="arrowLeft" size={14} /></button>
          <Badge tone={tone} dot>{m.short}</Badge>
          {m.role !== '—' && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--c-text-muted)' }}>
              <span style={{ color: 'var(--c-text-faint)' }}>·</span> сейчас у: <RoleChip role={m.role} />
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em', fontFamily: 'var(--font-mono)' }}>{TRIP.number}</span>
          <span style={{ fontSize: 13, color: 'var(--c-text-muted)' }}>Рейс поступления</span>
        </div>
      </div>
      {action}
    </div>
  );
};

Object.assign(window, {
  ORIGINS, CARRIERS, VEHICLES, RECEIPT_RU, RECEIPT_TONE, TRIP_RECEIPTS, AVAILABLE_RECEIPTS, TRIP, TRIP_TS,
  STATUS_ORDER, STATUS_META, money,
  Badge, RoleChip, ProcessRail, PhaseBlock, FieldLabel, SelectField, TimeField, MoneyField, ReadRow,
  Segmented, ReceiptCard, CostLedger, Panel, PrimaryAction, TripHeader,
});
