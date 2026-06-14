// === Карточка отгрузки — общие блоки редизайна (в стиле рейсов) ===
// Идея: отгрузка = рейс товара по складу. Статусбар — не горизонтальный
// степпер, а вертикальный маршрут с остановками: у каждой — владелец
// (роль), отметка времени и текущая позиция «сейчас». Форма — фазовые
// блоки с состояниями active / locked / done, как в карточке рейса.

const { useState: useSt } = React;

// ─────────────────────────────────────────────────────────────
// Статусы отгрузки — названия как в shipmentsApi.ts
// ─────────────────────────────────────────────────────────────
const SH_ORDER = ['draft', 'packing', 'on_packing', 'relocating', 'awaiting_trip', 'shipped'];

const SH_META = {
  draft:         { label: 'Создание',     done: 'Создан',               role: 'Менеджер',   icon: 'edit',     tone: '',
                   sub: 'состав, ТЗ и план' },
  packing:       { label: 'В плане',      done: 'Передан на упаковку',  role: 'Кладовщик',  icon: 'forklift', tone: 'info',
                   sub: 'передача товара на упаковку' },
  on_packing:    { label: 'На упаковке',  done: 'Упакован',             role: 'Нач. смены', icon: 'box',      tone: 'info',
                   sub: 'внесение годного и брака' },
  relocating:    { label: 'Перемещение',  done: 'Передан кладовщику',   role: 'Кладовщик',  icon: 'archive',  tone: 'info',
                   sub: 'раскладка по местам хранения' },
  awaiting_trip: { label: 'Ожидает рейс', done: 'Готов к рейсу',        role: 'Менеджер',   icon: 'clock',    tone: 'warning',
                   sub: 'привязка и отправка рейса' },
  shipped:       { label: 'Завершён',     done: 'Завершён',             role: null,         icon: 'truckOut', tone: 'success',
                   sub: 'списан при отправке рейса' },
};

// Отметки времени на маршруте (мок)
const SH_TS = {
  draft: '05 июн, 09:12',
  packing: '05 июн, 10:02',
  on_packing: '05 июн, 13:40',
  relocating: '06 июн, 16:05',
  awaiting_trip: '07 июн, 11:30',
  shipped: '09 июн, 08:15',
};

// Документ (мок)
const SH = {
  number: 'SH-00112',
  client: 'ООО «Мангуст»',
  cargo: 'good',
  shipDate: '10 июн 2026',
  actualShipDate: '09 июн 2026',
  logistics: 36500,
  trip: 'TR-00037',
  comment: 'Упаковать в фирменные пакеты, ШК клеить на пакет. Короба маркировать по магазинам — WB и Ozon раздельно.',
};

// Состав (мок)
const SH_LINES = [
  { id: 'l1', name: 'Худи oversize «Forest»', sku: 'HD-201', color: 'Графит', size: 'L',
    qty: 120, store: 'WB Коледино',   pool: 40, good: 78,  defect: 2,  file: 'шк-hd-201.pdf' },
  { id: 'l2', name: 'Футболка базовая',       sku: 'TS-014', color: 'Белый',  size: 'M',
    qty: 300, store: 'Ozon Хоругвино', pool: 0,  good: 300, defect: 12, file: '2 файла' },
  { id: 'l3', name: 'Водолазка «Norr»',       sku: 'WL-052', color: 'Чёрный', size: 'S',
    qty: 80,  store: null,             pool: 80, good: 64,  defect: 4,  file: null },
];

const shMoney = (v) => (v == null ? '—' : `${v.toLocaleString('ru-RU')} ₽`);

// ─────────────────────────────────────────────────────────────
// Базовые элементы
// ─────────────────────────────────────────────────────────────
const Badge = ({ tone = '', children, dot }) => (
  <span className={`badge ${tone}`}>{dot && <span className="dot" />}{children}</span>
);

// Роль-чип: цвет кодирует владельца шага.
// Менеджер — индиго · Кладовщик — синий · Нач. смены — янтарный.
const ROLE_META = {
  'Менеджер':   { ic: 'user',      color: 'var(--c-accent)',  bg: 'var(--c-accent-bg)' },
  'Кладовщик':  { ic: 'forklift',  color: 'var(--c-info)',    bg: 'var(--c-info-bg)' },
  'Нач. смены': { ic: 'userCheck', color: 'var(--c-warning)', bg: 'var(--c-warning-bg)' },
};
const RoleChip = ({ role, faded }) => {
  const m = ROLE_META[role];
  if (!m) return null;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, height: 20, padding: '0 8px 0 6px',
      borderRadius: 99, fontSize: 11.5, fontWeight: 500, whiteSpace: 'nowrap',
      color: faded ? 'var(--c-text-subtle)' : m.color,
      background: faded ? 'var(--c-bg-sunken)' : m.bg,
    }}>
      <Icon name={m.ic} size={12} />{role}
    </span>
  );
};

const roleAccent = (role) => (ROLE_META[role] ? ROLE_META[role].color : 'var(--c-accent)');

// ─────────────────────────────────────────────────────────────
// НОВЫЙ СТАТУСБАР: «Маршрут отгрузки» — вертикальная шкала, как
// процесс рейса в логистике. Заменяет горизонтальный степпер.
// done → метка завершения (Создан / Передан на упаковку / …) + время,
// active → текущий статус + «сейчас», future → пунктирная остановка.
// ─────────────────────────────────────────────────────────────
const ShipRail = ({ status }) => {
  const isShipped = status === 'shipped';
  const curIdx = SH_ORDER.indexOf(status);
  return (
    <div style={{ padding: '6px 4px' }}>
      {SH_ORDER.map((s, i) => {
        const m = SH_META[s];
        const state = isShipped ? 'done' : i < curIdx ? 'done' : i === curIdx ? 'active' : 'future';
        const last = i === SH_ORDER.length - 1;
        const dotColor = state === 'done' ? 'var(--c-success)'
          : state === 'active' ? roleAccent(m.role)
          : 'var(--c-border-strong)';
        return (
          <div key={s} style={{ display: 'flex', gap: 12, position: 'relative' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 22 }}>
              <div style={{
                width: 22, height: 22, borderRadius: 99, flexShrink: 0, zIndex: 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: state === 'future' ? 'var(--c-bg-elev)' : dotColor,
                border: state === 'future' ? '1.5px dashed var(--c-border-strong)' : `1.5px solid ${dotColor}`,
                color: state === 'future' ? 'var(--c-text-faint)' : '#fff',
                boxShadow: state === 'active' ? `0 0 0 4px color-mix(in oklab, ${dotColor} 16%, transparent)` : 'none',
              }}>
                {state === 'done' ? <Icon name="check" size={11} /> : <Icon name={m.icon} size={11} />}
              </div>
              {!last && <div style={{ width: 2, flex: 1, minHeight: 24,
                background: (isShipped || i < curIdx) ? 'var(--c-success)' : 'var(--c-border)' }} />}
            </div>
            <div style={{ paddingBottom: last ? 0 : 14, flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: state === 'active' ? 600 : 500,
                  color: state === 'future' ? 'var(--c-text-subtle)' : 'var(--c-text)' }}>
                  {state === 'done' ? m.done : m.label}
                </span>
                {state === 'active' && <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.04em',
                  textTransform: 'uppercase', color: dotColor }}>сейчас</span>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
                {m.role && <RoleChip role={m.role} faded={state !== 'active'} />}
                <span className="mono" style={{ fontSize: 11, color: 'var(--c-text-subtle)' }}>
                  {state === 'future' ? '—' : SH_TS[s]}
                </span>
              </div>
              {state === 'active' && (
                <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', marginTop: 3 }}>{m.sub}</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Фазовый блок — как в карточке рейса. accent зависит от роли.
// ─────────────────────────────────────────────────────────────
const PhaseBlock = ({ icon, title, role, state = 'active', hint, right, children }) => {
  const accent = roleAccent(role);
  const isLocked = state === 'locked';
  const isDone = state === 'done';
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
          width: 24, height: 24, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          background: isDone ? 'var(--c-success-bg)' : isLocked ? 'var(--c-bg-active)' : `color-mix(in oklab, ${accent} 14%, transparent)`,
          color: isDone ? 'var(--c-success)' : isLocked ? 'var(--c-text-faint)' : accent,
        }}>
          {isDone ? <Icon name="check" size={13} /> : isLocked ? <Icon name="lock" size={12} /> : <Icon name={icon} size={14} />}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.2 }}>{title}</div>
          {hint && <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', marginTop: 1 }}>{hint}</div>}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {right}
          {isDone && <span style={{ fontSize: 11.5, color: 'var(--c-success)', fontWeight: 500 }}>готово</span>}
          {role && <RoleChip role={role} faded={isLocked} />}
        </div>
      </div>
      <div style={{ padding: 14 }}>{children}</div>
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

const shCtrl = (empty) => ({
  display: 'flex', alignItems: 'center', gap: 8, width: '100%', height: 34,
  padding: '0 10px', borderRadius: 'var(--r-md)',
  border: '1px solid var(--c-border-strong)', background: 'var(--c-bg-elev)',
  fontSize: 13, color: empty ? 'var(--c-text-subtle)' : 'var(--c-text)', textAlign: 'left',
});

// Селект-вид (мок) — с иконкой и шевроном.
const SelectField = ({ value, placeholder, leadIcon, locked }) => (
  <div style={{ ...shCtrl(!value), background: locked ? 'var(--c-bg-sunken)' : 'var(--c-bg-elev)' }}>
    {leadIcon && <Icon name={leadIcon} size={14} style={{ color: 'var(--c-text-subtle)', flexShrink: 0 }} />}
    <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value || placeholder}</span>
    <Icon name={locked ? 'lock' : 'chevDown'} size={13} style={{ color: 'var(--c-text-faint)', flexShrink: 0 }} />
  </div>
);

const DateField = ({ value, placeholder = 'Выбрать дату' }) => (
  <div style={shCtrl(!value)}>
    <Icon name="calendar" size={14} style={{ color: 'var(--c-text-subtle)', flexShrink: 0 }} />
    <span className={value ? 'mono' : ''} style={{ flex: 1, fontSize: value ? 12.5 : 13 }}>{value || placeholder}</span>
  </div>
);

const MoneyField = ({ value }) => (
  <div style={{ display: 'flex', alignItems: 'center', height: 34, padding: '0 10px', borderRadius: 'var(--r-md)',
    border: '1px solid var(--c-border-strong)', background: 'var(--c-bg-elev)' }}>
    <span className="mono" style={{ flex: 1, fontSize: 13.5, fontWeight: 500, textAlign: 'right' }}>
      {value != null ? value.toLocaleString('ru-RU') : ''}
    </span>
    <span style={{ marginLeft: 6, color: 'var(--c-text-subtle)', fontSize: 13 }}>₽</span>
  </div>
);

const TextAreaField = ({ value, placeholder }) => (
  <div style={{ ...shCtrl(!value), height: 'auto', minHeight: 72, alignItems: 'flex-start', padding: '8px 10px', lineHeight: 1.5 }}>
    {value || placeholder}
  </div>
);

const ReadRow = ({ label, children, mono, strong }) => (
  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, padding: '5px 0' }}>
    <span style={{ fontSize: 12.5, color: 'var(--c-text-muted)', whiteSpace: 'nowrap' }}>{label}</span>
    <span className={mono ? 'mono' : ''} style={{ fontSize: mono ? 12.5 : 13, fontWeight: strong ? 600 : 500,
      color: 'var(--c-text)', textAlign: 'right' }}>{children}</span>
  </div>
);

// Read-only значение поля (для done-фаз)
const ReadField = ({ label, children, mono }) => (
  <div>
    <FieldLabel>{label}</FieldLabel>
    <div className={mono ? 'mono' : ''} style={{ fontSize: 13, fontWeight: 500, minHeight: 20 }}>{children || '—'}</div>
  </div>
);

// Числовой степпер (мок)
const NumberStep = ({ value, width = 96, tone }) => (
  <span style={{
    display: 'inline-flex', alignItems: 'stretch', height: 28, width,
    border: `1px solid ${tone === 'warning' ? 'var(--c-warning)' : 'var(--c-border-strong)'}`,
    borderRadius: 'var(--r-md)', background: 'var(--c-bg-elev)', overflow: 'hidden', flexShrink: 0,
  }}>
    <span style={{ width: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--c-text-subtle)', fontSize: 14, borderRight: '1px solid var(--c-border)' }}>−</span>
    <span className="mono" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12.5, fontWeight: 500 }}>{value}</span>
    <span style={{ width: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--c-text-subtle)', fontSize: 14, borderLeft: '1px solid var(--c-border)' }}>+</span>
  </span>
);

// Чип файла в строке состава
const FileChip = ({ name }) => name ? (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, maxWidth: 150, padding: '0 8px',
    borderRadius: 'var(--r-md)', border: '1px solid var(--c-border)', background: 'var(--c-bg-elev)' }}>
    <Icon name="filePdf" size={13} style={{ color: 'var(--c-danger)', flexShrink: 0 }} />
    <span className="mono" style={{ fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
  </span>
) : (
  <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28,
    borderRadius: 'var(--r-md)', border: '1px solid var(--c-border)', color: 'var(--c-accent)' }}>
    <Icon name="upload" size={13} />
  </span>
);

// иконка PDF-файла (нет в базовом наборе — добавляем алиасом)
const FilePdfIcon = () => null;

// Идентичность строки: название + sku · цвет · размер
const LineIdentity = ({ l }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
    <div style={{ width: 26, height: 26, borderRadius: 4, background: 'var(--c-bg-sunken)', flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="box" size={12} style={{ color: 'var(--c-text-muted)' }} />
    </div>
    <div style={{ minWidth: 0 }}>
      <div style={{ fontWeight: 500, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.name}</div>
      <div className="mono" style={{ fontSize: 11.5, color: 'var(--c-text-subtle)' }}>
        {[l.sku, l.color, l.size].filter(Boolean).join(' · ')}
      </div>
    </div>
  </div>
);

const GoodDefect = ({ good, defect }) => (
  <span className="mono" style={{ fontSize: 12.5 }}>
    <b style={{ color: 'var(--c-success)', fontWeight: 600 }}>{good}</b>
    <span style={{ color: 'var(--c-text-faint)' }}> / </span>
    <b style={{ color: defect > 0 ? 'var(--c-danger)' : 'var(--c-text-faint)', fontWeight: 600 }}>{defect}</b>
  </span>
);

// ─────────────────────────────────────────────────────────────
// Панели правой колонки
// ─────────────────────────────────────────────────────────────
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

const RailPanel = ({ status }) => (
  <Panel icon="route" title="Маршрут отгрузки" bodyPad={false}>
    <div style={{ padding: '12px 14px' }}>
      <ShipRail status={status} />
    </div>
  </Panel>
);

// Чек-лист готовности (метки — как в advanceChecks)
const Checklist = ({ items, title = 'Готовность' }) => {
  const allOk = items.every((c) => c.ok);
  return (
    <Panel icon="check" iconColor={allOk ? 'var(--c-success)' : 'var(--c-text-subtle)'} title={title}
      right={<span style={{ fontSize: 12, fontWeight: 600, color: allOk ? 'var(--c-success)' : 'var(--c-warning)' }}>
        {allOk ? 'Готово' : 'Не готово'}</span>}
      bodyPad={false}>
      <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((c, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            {c.ok ? (
              <span style={{ width: 16, height: 16, borderRadius: 99, background: 'var(--c-success)', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon name="check" size={10} />
              </span>
            ) : (
              <span style={{ width: 16, height: 16, borderRadius: 99, border: '1.5px dashed var(--c-border-strong)', flexShrink: 0 }} />
            )}
            <span style={{ fontSize: 12.5, color: c.ok ? 'var(--c-text)' : 'var(--c-text-subtle)' }}>{c.label}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
};

// Главная кнопка шага + подпись «кому уйдёт ход»
const PrimaryAction = ({ icon, label, hint, disabled }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
    <button className="btn lg primary" style={disabled ? { opacity: 0.55, cursor: 'default' } : undefined}>
      <Icon name={icon} size={15} />{label}
    </button>
    {hint && <span style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', textAlign: 'right' }}>{hint}</span>}
  </div>
);

// Причины блокировки под главной кнопкой
const BlockReasons = ({ items }) => (
  <div style={{ fontSize: 12, color: 'var(--c-danger)', textAlign: 'right', lineHeight: 1.6 }}>
    {items.map((r, i) => <div key={i}>· {r}</div>)}
  </div>
);

// ─────────────────────────────────────────────────────────────
// Шапка карточки отгрузки — как TripHeader: бейдж статуса,
// «сейчас у: роль», номер mono, контекстные действия справа.
// ─────────────────────────────────────────────────────────────
const ShipHeader = ({ status, title, subtitle, action, priority }) => {
  const m = SH_META[status];
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16,
      paddingBottom: 16, marginBottom: 18, borderBottom: '1px solid var(--c-border)' }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
          <button className="btn ghost icon sm"><Icon name="arrowLeft" size={14} /></button>
          <Badge tone={m.tone} dot>{m.label}</Badge>
          {priority && (
            <span className="mono" style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--c-warning)',
              background: 'var(--c-warning-bg)', borderRadius: 99, padding: '2px 8px' }}>
              Приоритет {priority}
            </span>
          )}
          {m.role && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--c-text-muted)' }}>
              <span style={{ color: 'var(--c-text-faint)' }}>·</span> сейчас у: <RoleChip role={m.role} />
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em', fontFamily: 'var(--font-mono)' }}>
            {title || SH.number}
          </span>
          <span style={{ fontSize: 13, color: 'var(--c-text-muted)' }}>{subtitle || `Отгрузка · ${SH.client}`}</span>
        </div>
      </div>
      {action}
    </div>
  );
};

// Тип груза — Годный товар / Брак (как CargoTypeToggle)
const CargoToggle = ({ value = 'good' }) => {
  const opts = [
    { key: 'good',   label: 'Годный товар', icon: '✓', accent: 'var(--c-success)', bg: 'var(--c-success-bg)', desc: 'Отгрузка из остатков без дефектов' },
    { key: 'defect', label: 'Брак',         icon: '!', accent: 'var(--c-warning)', bg: 'var(--c-warning-bg)', desc: 'Отгрузка бракованного товара' },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      {opts.map((o) => {
        const on = value === o.key;
        return (
          <div key={o.key} style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '10px 13px', borderRadius: 'var(--r-lg)',
            border: `2px solid ${on ? o.accent : 'var(--c-border)'}`, background: on ? o.bg : 'var(--c-bg)', cursor: 'pointer',
          }}>
            <div style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center',
              justifyContent: 'center', background: on ? o.accent : 'var(--c-bg-sunken)',
              color: on ? '#fff' : 'var(--c-text-muted)', fontWeight: 700, fontSize: 14 }}>{o.icon}</div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13, color: on ? o.accent : 'var(--c-text)' }}>{o.label}</div>
              <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', marginTop: 1 }}>{o.desc}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Шторка (мок для артборда): затемнение слева + панель справа
// ─────────────────────────────────────────────────────────────
const DrawerFrame = ({ title, subtitle, footer, children }) => (
  <div style={{ display: 'flex', height: '100%', background: 'rgba(20,20,15,0.32)' }}>
    <div style={{ width: 56, flexShrink: 0 }} />
    <div style={{ flex: 1, background: 'var(--c-bg-elev)', display: 'flex', flexDirection: 'column',
      boxShadow: '-12px 0 32px -8px rgba(20,20,15,0.25)' }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--c-border)', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{title}</div>
          {subtitle && <div style={{ fontSize: 12.5, color: 'var(--c-text-subtle)', marginTop: 2 }}>{subtitle}</div>}
        </div>
        <button className="btn ghost icon sm"><Icon name="x" size={14} /></button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 18 }}>{children}</div>
      <div style={{ padding: '12px 18px', borderTop: '1px solid var(--c-border)', background: 'var(--c-bg)' }}>{footer}</div>
    </div>
  </div>
);

// Мини-статистика строкой (План · На упаковке · Упаковано …)
const StatStrip = ({ items }) => (
  <div style={{ display: 'flex', gap: 16, fontSize: 12.5, flexWrap: 'wrap' }}>
    {items.map((s, i) => (
      <span key={i} style={{ color: 'var(--c-text-subtle)', marginLeft: s.right ? 'auto' : 0 }}>
        {s.label}{' '}
        <b className="mono" style={{ fontWeight: 600, color: s.color || 'var(--c-text)' }}>{s.value}</b>
      </span>
    ))}
  </div>
);

Object.assign(window, {
  SH, SH_ORDER, SH_META, SH_TS, SH_LINES, shMoney, roleAccent,
  Badge, RoleChip, ShipRail, PhaseBlock, FieldLabel, SelectField, DateField, MoneyField, TextAreaField,
  ReadRow, ReadField, NumberStep, FileChip, LineIdentity, GoodDefect,
  Panel, RailPanel, Checklist, PrimaryAction, BlockReasons, ShipHeader, CargoToggle, DrawerFrame, StatStrip,
});
