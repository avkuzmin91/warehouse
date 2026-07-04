import { useNav } from '../../nav/NavContext'
import { useAuth } from '../../auth/AuthContext'
import { AppBar } from '../../components/AppBar'
import { Icon, type IconName } from '../../components/Icon'
import { canCreateDocuments } from '../../utils/access'

type HubEntry = { label: string; sub: string; icon: IconName; open: () => void }

export function WarehouseHubScreen() {
  const {
    openReceiptsList, openPackingList, openDispatchList,
    openProductsList, openColorsList, openSizesList, openClientsList, openShiftPacking,
    openInvoicesList, openExtraIncome, openExpensesList, openPackingProductivity,
  } = useNav()
  const { user } = useAuth()
  // Начальник склада видит хаб в режиме просмотра: создание документов — у менеджера.
  const viewOnly = !canCreateDocuments(user?.role)

  // Рабочая очередь упаковки (внесение годного/брака) — операция начальника склада:
  // у начальника смены она отдельной вкладкой, у начсклада живёт в хабе.
  const opEntries: HubEntry[] = viewOnly
    ? [{ label: 'Упаковка — в работе', sub: 'Внести годное и брак', icon: 'edit', open: openShiftPacking }]
    : []

  const entries: HubEntry[] = [
    { label: 'Поступления', sub: 'Документы приёмки', icon: 'dolly', open: openReceiptsList },
    { label: 'Упаковка', sub: 'Задачи упаковки', icon: 'box', open: openPackingList },
    { label: 'Отгрузки', sub: 'Документы отгрузки', icon: 'forklift', open: openDispatchList },
  ]

  // Производительность упаковки — read-only сводка для надзора (начальник склада и
  // менеджер); деньги внутри показываются только ролям с доступом к стоимостям.
  const analyticsEntries: HubEntry[] = [
    { label: 'Производительность', sub: 'Упаковано за период', icon: 'chart', open: openPackingProductivity },
  ]

  // Финансы — только менеджер/админ (backend can_manage_finance = те же роли, что и
  // canCreateDocuments); начальник склада финансов не видит.
  const financeEntries: HubEntry[] = viewOnly
    ? []
    : [
        { label: 'Счета', sub: 'Оплаты клиентов', icon: 'file', open: openInvoicesList },
        { label: 'Доп. работы', sub: 'Ручной доход', icon: 'star', open: openExtraIncome },
        { label: 'Расходы', sub: 'Хозрасходы и логистика', icon: 'chart', open: openExpensesList },
      ]

  // Справочники доступны на просмотр всем, кто видит хаб; создание записей внутри
  // экранов гейтится canCreateDocuments (менеджерский состав).
  const catalogEntries: HubEntry[] = [
    { label: 'Товары', sub: 'Карточки товаров', icon: 'tag', open: openProductsList },
    { label: 'Клиенты', sub: 'Справочник клиентов', icon: 'users', open: openClientsList },
    { label: 'Цвета', sub: 'Справочник цветов', icon: 'sparkles', open: openColorsList },
    { label: 'Размеры', sub: 'Справочник размеров', icon: 'layers', open: openSizesList },
  ]

  return (
    <div className="screen">
      <AppBar title="Склад" sub="Документы" />
      <div className="scroll pad-nav">
        {opEntries.length > 0 && (
          <>
            <div className="sec">Операции</div>
            {opEntries.map((e) => (
              <button key={e.label} className="tile" onClick={e.open}>
                <div className="tile-ico">
                  <Icon name={e.icon} size={21} />
                </div>
                <div className="tile-body">
                  <div className="tile-title">{e.label}</div>
                  <div className="tile-meta">{e.sub}</div>
                </div>
                <span className="tile-chev"><Icon name="chev" size={18} /></span>
              </button>
            ))}
          </>
        )}
        {viewOnly && (
          <div className="sec" style={{ marginTop: opEntries.length > 0 ? 16 : 0 }}>
            Документы склада<span className="sec-count">просмотр</span>
          </div>
        )}
        {entries.map((e) => (
          <button key={e.label} className="tile" onClick={e.open}>
            <div className="tile-ico">
              <Icon name={e.icon} size={21} />
            </div>
            <div className="tile-body">
              <div className="tile-title">{e.label}</div>
              <div className="tile-meta">{e.sub}</div>
            </div>
            <span className="tile-chev"><Icon name="chev" size={18} /></span>
          </button>
        ))}

        <div className="sec" style={{ marginTop: 16 }}>Аналитика</div>
        {analyticsEntries.map((e) => (
          <button key={e.label} className="tile" onClick={e.open}>
            <div className="tile-ico">
              <Icon name={e.icon} size={21} />
            </div>
            <div className="tile-body">
              <div className="tile-title">{e.label}</div>
              <div className="tile-meta">{e.sub}</div>
            </div>
            <span className="tile-chev"><Icon name="chev" size={18} /></span>
          </button>
        ))}

        {financeEntries.length > 0 && (
          <>
            <div className="sec" style={{ marginTop: 16 }}>Финансы</div>
            {financeEntries.map((e) => (
              <button key={e.label} className="tile" onClick={e.open}>
                <div className="tile-ico">
                  <Icon name={e.icon} size={21} />
                </div>
                <div className="tile-body">
                  <div className="tile-title">{e.label}</div>
                  <div className="tile-meta">{e.sub}</div>
                </div>
                <span className="tile-chev"><Icon name="chev" size={18} /></span>
              </button>
            ))}
          </>
        )}

        <div className="sec" style={{ marginTop: 16 }}>Справочники</div>
        {catalogEntries.map((e) => (
          <button key={e.label} className="tile" onClick={e.open}>
            <div className="tile-ico">
              <Icon name={e.icon} size={21} />
            </div>
            <div className="tile-body">
              <div className="tile-title">{e.label}</div>
              <div className="tile-meta">{e.sub}</div>
            </div>
            <span className="tile-chev"><Icon name="chev" size={18} /></span>
          </button>
        ))}
        {viewOnly && (
          <div
            className="line-sub"
            style={{ textAlign: 'center', marginTop: 16, color: 'var(--c-text-faint)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          >
            <Icon name="eye" size={13} /> Создание документов — у менеджера
          </div>
        )}
      </div>
    </div>
  )
}
