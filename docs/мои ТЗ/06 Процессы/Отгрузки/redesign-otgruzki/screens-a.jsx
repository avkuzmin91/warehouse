// === Экраны A: «Сейчас», Создание, В плане, шторка «Передать на упаковку» ===

// ─────────────────────────────────────────────────────────────
// Общий помощник: «заполнит позже» — сетка заблокированных полей
// ─────────────────────────────────────────────────────────────
const LockedGrid = ({ labels }) => (
  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(labels.length, 3)}, 1fr)`, gap: 14 }}>
    {labels.map((l) => (
      <div key={l}>
        <FieldLabel>{l}</FieldLabel>
        <div style={{ fontSize: 12.5, color: 'var(--c-text-faint)' }}>после</div>
      </div>
    ))}
  </div>
);

// ─────────────────────────────────────────────────────────────
// Таблица состава отгрузки. mode: create · plan · packing · result
// ─────────────────────────────────────────────────────────────
const ShipTable = ({ mode }) => {
  const lines = SH_LINES;
  const planTotal = lines.reduce((s, l) => s + l.qty, 0);
  const poolTotal = lines.reduce((s, l) => s + l.pool, 0);
  const packedTotal = lines.reduce((s, l) => s + l.good + l.defect, 0);
  const editablePlan = mode === 'create' || mode === 'plan';

  return (
    <table className="t" style={{ margin: '0 -14px', width: 'calc(100% + 28px)' }}>
      <thead>
        <tr>
          <th>Товар · вариант</th>
          <th style={{ width: 150 }}>Магазин</th>
          <th style={{ width: editablePlan ? 130 : 90, textAlign: 'right' }}>План отгрузки</th>
          {mode === 'plan' && <th style={{ width: 230 }}>Передача на упаковку</th>}
          {mode === 'packing' && <>
            <th style={{ width: 95, textAlign: 'right' }}>На упаковке</th>
            <th style={{ width: 105, textAlign: 'right' }}>Годный / Брак</th>
            <th style={{ width: 238 }}>Действия упаковки</th>
          </>}
          {mode === 'result' && <th style={{ width: 110, textAlign: 'right' }}>Годный / Брак</th>}
          <th style={{ width: 130, textAlign: 'center' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Icon name="paperclip" size={12} style={{ opacity: 0.7 }} />Файлы
            </span>
          </th>
          {editablePlan && <th style={{ width: 36 }} />}
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.id}>
            <td><LineIdentity l={l} /></td>
            <td>
              {editablePlan ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 28, padding: '0 8px',
                  border: '1px solid var(--c-border-strong)', borderRadius: 'var(--r-md)', background: 'var(--c-bg-elev)',
                  fontSize: 12.5, color: l.store ? 'var(--c-text)' : 'var(--c-text-subtle)' }}>
                  <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.store || 'Без магазина'}</span>
                  <Icon name="chevDown" size={12} style={{ color: 'var(--c-text-faint)', flexShrink: 0 }} />
                </div>
              ) : (
                <span className="t-sub">{l.store || '—'}</span>
              )}
            </td>
            <td style={{ textAlign: 'right' }}>
              {editablePlan ? (
                <span style={{ display: 'inline-flex', justifyContent: 'flex-end' }}><NumberStep value={l.qty} width={100} /></span>
              ) : (
                <span className="num" style={{ fontWeight: 500 }}>{l.qty}</span>
              )}
            </td>

            {mode === 'plan' && (
              <td>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <span className="t-sub" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>
                    На упаковке <b className="num" style={{ color: l.pool > 0 ? 'var(--c-text)' : 'var(--c-text-faint)' }}>{l.pool}</b>
                  </span>
                  <button className="btn ghost sm" title="Передать товар в зону упаковки">
                    <Icon name="forklift" size={12} />Передать
                  </button>
                  {l.pool > 0 && (
                    <button className="btn ghost sm icon" title="Вернуть на проверку (откат передачи)">
                      <Icon name="undo" size={12} />
                    </button>
                  )}
                </div>
              </td>
            )}

            {mode === 'packing' && <>
              <td style={{ textAlign: 'right' }}>
                <span className="num" style={{ color: l.pool > 0 ? 'var(--c-text)' : 'var(--c-text-faint)' }}>{l.pool}</span>
              </td>
              <td style={{ textAlign: 'right' }}><GoodDefect good={l.good} defect={l.defect} /></td>
              <td>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button className="btn primary sm" title="Внести годный/брак с датой упаковки">
                    <Icon name="check" size={12} />Внести упаковку
                  </button>
                  <button className="btn ghost sm" title="Подвезти товар на упаковку">
                    <Icon name="forklift" size={12} />Подвезти
                  </button>
                  {l.pool > 0 && (
                    <button className="btn ghost sm icon" title="Вернуть на проверку">
                      <Icon name="undo" size={12} />
                    </button>
                  )}
                </div>
              </td>
            </>}

            {mode === 'result' && (
              <td style={{ textAlign: 'right' }}><GoodDefect good={l.good} defect={l.defect} /></td>
            )}

            <td style={{ textAlign: 'center' }}><FileChip name={l.file} /></td>
            {editablePlan && (
              <td><button className="btn ghost icon sm"><Icon name="trash" size={13} /></button></td>
            )}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={20} style={{ padding: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 24, padding: '10px 14px',
              background: 'var(--c-bg-sunken)', fontSize: 12.5 }}>
              <span style={{ fontWeight: 700 }}>Итого</span>
              <span style={{ color: 'var(--c-text-subtle)' }}>{lines.length} SKU</span>
              <span style={{ color: 'var(--c-text-subtle)' }}>План <b className="num" style={{ color: 'var(--c-text)' }}>{planTotal}</b></span>
              {(mode === 'plan' || mode === 'packing') && (
                <span style={{ color: 'var(--c-text-subtle)' }}>На упаковке <b className="num" style={{ color: 'var(--c-text)' }}>{poolTotal}</b></span>
              )}
              {(mode === 'packing' || mode === 'result') && (
                <span style={{ color: 'var(--c-text-subtle)' }}>Упаковано <b className="num" style={{ color: 'var(--c-text)' }}>{packedTotal}</b></span>
              )}
            </div>
          </td>
        </tr>
      </tfoot>
    </table>
  );
};

// ─────────────────────────────────────────────────────────────
// «Сейчас» — текущий горизонтальный степпер (что меняем)
// ─────────────────────────────────────────────────────────────
const BeforeScreen = () => (
  <div style={{ padding: 20, background: 'var(--c-bg)', height: '100%' }}>
    <div className="page-header" style={{ alignItems: 'flex-start', paddingBottom: 12 }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <button className="btn ghost icon sm"><Icon name="arrowLeft" size={14} /></button>
          <Badge tone="info" dot>В плане</Badge>
          <span style={{ fontSize: 12.5, color: 'var(--c-text-subtle)' }}>SH-00112 · ООО «Мангуст»</span>
        </div>
        <div className="page-title">SH-00112</div>
      </div>
      <div className="row gap-8">
        <button className="btn ghost"><Icon name="layers" size={14} />Журнал <span style={{ opacity: 0.6 }}>(4)</span></button>
        <button className="btn ghost danger"><Icon name="x" size={14} />Аннулировать</button>
        <button className="btn primary"><Icon name="forklift" size={14} />Передать на упаковку</button>
      </div>
    </div>

    <div className="stepper">
      {SH_ORDER.map((s, i) => {
        const m = SH_META[s];
        const state = i < 1 ? 'done' : i === 1 ? 'active' : '';
        return (
          <div key={s} className={`step ${state}`}>
            <div className="row gap-8">
              <div className="step-num">{state === 'done' ? <Icon name="check" size={11} /> : i + 1}</div>
              <span className="step-value">{state === 'done' ? m.done : m.label}</span>
            </div>
            <div className="step-label">{state === 'done' ? SH_TS[s] : state === 'active' ? 'в процессе' : ' '}</div>
          </div>
        );
      })}
    </div>

    <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, color: 'var(--c-text-muted)' }}>
      <div>· Степпер занимает всю ширину, но не говорит, <b>кто</b> владеет шагом и кому уйдёт документ дальше.</div>
      <div>· Шесть равных ячеек «съедают» место над контентом на каждом статусе — а живут в них одни и те же подписи.</div>
      <div>· Время есть только у завершённых шагов, текущая работа («передайте товар на упаковку») никак не подсказана.</div>
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────
// Создание отгрузки — менеджер собирает документ
// ─────────────────────────────────────────────────────────────
const CreateScreen = () => (
  <div style={{ padding: 20, background: 'var(--c-bg)', height: '100%' }}>
    {/* шапка */}
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16,
      paddingBottom: 16, marginBottom: 18, borderBottom: '1px solid var(--c-border)' }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <button className="btn ghost icon sm"><Icon name="arrowLeft" size={14} /></button>
          <Badge dot>Создание</Badge>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--c-text-muted)' }}>
            <span style={{ color: 'var(--c-text-faint)' }}>·</span> сейчас у: <RoleChip role="Менеджер" />
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em' }}>Новая отгрузка</span>
          <span style={{ fontSize: 13, color: 'var(--c-text-muted)' }}>номер присвоится при сохранении</span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <button className="btn">Отмена</button>
        <PrimaryAction icon="check" label="Запланировать отгрузку" hint="уйдёт кладовщику — статус «В плане»" />
      </div>
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 332px', gap: 18, alignItems: 'start' }}>
      {/* левая колонка — фазы */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <PhaseBlock icon="file" title="Основная информация" role="Менеджер" state="active"
          hint="Тип груза, клиент и задание для команды склада">
          <CargoToggle value="good" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
            <div>
              <FieldLabel required>Клиент</FieldLabel>
              <SelectField value={SH.client} leadIcon="user" />
            </div>
            <div>
              <FieldLabel required>Дата отгрузки (план)</FieldLabel>
              <DateField value="10 июн 2026" />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <FieldLabel required>Стоимость логистики для клиента, ₽</FieldLabel>
              <MoneyField value={null} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <FieldLabel required>Техническое задание</FieldLabel>
              <TextAreaField value={SH.comment} />
            </div>
          </div>
        </PhaseBlock>

        <PhaseBlock icon="boxes" title="Состав отгрузки" role="Менеджер" state="active"
          hint="Товар из остатков клиента · 3 позиции"
          right={<button className="btn sm primary"><Icon name="plus" size={12} />Добавить товар</button>}>
          <ShipTable mode="create" />
        </PhaseBlock>

        <PhaseBlock icon="box" title="Упаковка" role="Нач. смены" state="locked"
          hint="Годный и брак внесёт начальник смены после передачи товара">
          <LockedGrid labels={['На упаковке', 'Годный', 'Брак']} />
        </PhaseBlock>

        <PhaseBlock icon="archive" title="Раскладка и рейс" role="Кладовщик" state="locked"
          hint="Места хранения и готовность к рейсу — после упаковки">
          <LockedGrid labels={['Места хранения', 'Готово к рейсу']} />
        </PhaseBlock>
      </div>

      {/* правая колонка — маршрут + итог + готовность */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <RailPanel status="draft" />
        <Panel icon="chart" title="Итого">
          <div style={{ padding: '0 2px' }}>
            <ReadRow label="SKU" mono>3</ReadRow>
            <ReadRow label="Кол-во" mono strong>500 шт</ReadRow>
            <ReadRow label="Дата (план)" mono>10.06.2026</ReadRow>
            <ReadRow label="Логистика" mono>—</ReadRow>
          </div>
        </Panel>
        <Checklist items={[
          { ok: true,  label: 'Клиент выбран' },
          { ok: true,  label: 'Дата отгрузки (план) указана' },
          { ok: true,  label: 'Техническое задание заполнено' },
          { ok: false, label: 'Стоимость логистики указана' },
          { ok: true,  label: 'Добавлены строки' },
        ]} />
      </div>
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────
// «В плане» — кладовщик передаёт товар на упаковку
// ─────────────────────────────────────────────────────────────
const PlanScreen = () => (
  <div style={{ padding: 20, background: 'var(--c-bg)', height: '100%' }}>
    <ShipHeader status="packing" priority={2} action={
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <button className="btn ghost"><Icon name="layers" size={14} />Журнал <span style={{ opacity: 0.6 }}>(4)</span></button>
        <button className="btn ghost danger"><Icon name="x" size={14} />Аннулировать</button>
        <button className="btn"><Icon name="save" size={14} />Сохранить изменения</button>
        <PrimaryAction icon="forklift" label="Передать на упаковку" hint="уйдёт начальнику смены — статус «На упаковке»" />
      </div>
    } />

    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 332px', gap: 18, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <PhaseBlock icon="file" title="Основная информация" role="Менеджер" state="active"
          hint="План можно править до передачи на упаковку">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <FieldLabel>Клиент</FieldLabel>
              <SelectField value={SH.client} leadIcon="user" locked />
            </div>
            <div>
              <FieldLabel>Рейс</FieldLabel>
              <div style={{ fontSize: 13, fontWeight: 500, minHeight: 34, display: 'flex', alignItems: 'center', color: 'var(--c-text-faint)' }}>—</div>
            </div>
            <div>
              <FieldLabel required>Дата отгрузки (план)</FieldLabel>
              <DateField value="10 июн 2026" />
            </div>
            <div>
              <FieldLabel>Дата отгрузки (факт)</FieldLabel>
              <div style={{ fontSize: 13, fontWeight: 500, minHeight: 34, display: 'flex', alignItems: 'center', color: 'var(--c-text-faint)' }}>
                проставится при отправке рейса
              </div>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <FieldLabel required>Стоимость логистики для клиента, ₽</FieldLabel>
              <MoneyField value={SH.logistics} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <FieldLabel required>Техническое задание</FieldLabel>
              <TextAreaField value={SH.comment} />
            </div>
          </div>
        </PhaseBlock>

        <PhaseBlock icon="forklift" title="Состав отгрузки · передача на упаковку" role="Кладовщик" state="active"
          hint="«Передать» в строке — выбор мест-источников в шторке, перемещение сразу"
          right={<button className="btn sm primary"><Icon name="plus" size={12} />Добавить товар</button>}>
          <ShipTable mode="plan" />
        </PhaseBlock>

        <PhaseBlock icon="box" title="Упаковка" role="Нач. смены" state="locked"
          hint="Годный и брак внесёт начальник смены после передачи товара">
          <LockedGrid labels={['На упаковке', 'Годный', 'Брак']} />
        </PhaseBlock>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <RailPanel status="packing" />
        <Checklist items={[
          { ok: true, label: 'Добавлены строки' },
          { ok: true, label: 'План заполнен' },
          { ok: true, label: 'Дата отгрузки (план) указана' },
          { ok: true, label: 'Стоимость логистики указана' },
          { ok: true, label: 'Товар передан на упаковку' },
        ]} />
        <Panel icon="store" title="Магазины">
          <div style={{ padding: '0 2px' }}>
            <ReadRow label="WB Коледино" mono>120 шт</ReadRow>
            <ReadRow label="Ozon Хоругвино" mono>300 шт</ReadRow>
            <ReadRow label="Без магазина" mono>80 шт</ReadRow>
          </div>
        </Panel>
      </div>
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────
// Шторка «Передать на упаковку» (и она же — «Подвезти»)
// ─────────────────────────────────────────────────────────────
const TransferDrawer = ({ replenish }) => (
  <DrawerFrame
    title={replenish ? 'Подвезти на упаковку' : 'Передать на упаковку'}
    subtitle="Худи oversize «Forest» · HD-201"
    footer={
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12.5, color: 'var(--c-text-subtle)' }}>
          К перемещению <b className="mono" style={{ color: 'var(--c-text)', fontWeight: 600 }}>80</b> шт
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn ghost">Отмена</button>
          <button className="btn primary"><Icon name="forklift" size={14} />{replenish ? 'Подвезти' : 'Передать'}</button>
        </div>
      </div>
    }>
    <StatStrip items={[
      { label: 'План', value: 120 },
      { label: 'На упаковке', value: 40 },
      ...(replenish ? [{ label: 'Упаковано годных', value: 78, color: 'var(--c-success)' }] : []),
      { label: replenish ? 'Не хватает' : 'Осталось передать', value: 80, color: 'var(--c-warning)', right: true },
    ]} />

    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
      {[
        { zone: 'Зона приёмки А-12', avail: 60, qty: 60 },
        { zone: 'Зона проверки B-03', avail: 35, qty: 20 },
      ].map((r, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <SelectField value={r.zone} leadIcon="pin" />
            <div style={{ marginTop: 3, fontSize: 11.5, color: 'var(--c-text-subtle)' }}>
              на проверке {r.avail} шт
            </div>
          </div>
          <NumberStep value={r.qty} width={96} />
          <button className="btn ghost icon sm" style={{ marginTop: 2 }} title="Убрать строку"><Icon name="x" size={13} /></button>
        </div>
      ))}
    </div>
    <button className="btn ghost sm" style={{ marginTop: 12 }}><Icon name="plus" size={12} />Добавить место</button>

    <div style={{ marginTop: 18, padding: '10px 12px', borderRadius: 'var(--r-md)', background: 'var(--c-info-bg)',
      fontSize: 12, color: 'var(--c-info)', lineHeight: 1.5 }}>
      В списке — только места, где у этой позиции есть остаток «на проверке». Перемещение выполняется сразу, без сохранения карточки.
    </div>
  </DrawerFrame>
);

Object.assign(window, { LockedGrid, ShipTable, BeforeScreen, CreateScreen, PlanScreen, TransferDrawer });
