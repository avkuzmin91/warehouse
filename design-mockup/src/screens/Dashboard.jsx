// === Dashboard / Home ===

const DashboardScreen = ({ onNavigate, role }) => {
  const isClient = role === 'client';

  // Today's stats for non-clients
  const opsStats = [
    { label: 'Поступления сегодня', value: '4', unit: 'шт', delta: '+2 к вчера', dir: 'up', spark: D.spark(1) },
    { label: 'Принято товара', value: '488', unit: 'шт', delta: '+18%', dir: 'up', spark: D.spark(2) },
    { label: 'Отгружено', value: '320', unit: 'шт', delta: '−12%', dir: 'down', spark: D.spark(3) },
    { label: 'Браков зафиксировано', value: '7', unit: '', delta: '+3', dir: 'down', spark: D.spark(4) },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">
            {isClient ? 'Доброе утро, Mango Republic' : 'Сводка по складу MSK-01'}
          </div>
          <div className="page-subtitle">
            {isClient
              ? 'Текущий остаток · движения за неделю · документы'
              : 'Сегодня · 23 мая 2026, пятница'}
          </div>
        </div>
        <div className="row gap-8">
          <button className="btn"><Icon name="download" size={14}/>Экспорт</button>
          <button className="btn primary" onClick={() => onNavigate('receiptCreate')}>
            <Icon name="plus" size={14}/>
            Новое поступление
          </button>
        </div>
      </div>

      {/* KPI grid */}
      <div className="kpi-grid">
        {opsStats.map(s => (
          <KPI key={s.label} {...s} deltaDir={s.dir}/>
        ))}
      </div>

      {/* Two-column area */}
      <div className="mt-20" style={{display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16}}>
        <div className="col gap-16">
          {/* Process queues */}
          <div className="card">
            <div className="card-head">
              <Icon name="pulse" size={15} style={{color: 'var(--c-accent)'}}/>
              <div className="card-head-title">Процессы в работе</div>
              <span className="badge accent" style={{marginLeft: 6}}>5 активных</span>
              <div className="right row gap-8">
                <button className="btn sm ghost" onClick={() => onNavigate('receipts')}>
                  Все поступления
                  <Icon name="arrowRight" size={12}/>
                </button>
              </div>
            </div>
            <div style={{padding: '4px 0'}}>
              {[
                { id: 'RCP-0421', kind: 'in', label: 'Поступление', client: 'Mango Republic', step: 2, total: 4, stepLabel: 'Приёмка', qty: '264 / 488', operator: 'Сергей Д.', icon: 'truckIn' },
                { id: 'SHP-1208', kind: 'out', label: 'Отгрузка', client: 'Lukomorye OOO → Ozon', step: 1, total: 3, stepLabel: 'Сборка', qty: '48 / 320', operator: 'Мария Л.', icon: 'truckOut' },
                { id: 'INV-013', kind: 'inv', label: 'Инвентаризация', client: 'зона A · стеллажи 8–14', step: 3, total: 4, stepLabel: 'Сверка', qty: '418 / 480', operator: 'Павел Г.', icon: 'boxes' },
                { id: 'SHP-1206', kind: 'out', label: 'Отгрузка', client: 'Brutto Studio → Самовывоз', step: 2, total: 3, stepLabel: 'Готово к выдаче', qty: '540 / 540', operator: 'Павел Г.', icon: 'truckOut' },
              ].map(p => (
                <div key={p.id} style={{display: 'grid', gridTemplateColumns: '120px 1fr 160px 1fr 130px 28px', alignItems: 'center', gap: 12, padding: '10px 14px', borderBottom: '1px solid var(--c-border)', cursor: 'pointer'}}
                     onClick={() => onNavigate(p.kind === 'in' ? 'receiptDetail' : p.kind === 'out' ? 'shipments' : 'balances')}>
                  <div className="row gap-8">
                    <Icon name={p.icon} size={14} style={{color: p.kind === 'in' ? 'var(--c-accent)' : p.kind === 'out' ? 'var(--c-info)' : 'var(--c-text-subtle)'}}/>
                    <span className="mono" style={{fontSize: 12.5, fontWeight: 500}}>{p.id}</span>
                  </div>
                  <div>
                    <div style={{fontSize: 13, fontWeight: 500}}>{p.label}</div>
                    <div className="text-xs subtle">{p.client}</div>
                  </div>
                  <div>
                    <div className="text-xs subtle" style={{marginBottom: 4}}>{p.stepLabel} · {p.step}/{p.total}</div>
                    <div className="prog"><div className="prog-fill" style={{width: `${(p.step/p.total)*100}%`}}/></div>
                  </div>
                  <div className="mono" style={{fontSize: 12.5}}>
                    {p.qty}
                  </div>
                  <div className="row gap-8">
                    <Avatar initials={p.operator.split(' ')[0][0] + (p.operator.split(' ')[1]?.[0] || '')}/>
                    <span className="text-xs muted">{p.operator}</span>
                  </div>
                  <Icon name="chev" size={14} style={{color: 'var(--c-text-faint)'}}/>
                </div>
              ))}
            </div>
          </div>

          {/* Warehouse visualization */}
          <div className="card">
            <div className="card-head">
              <Icon name="map" size={15} style={{color: 'var(--c-accent)'}}/>
              <div className="card-head-title">Карта склада · MSK-01</div>
              <span className="text-xs subtle" style={{marginLeft: 6}}>Зоны A–D, 12×8 ячеек</span>
              <div className="right row gap-8">
                <Badge tone="success" dot>1843 ячеек</Badge>
                <Badge tone="warning" dot>14 переполнено</Badge>
                <Badge dot>302 свободно</Badge>
              </div>
            </div>
            <div className="card-body" style={{paddingTop: 0}}>
              <WarehouseMap />
            </div>
          </div>
        </div>

        <div className="col gap-16">
          {/* Quick actions for role */}
          <div className="card">
            <div className="card-head">
              <Icon name="sparkles" size={15} style={{color: 'var(--c-accent)'}}/>
              <div className="card-head-title">Быстрые действия</div>
            </div>
            <div style={{padding: 8}}>
              {[
                { id: 'receipts', icon: 'truckIn', label: 'Принять поступление', sub: 'Создать новый документ' },
                { id: 'shipments', icon: 'truckOut', label: 'Собрать отгрузку', sub: 'По заявке клиента' },
                { id: 'balances', icon: 'qr', label: 'Сканировать товар', sub: 'Найти место и остаток' },
                { id: 'dictionaries', icon: 'plus', label: 'Завести товар', sub: 'Новый SKU или вариант' },
              ].map(a => (
                <div key={a.label} style={{display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px', borderRadius: 6, cursor: 'pointer'}}
                     onClick={() => onNavigate(a.id)}
                     onMouseEnter={(e) => e.currentTarget.style.background = 'var(--c-bg-hover)'}
                     onMouseLeave={(e) => e.currentTarget.style.background = ''}>
                  <div style={{width: 30, height: 30, borderRadius: 6, background: 'var(--c-accent-bg)', color: 'var(--c-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 30px'}}>
                    <Icon name={a.icon} size={15}/>
                  </div>
                  <div style={{flex: 1, minWidth: 0}}>
                    <div style={{fontSize: 13, fontWeight: 500}}>{a.label}</div>
                    <div className="text-xs subtle">{a.sub}</div>
                  </div>
                  <Icon name="chev" size={14} style={{color: 'var(--c-text-faint)'}}/>
                </div>
              ))}
            </div>
          </div>

          {/* Activity feed */}
          <div className="card">
            <div className="card-head">
              <Icon name="clock" size={15} style={{color: 'var(--c-accent)'}}/>
              <div className="card-head-title">Лента событий</div>
              <div className="right"><a className="text-xs" style={{color: 'var(--c-accent)', cursor: 'pointer'}}>смотреть все</a></div>
            </div>
            <div style={{padding: '4px 0'}}>
              {D.activity.map((a, i) => (
                <div key={i} style={{display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px', borderBottom: i < D.activity.length - 1 ? '1px solid var(--c-border)' : 0}}>
                  <div style={{
                    width: 24, height: 24, borderRadius: 6, flex: '0 0 24px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: a.tone === 'accent' ? 'var(--c-accent-bg)' : a.tone === 'success' ? 'var(--c-success-bg)' : a.tone === 'warning' ? 'var(--c-warning-bg)' : 'var(--c-bg-sunken)',
                    color: a.tone === 'accent' ? 'var(--c-accent)' : a.tone === 'success' ? 'var(--c-success)' : a.tone === 'warning' ? 'var(--c-warning)' : 'var(--c-text-muted)',
                  }}>
                    <Icon name={a.icon} size={12}/>
                  </div>
                  <div style={{flex: 1, minWidth: 0}}>
                    <div style={{fontSize: 12.5, fontWeight: 450}}>{a.text}</div>
                    <div className="text-xs subtle">{a.meta}</div>
                  </div>
                  <div className="text-xs faint mono" style={{flex: '0 0 auto'}}>{a.time}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

window.DashboardScreen = DashboardScreen;
