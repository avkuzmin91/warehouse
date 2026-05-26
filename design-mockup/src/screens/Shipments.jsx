// === Shipments (Отгрузки) ===
const ShipmentsScreen = ({ onNavigate }) => {
  const [view, setView] = React.useState('table'); // 'table' | 'kanban'

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Отгрузки</div>
          <div className="page-subtitle">Сборка заказов, упаковка, отправка перевозчику</div>
        </div>
        <div className="row gap-8">
          <div style={{display: 'flex', background: 'var(--c-bg-sunken)', padding: 3, borderRadius: 6}}>
            <button
              onClick={() => setView('table')}
              className="btn ghost sm"
              style={{background: view === 'table' ? 'var(--c-bg-elev)' : 'transparent', boxShadow: view === 'table' ? 'var(--sh-1)' : 'none'}}
            ><Icon name="list" size={13}/>Список</button>
            <button
              onClick={() => setView('kanban')}
              className="btn ghost sm"
              style={{background: view === 'kanban' ? 'var(--c-bg-elev)' : 'transparent', boxShadow: view === 'kanban' ? 'var(--sh-1)' : 'none'}}
            ><Icon name="grid" size={13}/>Канбан</button>
          </div>
          <button className="btn primary" onClick={() => onNavigate('shipmentCreate')}><Icon name="plus" size={14}/>Новая отгрузка</button>
        </div>
      </div>

      <div className="filters">
        <div className="topbar-search" style={{flex: '0 0 240px', height: 28}}>
          <Icon name="search" size={13}/><span style={{flex: 1}}>Поиск…</span>
        </div>
        <FilterChip label="Клиент" onClick={() => {}}/>
        <FilterChip label="Маркетплейс" onClick={() => {}}/>
        <FilterChip label="Перевозчик" onClick={() => {}}/>
        <FilterChip label="Срочные" active onClick={() => {}}/>
      </div>

      {view === 'table' ? (
        <div className="t-wrap">
          <table className="t">
            <thead>
              <tr>
                <th style={{width: 30}}><Checkbox/></th>
                <th style={{width: 110}}>Номер</th>
                <th>Клиент</th>
                <th>Назначение</th>
                <th style={{width: 150}}>Дата</th>
                <th style={{width: 80, textAlign: 'right'}}>SKU</th>
                <th style={{width: 100, textAlign: 'right'}}>Кол-во</th>
                <th style={{width: 130}}>Перевозчик</th>
                <th style={{width: 120}}>Статус</th>
                <th style={{width: 28}}></th>
              </tr>
            </thead>
            <tbody>
              {D.shipments.map(s => (
                <tr key={s.id}>
                  <td><Checkbox/></td>
                  <td><span className="mono" style={{fontWeight: 500}}>{s.id}</span></td>
                  <td>{s.client}</td>
                  <td><span className="text-sm">{s.dest}</span></td>
                  <td className="muted">{s.date}</td>
                  <td className="num">{s.sku_total}</td>
                  <td className="num">{s.qty_total}</td>
                  <td className="text-sm">{s.courier}</td>
                  <td><Badge tone={statusTone(s.status)} dot>{s.status_label}</Badge></td>
                  <td><button className="btn ghost icon sm"><Icon name="more" size={14}/></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Kanban shipments={D.shipments}/>
      )}
    </div>
  );
};

const Kanban = ({ shipments }) => {
  const cols = [
    { id: 'draft', label: 'Черновик', tone: '' },
    { id: 'packing', label: 'Сборка', tone: 'info' },
    { id: 'ready', label: 'Готово к отгрузке', tone: 'accent' },
    { id: 'shipped', label: 'Отправлено', tone: 'success' },
  ];
  // distribute: include synthetic draft items
  const ext = [
    { id: 'SHP-1209', client: 'Mango Republic', dest: 'WB Электросталь', qty_total: 240, sku_total: 6, courier: '—', status: 'draft', date: '24 мая, утром' },
    { id: 'SHP-1210', client: 'Brutto Studio', dest: 'Ozon Тверь', qty_total: 84, sku_total: 3, courier: '—', status: 'draft', date: '24 мая' },
    ...shipments,
  ];
  const grouped = cols.map(c => ({...c, items: ext.filter(s => s.status === c.id)}));
  return (
    <div style={{display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, alignItems: 'start'}}>
      {grouped.map(g => (
        <div key={g.id} style={{background: 'var(--c-bg-sunken)', borderRadius: 10, padding: 10, minHeight: 200}}>
          <div className="row gap-8" style={{padding: '4px 6px 10px'}}>
            <Badge tone={g.tone} dot>{g.label}</Badge>
            <span className="text-xs subtle" style={{marginLeft: 'auto'}}>{g.items.length}</span>
          </div>
          <div className="col gap-8">
            {g.items.map(s => (
              <div key={s.id} className="card" style={{padding: 10, cursor: 'grab'}}>
                <div className="row gap-8" style={{marginBottom: 6}}>
                  <span className="mono" style={{fontSize: 11.5, fontWeight: 500, color: 'var(--c-text-muted)'}}>{s.id}</span>
                  <span className="text-xs faint" style={{marginLeft: 'auto'}}>{s.date}</span>
                </div>
                <div style={{fontSize: 13, fontWeight: 500, marginBottom: 2}}>{s.client}</div>
                <div className="text-xs subtle" style={{marginBottom: 8}}>{s.dest}</div>
                <div className="row gap-8">
                  <span className="text-xs muted mono">{s.qty_total} шт</span>
                  <span className="text-xs faint">·</span>
                  <span className="text-xs muted">{s.sku_total} SKU</span>
                  <span className="right text-xs subtle">{s.courier}</span>
                </div>
              </div>
            ))}
            <button className="btn ghost sm" style={{justifyContent: 'flex-start', color: 'var(--c-text-subtle)'}}>
              <Icon name="plus" size={12}/>Добавить
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

window.ShipmentsScreen = ShipmentsScreen;
