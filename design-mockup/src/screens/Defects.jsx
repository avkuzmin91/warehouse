// === Defects (Брак) ===
const DefectsScreen = ({ onNavigate }) => {
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Брак</div>
          <div className="page-subtitle">Учёт некондиционного товара по причинам и источникам</div>
        </div>
        <div className="row gap-8">
          <button className="btn"><Icon name="download" size={14}/>Акт о браке</button>
          <button className="btn primary"><Icon name="plus" size={14}/>Зафиксировать</button>
        </div>
      </div>

      <div className="kpi-grid" style={{gridTemplateColumns: 'repeat(4, 1fr)'}}>
        <KPI label="Открыт" value="3" delta="требует решения" deltaDir="down"/>
        <KPI label="Сообщено клиенту" value="2" delta="ждём ответ" deltaDir="up"/>
        <KPI label="Возвращено клиенту" value="2" delta="закрыто" deltaDir="up"/>
        <KPI label="Итого штук" value="39" unit="шт" spark={D.spark(8)}/>
      </div>

      {/* Donut breakdown by reason */}
      <div className="mt-20" style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16}}>
        <div className="card">
          <div className="card-head">
            <Icon name="chart" size={15} style={{color: 'var(--c-accent)'}}/>
            <div className="card-head-title">Причины брака</div>
            <span className="text-xs subtle">за 30 дней</span>
          </div>
          <div className="card-body">
            <ReasonBars/>
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <Icon name="pulse" size={15} style={{color: 'var(--c-accent)'}}/>
            <div className="card-head-title">Брак по клиентам</div>
            <span className="text-xs subtle">% от поступлений</span>
          </div>
          <div className="card-body">
            <ClientBars/>
          </div>
        </div>
      </div>

      <div className="filters mt-20">
        <div className="topbar-search" style={{flex: '0 0 240px', height: 28}}>
          <Icon name="search" size={13}/><span>Поиск…</span>
        </div>
        <FilterChip label="Статус" onClick={() => {}}/>
        <FilterChip label="Причина" onClick={() => {}}/>
        <FilterChip label="Клиент" onClick={() => {}}/>
        <FilterChip label="Источник" value="приёмка" active onClick={() => {}}/>
      </div>

      <div className="t-wrap">
        <table className="t">
          <thead>
            <tr>
              <th style={{width: 30}}><Checkbox/></th>
              <th style={{width: 100}}>ID</th>
              <th>Товар · вариант</th>
              <th style={{width: 140}}>Клиент</th>
              <th style={{width: 70, textAlign: 'right'}}>Кол-во</th>
              <th>Причина</th>
              <th style={{width: 130}}>Источник</th>
              <th style={{width: 130}}>Дата</th>
              <th style={{width: 130}}>Статус</th>
            </tr>
          </thead>
          <tbody>
            {D.defects.map(d => (
              <tr key={d.id}>
                <td><Checkbox/></td>
                <td><span className="mono" style={{fontWeight: 500}}>{d.id}</span></td>
                <td>
                  <div className="row gap-8">
                    <div style={{width: 22, height: 22, borderRadius: 4, background: 'var(--c-warning-bg)', color: 'var(--c-warning)', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                      <Icon name="alert" size={11}/>
                    </div>
                    <div>
                      <div className="mono text-sm" style={{fontWeight: 500}}>{d.sku}</div>
                      <div className="text-xs subtle">{d.variant}</div>
                    </div>
                  </div>
                </td>
                <td className="text-sm">{d.client}</td>
                <td className="num" style={{fontWeight: 500}}>{d.qty}</td>
                <td>{d.reason}</td>
                <td>
                  <span className="mono text-xs" style={{color: 'var(--c-accent)'}}>{d.source}</span>
                </td>
                <td className="text-sm muted">{d.date}</td>
                <td>
                  <Badge tone={statusTone(d.status)} dot>
                    {d.status === 'open' ? 'Открыт' : d.status === 'reported' ? 'Сообщено' : 'Возвращено'}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const ReasonBars = () => {
  const reasons = [
    { name: 'Брак шва', v: 14 },
    { name: 'Пятно на ткани', v: 9 },
    { name: 'Дефект принта', v: 8 },
    { name: 'Не соответствует размеру', v: 8 },
    { name: 'Повреждение упаковки', v: 4 },
    { name: 'Скол / трещина', v: 18 },
  ];
  const max = Math.max(...reasons.map(r => r.v));
  return (
    <div className="col gap-12">
      {reasons.map((r, i) => (
        <div key={r.name}>
          <div className="row gap-8" style={{marginBottom: 4}}>
            <span className="text-sm">{r.name}</span>
            <span className="right mono text-sm muted">{r.v} шт</span>
          </div>
          <div className="prog" style={{height: 8}}>
            <div className="prog-fill" style={{width: `${(r.v/max)*100}%`, background: i === 0 ? 'var(--c-accent)' : i === reasons.length - 1 ? 'var(--c-warning)' : 'var(--c-accent)', opacity: i === 0 ? 1 : i === reasons.length - 1 ? 1 : 0.5 + (r.v/max)*0.5}}/>
          </div>
        </div>
      ))}
    </div>
  );
};

const ClientBars = () => {
  const clients = [
    { name: 'Mango Republic', defect: 12, total: 1840, pct: 0.65 },
    { name: 'Brutto Studio', defect: 8, total: 1240, pct: 0.64 },
    { name: 'Aqua Vita', defect: 18, total: 480, pct: 3.75 },
    { name: 'Lukomorye OOO', defect: 1, total: 215, pct: 0.46 },
    { name: 'Sever Trade', defect: 2, total: 680, pct: 0.29 },
  ];
  return (
    <div className="col gap-12">
      {clients.map(c => (
        <div key={c.name}>
          <div className="row gap-8" style={{marginBottom: 4}}>
            <Avatar initials={c.name[0] + (c.name.split(' ')[1]?.[0] || '')}/>
            <span className="text-sm">{c.name}</span>
            <span className="right text-sm" style={{color: c.pct > 1 ? 'var(--c-warning)' : 'var(--c-text-muted)', fontWeight: 500}}>{c.pct.toFixed(2)}%</span>
          </div>
          <div className="prog" style={{height: 6, marginLeft: 32}}>
            <div className={`prog-fill ${c.pct > 1 ? 'warn' : ''}`} style={{width: `${Math.min(100, c.pct * 25)}%`}}/>
          </div>
        </div>
      ))}
    </div>
  );
};

window.DefectsScreen = DefectsScreen;
