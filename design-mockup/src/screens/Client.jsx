// === Client cabinet (lightweight view) ===
const ClientScreen = ({ onNavigate }) => {
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="row gap-8" style={{marginBottom: 6}}>
            <Badge tone="accent" dot>Mango Republic</Badge>
            <span className="text-xs subtle">cl-01 · договор № 2024-04</span>
          </div>
          <div className="page-title">Кабинет клиента</div>
          <div className="page-subtitle">Вид от лица клиента — самообслуживание</div>
        </div>
        <div className="row gap-8">
          <button className="btn"><Icon name="file" size={14}/>Запросить акт</button>
          <button className="btn primary"><Icon name="upload" size={14}/>Подать заявку на отгрузку</button>
        </div>
      </div>

      <div className="kpi-grid">
        <KPI label="Остаток на складе" value="30 421" unit="шт" spark={D.spark(11)}/>
        <KPI label="В резерве" value="1 280" unit="шт"/>
        <KPI label="Брак к решению" value="12" unit="шт" delta="оформить возврат" deltaDir="down"/>
        <KPI label="За месяц отгружено" value="8 412" unit="шт" delta="+22%" deltaDir="up" spark={D.spark(12)}/>
      </div>

      <div className="mt-20" style={{display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16}}>
        {/* Latest operations */}
        <div className="card">
          <div className="card-head">
            <Icon name="pulse" size={15} style={{color: 'var(--c-accent)'}}/>
            <div className="card-head-title">Последние движения</div>
            <div className="right"><a className="text-xs" style={{color: 'var(--c-accent)', cursor: 'pointer'}}>смотреть все</a></div>
          </div>
          <table className="t">
            <thead>
              <tr>
                <th style={{width: 100}}>Документ</th>
                <th>Товар · вариант</th>
                <th style={{width: 80, textAlign: 'right'}}>Кол-во</th>
                <th style={{width: 100, textAlign: 'right'}}>Тип</th>
                <th style={{width: 130}}>Дата</th>
              </tr>
            </thead>
            <tbody>
              {[
                { doc: 'RCP-0421', name: 'Худи oversize · Графит · XL', qty: '+40', type: 'in', date: '23 мая, 14:32' },
                { doc: 'SHP-1208', name: 'Футболка · Чёрный · M', qty: '−120', type: 'out', date: '23 мая, 12:15' },
                { doc: 'DEF-244', name: 'Футболка · Чёрный · M', qty: '−2', type: 'def', date: '23 мая, 14:48' },
                { doc: 'SHP-1204', name: 'Худи oversize · Бордовый · L', qty: '−84', type: 'out', date: '22 мая, 09:00' },
                { doc: 'RCP-0417', name: 'Футболка · Белый · L', qty: '+220', type: 'in', date: '22 мая, 09:55' },
              ].map((m, i) => (
                <tr key={i}>
                  <td><span className="mono" style={{fontWeight: 500, color: m.type === 'def' ? 'var(--c-warning)' : 'var(--c-text)'}}>{m.doc}</span></td>
                  <td>{m.name}</td>
                  <td className="num" style={{color: m.type === 'in' ? 'var(--c-success)' : m.type === 'def' ? 'var(--c-warning)' : 'var(--c-danger)', fontWeight: 500}}>{m.qty}</td>
                  <td className="num">
                    <Badge tone={m.type === 'in' ? 'success' : m.type === 'def' ? 'warning' : 'info'} dot>
                      {m.type === 'in' ? 'Приёмка' : m.type === 'def' ? 'Брак' : 'Отгрузка'}
                    </Badge>
                  </td>
                  <td className="text-sm muted">{m.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="col gap-16">
          <div className="card">
            <div className="card-head">
              <Icon name="chart" size={15} style={{color: 'var(--c-accent)'}}/>
              <div className="card-head-title">Динамика остатка · 30 дней</div>
            </div>
            <div className="card-body">
              <Sparkline data={D.spark(13, 30)} height={120} fill={true}/>
              <div className="row gap-16 mt-12">
                <div>
                  <div className="text-xs subtle">Начало месяца</div>
                  <div className="mono" style={{fontSize: 14, fontWeight: 500}}>26 048</div>
                </div>
                <div>
                  <div className="text-xs subtle">Сегодня</div>
                  <div className="mono" style={{fontSize: 14, fontWeight: 500, color: 'var(--c-accent)'}}>30 421</div>
                </div>
                <div className="right">
                  <Badge tone="success" dot>+16.8%</Badge>
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <Icon name="file" size={15} style={{color: 'var(--c-accent)'}}/>
              <div className="card-head-title">Документы</div>
            </div>
            <div style={{padding: 8}}>
              {[
                { name: 'Акт сверки · апрель 2026', size: 'PDF · 124 КБ', date: '2 мая' },
                { name: 'Акт о браке · DEF-244', size: 'PDF · 84 КБ', date: '23 мая' },
                { name: 'УПД RCP-0421', size: 'PDF · 218 КБ', date: '23 мая' },
                { name: 'Договор № 2024-04', size: 'PDF · 1.2 МБ', date: '12 янв' },
              ].map(d => (
                <div key={d.name} style={{display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px', borderRadius: 6, cursor: 'pointer'}}
                     onMouseEnter={(e) => e.currentTarget.style.background = 'var(--c-bg-hover)'}
                     onMouseLeave={(e) => e.currentTarget.style.background = ''}>
                  <div style={{width: 26, height: 26, borderRadius: 6, background: 'var(--c-bg-sunken)', color: 'var(--c-text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                    <Icon name="file" size={13}/>
                  </div>
                  <div style={{flex: 1, minWidth: 0}}>
                    <div style={{fontSize: 13, fontWeight: 450}}>{d.name}</div>
                    <div className="text-xs subtle">{d.size} · {d.date}</div>
                  </div>
                  <Icon name="download" size={13} style={{color: 'var(--c-text-subtle)'}}/>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

window.ClientScreen = ClientScreen;
