// === Balances (Остатки) ===
const BalancesScreen = ({ onNavigate }) => {
  const totals = D.balances.reduce((acc, b) => ({
    total: acc.total + b.total,
    available: acc.available + b.available,
    reserved: acc.reserved + b.reserved,
    defect: acc.defect + b.defect,
  }), { total: 0, available: 0, reserved: 0, defect: 0 });

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Остатки</div>
          <div className="page-subtitle">Доступно для отгрузки · в резерве · брак</div>
        </div>
        <div className="row gap-8">
          <button className="btn"><Icon name="refresh" size={14}/>Инвентаризация</button>
          <button className="btn"><Icon name="download" size={14}/>Экспорт</button>
        </div>
      </div>

      <div className="kpi-grid">
        <KPI label="Всего на складе" value={totals.total.toLocaleString('ru')} unit="шт" spark={D.spark(5)}/>
        <KPI label="Доступно" value={totals.available.toLocaleString('ru')} unit="шт" delta="+218 за день" deltaDir="up"/>
        <KPI label="В резерве" value={totals.reserved.toLocaleString('ru')} unit="шт" delta="−40 за день" deltaDir="down"/>
        <KPI label="Брак" value={totals.defect} unit="шт" delta="требуют разбора" deltaDir="down"/>
      </div>

      <div className="filters mt-20">
        <div className="topbar-search" style={{flex: '0 0 280px', height: 28}}>
          <Icon name="search" size={13}/><span>Поиск по SKU, названию или ячейке…</span>
        </div>
        <FilterChip label="Клиент" value="Mango Republic" active onClick={() => {}}/>
        <FilterChip label="Зона склада" onClick={() => {}}/>
        <FilterChip label="С браком" onClick={() => {}}/>
        <FilterChip label="Только доступно" onClick={() => {}}/>
        <button className="btn ghost sm" style={{marginLeft: 'auto'}}><Icon name="layers" size={13}/>Группировка</button>
      </div>

      <div className="t-wrap">
        <table className="t">
          <thead>
            <tr>
              <th style={{width: 30}}><Checkbox/></th>
              <th>Товар</th>
              <th style={{width: 150}}>Клиент</th>
              <th style={{width: 110}}>Ячейка</th>
              <th style={{width: 90, textAlign: 'right'}}>Всего</th>
              <th style={{width: 110, textAlign: 'right'}}>Доступно</th>
              <th style={{width: 100, textAlign: 'right'}}>Резерв</th>
              <th style={{width: 80, textAlign: 'right'}}>Брак</th>
              <th style={{width: 130}}>Заполнение</th>
              <th style={{width: 130}}>Обновлено</th>
            </tr>
          </thead>
          <tbody>
            {D.balances.map(b => {
              const fill = Math.min(100, Math.round((b.total / 400) * 100));
              return (
                <tr key={b.sku}>
                  <td><Checkbox/></td>
                  <td>
                    <div style={{fontSize: 13, fontWeight: 450}}>{b.name}</div>
                    <div className="text-xs subtle mono">{b.sku}</div>
                  </td>
                  <td className="text-sm">{b.client}</td>
                  <td><span className="mono" style={{fontSize: 12.5, color: 'var(--c-accent-text)', background: 'var(--c-accent-bg)', padding: '1px 6px', borderRadius: 4}}>{b.location}</span></td>
                  <td className="num">{b.total}</td>
                  <td className="num" style={{color: 'var(--c-success)', fontWeight: 500}}>{b.available}</td>
                  <td className="num">{b.reserved || <span className="faint">—</span>}</td>
                  <td className="num">
                    {b.defect > 0 ? <span style={{color: 'var(--c-warning)', fontWeight: 500}}>{b.defect}</span> : <span className="faint">0</span>}
                  </td>
                  <td>
                    <div className="row gap-8">
                      <div className="prog" style={{flex: 1}}>
                        <div className={`prog-fill ${fill > 85 ? 'warn' : ''}`} style={{width: `${fill}%`}}/>
                      </div>
                      <span className="text-xs mono muted" style={{width: 30, textAlign: 'right'}}>{fill}%</span>
                    </div>
                  </td>
                  <td className="text-xs muted">{b.updated}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

window.BalancesScreen = BalancesScreen;
