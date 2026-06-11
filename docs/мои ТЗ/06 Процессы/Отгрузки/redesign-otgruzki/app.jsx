// === Канвас: карточка отгрузки — редизайн в стиле рейсов ===

const SHIP_NOTES = [
  { ic: 'route', c: 'var(--c-accent)', t: 'Статусбар → маршрут отгрузки',
    b: 'Горизонтальный степпер заменён вертикальным маршрутом (как процесс рейса): остановки со временем, роль-владелец на каждой, маркер «сейчас» и подсказка, что происходит на шаге. Завершённые шаги показывают метки «Создан → Передан на упаковку → Упакован…».' },
  { ic: 'user', c: 'var(--c-info)', t: 'Три роли закодированы цветом',
    b: 'Менеджер — индиго, кладовщик — синий, начальник смены — янтарный. В шапке «сейчас у: …», у каждого фазового блока — роль-чип. Сразу видно, чей ход и кому уйдёт документ по главной кнопке.' },
  { ic: 'layers', c: 'var(--c-accent)', t: 'Фазовые блоки вместо набора карточек',
    b: 'Основная информация · Состав · Упаковка · Раскладка. Каждая фаза активна (рамка цвета роли), «заполнит позже» (замок с подписью кто и когда) или готова (read-only сводка). Весь путь виден уже при создании.' },
  { ic: 'forklift', c: 'var(--c-info)', t: 'Шторки сохранены, словарь тот же',
    b: '«Передать / Подвезти на упаковку» — выбор мест-источников «на проверке»; «Внести упаковку» — годный/брак с датой и историей записей. Названия кнопок и полей — как в текущем интерфейсе.' },
  { ic: 'check', c: 'var(--c-success)', t: 'Готовность — чек-лист у маршрута',
    b: 'Те же проверки (строки, план, ТЗ, дата, логистика, передача на упаковку) — компактным чек-листом в правой колонке. Причины блокировки — под главной кнопкой, как в рейсах.' },
  { ic: 'truckOut', c: 'var(--c-warning)', t: 'Главная кнопка = передача хода',
    b: 'У каждой кнопки подпись «уйдёт … — статус „…“». «Готово к рейсу» живёт в блоке раскладки и активируется, когда весь годный и брак разложены. На «Ожидает рейс» карточка показывает привязанный рейс.' },
];

const App = () => (
  <DesignCanvas>
    <DCSection id="now" title="Сейчас"
      subtitle="Текущий статусбар — горизонтальный степпер над карточкой">
      <DCArtboard id="before" label="Сейчас · шапка + степпер (что заменяем)" width={1180} height={400}>
        <BeforeScreen />
      </DCArtboard>
    </DCSection>

    <DCSection id="card" title="Карточка отгрузки — путь рейса"
      subtitle="Создание → В плане → На упаковке → Перемещение → Ожидает рейс → Завершён. Роли: менеджер · кладовщик · начальник смены">

      <DCArtboard id="create" label="Создание · менеджер собирает отгрузку" width={1300} height={1150}>
        <CreateScreen />
      </DCArtboard>

      <DCArtboard id="plan" label="В плане · кладовщик передаёт товар на упаковку" width={1300} height={1010}>
        <PlanScreen />
      </DCArtboard>

      <DCArtboard id="drawer-transfer" label="Шторка · Передать на упаковку (откуда берём)" width={560} height={700}>
        <TransferDrawer />
      </DCArtboard>

      <DCArtboard id="packing" label="На упаковке · начальник смены вносит годный и брак" width={1300} height={850}>
        <OnPackingScreen />
      </DCArtboard>

      <DCArtboard id="drawer-pack" label="Шторка · Внести упаковку (годный / брак + история)" width={560} height={760}>
        <PackDrawer />
      </DCArtboard>

      <DCArtboard id="relocating" label="Перемещение · кладовщик раскладывает по местам" width={1300} height={1260}>
        <RelocatingScreen />
      </DCArtboard>

      <DCArtboard id="awaiting" label="Ожидает рейс · привязан TR-00037, спишется при отправке" width={1300} height={815}>
        <AwaitingScreen />
      </DCArtboard>

      <DCArtboard id="shipped" label="Завершён · итоговая карточка-отчёт" width={1300} height={1035}>
        <ShippedScreen />
      </DCArtboard>
    </DCSection>

    <DCSection id="why" title="Принципы редизайна">
      <DCArtboard id="principles" label="Что изменилось и почему" width={1180} height={350}>
        <div style={{ padding: 18, background: 'var(--c-bg)', height: '100%' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {SHIP_NOTES.map((n, i) => (
              <div key={i} className="card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
                  <div style={{ width: 26, height: 26, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: `color-mix(in oklab, ${n.c} 12%, transparent)`, color: n.c }}><Icon name={n.ic} size={15} /></div>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{n.t}</div>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--c-text-muted)', lineHeight: 1.55 }}>{n.b}</div>
              </div>
            ))}
          </div>
        </div>
      </DCArtboard>
    </DCSection>
  </DesignCanvas>
);

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
