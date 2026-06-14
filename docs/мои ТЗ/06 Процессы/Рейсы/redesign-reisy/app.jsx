// === Канвас: текущая форма → редизайн форм рейса по состояниям ===

const NOTES = [
  { ic: 'layers', c: 'var(--c-accent)', t: 'Процесс вместо свалки полей',
    b: 'Карточка собрана из фазовых блоков: Планирование · Исполнение · Закрытие. У каждого — состояние: активен (заполняется сейчас), «заполнит позже» (заблокирован с подписью) или «готово» (read-only). Видно весь путь, даже в черновике.' },
  { ic: 'route', c: 'var(--c-info)', t: 'Таймлайн вместо степпера',
    b: 'Вертикальная шкала показывает путь рейса и передачи между людьми: кто владеет шагом (роль-чип), когда он случился, сколько длился. Степпер этого не давал.' },
  { ic: 'user', c: 'var(--c-accent)', t: 'Роли видны и закодированы цветом',
    b: 'Менеджер — индиго, кладовщик — синий. В шапке «сейчас у: …», в блоках — роль-чип. Сразу понятно, чей ход и кому уйдёт рейс по кнопке.' },
  { ic: 'forklift', c: 'var(--c-info)', t: 'Кладовщику — экран «оператор»',
    b: 'Отдельный режим: одно крупное действие («Машина приехала» / «Завершить разгрузку»), загруженность переключателем, список «в машине». Никаких менеджерских полей и сеток.' },
  { ic: 'ruble', c: 'var(--c-accent)', t: 'Живой леджер стоимости',
    b: 'План → факт + простой → итого, с отклонением от плана. Простой — отдельной строкой (это убыток, его хотят видеть), а не зашит в факт.' },
  { ic: 'inbox', c: 'var(--c-warning)', t: 'Нормальные поля и поступления',
    b: 'Селекты с иконками и поповером, ₽-поля, даты с иконкой — вместо голых <select> и datetime-local. Поступления — карточки с клиентом, SKU/шт и статусом, а не ghost-кнопки.' },
];

const App = () => (
  <DesignCanvas>
    <DCSection id="card" title="Карточка рейса — формы по состояниям"
      subtitle="Текущая форма (то, что не нравится) → редизайн: фазовые блоки, роли, таймлайн процесса">

      <DCArtboard id="before" label="Сейчас · создание рейса — свалка полей + голые select/datetime" width={1180} height={680}>
        <BeforeScreen />
      </DCArtboard>

      <DCArtboard id="draft" label="Редизайн · Черновик — менеджер планирует (виден весь путь)" width={1240} height={900}>
        <DraftScreen />
      </DCArtboard>

      <DCArtboard id="operator" label="Редизайн · Кладовщик — экран «оператор» (прибытие / разгрузка)" width={760} height={620}>
        <OperatorScreen />
      </DCArtboard>

      <DCArtboard id="costing" label="Редизайн · Уточнение стоимости — менеджер (факт + простой)" width={1240} height={880}>
        <CostingScreen />
      </DCArtboard>

      <DCArtboard id="closed" label="Редизайн · Закрыт — итоговая карточка-отчёт" width={1240} height={800}>
        <ClosedScreen />
      </DCArtboard>
    </DCSection>

    <DCSection id="ops" title="Список и задачи"
      subtitle="Реестр рейсов и единая очередь «Мои задачи» на Главной">
      <DCArtboard id="list" label="Список рейсов · статусы, перевозчик, план/факт ₽" width={1320} height={580}>
        <ListScreen />
      </DCArtboard>
      <DCArtboard id="tasks" label="Виджет «Мои задачи» · очередь по роли и статусу" width={520} height={440}>
        <MyTasksWidget />
      </DCArtboard>
    </DCSection>

    <DCSection id="why" title="Принципы редизайна">
      <DCArtboard id="principles" label="Что изменилось и почему" width={1180} height={400}>
        <div style={{ padding: 18, background: 'var(--c-bg)', height: '100%' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {NOTES.map((n, i) => (
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
