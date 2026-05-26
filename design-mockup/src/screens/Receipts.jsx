// === Receipts (Поступления) — list ===

const ReceiptsScreen = ({ onNavigate }) => {
  const [tab, setTab] = React.useState('all');
  const [selection, setSelection] = React.useState(new Set());
  const [filters, setFilters] = React.useState({ client: null, status: null });

  const filtered = D.receipts.filter(r => {
    if (tab === 'active' && (r.status === 'done' || r.status === 'cancelled')) return false;
    if (tab === 'done' && r.status !== 'done') return false;
    if (tab === 'drafts' && r.status !== 'draft') return false;
    if (filters.client && r.client !== filters.client) return false;
    if (filters.status && r.status !== filters.status) return false;
    return true;
  });

  const counts = {
    all: D.receipts.length,
    active: D.receipts.filter(r => r.status !== 'done' && r.status !== 'cancelled').length,
    done: D.receipts.filter(r => r.status === 'done').length,
    drafts: D.receipts.filter(r => r.status === 'draft').length,
  };

  const toggleSel = (id) => {
    const next = new Set(selection);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelection(next);
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Поступления</div>
          <div className="page-subtitle">Учёт приёма товара от клиентов и поставщиков</div>
        </div>
        <div className="row gap-8">
          <button className="btn"><Icon name="upload" size={14}/>Импорт Excel</button>
          <button className="btn"><Icon name="download" size={14}/>Экспорт</button>
          <button className="btn primary" onClick={() => onNavigate('receiptCreate')}>
            <Icon name="plus" size={14}/>Новое поступление
          </button>
        </div>
      </div>

      <Tabs
        tabs={[
          { id: 'all', label: 'Все', count: counts.all },
          { id: 'active', label: 'В работе', count: counts.active },
          { id: 'done', label: 'Завершённые', count: counts.done },
          { id: 'drafts', label: 'Черновики', count: counts.drafts },
        ]}
        active={tab}
        onChange={setTab}
      />

      {/* Filter bar — Linear-style chips */}
      <div className="filters">
        <div className="topbar-search" style={{flex: '0 0 240px', height: 28}}>
          <Icon name="search" size={13}/>
          <span style={{flex: 1}}>Поиск по номеру или клиенту…</span>
        </div>
        <FilterChip
          label="Клиент"
          value={filters.client}
          active={!!filters.client}
          onClick={() => setFilters(f => ({...f, client: f.client ? null : 'Mango Republic'}))}
        />
        <FilterChip
          label="Статус"
          value={filters.status ? 'Приёмка' : null}
          active={!!filters.status}
          onClick={() => setFilters(f => ({...f, status: f.status ? null : 'in_progress'}))}
        />
        <FilterChip label="Период" onClick={() => {}}/>
        <FilterChip label="Оператор" onClick={() => {}}/>
        <FilterChip label="С браком" onClick={() => {}}/>
        <button className="btn ghost sm" style={{marginLeft: 'auto'}}>
          <Icon name="settings" size={13}/>Колонки
        </button>
      </div>

      {/* Selection bar */}
      {selection.size > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '10px 14px',
          background: 'var(--c-accent-bg)',
          border: '1px solid var(--c-accent-border)',
          borderRadius: 'var(--r-md)',
          marginBottom: 12,
        }}>
          <span style={{fontSize: 13, fontWeight: 500, color: 'var(--c-accent-text)'}}>
            Выбрано: {selection.size}
          </span>
          <div style={{flex: 1}}/>
          <button className="btn sm"><Icon name="check" size={12}/>Подтвердить</button>
          <button className="btn sm"><Icon name="download" size={12}/>Накладные PDF</button>
          <button className="btn sm danger"><Icon name="x" size={12}/>Отменить</button>
          <button className="btn ghost icon sm" onClick={() => setSelection(new Set())}><Icon name="x" size={13}/></button>
        </div>
      )}

      {/* Table */}
      <div className="t-wrap">
        <table className="t">
          <thead>
            <tr>
              <th style={{width: 30}}>
                <Checkbox
                  checked={selection.size > 0 && selection.size === filtered.length}
                  onChange={(v) => setSelection(v ? new Set(filtered.map(r => r.id)) : new Set())}
                />
              </th>
              <th style={{width: 110}}>Номер</th>
              <th>Клиент</th>
              <th style={{width: 150}}>Дата</th>
              <th style={{width: 80, textAlign: 'right'}}>SKU</th>
              <th style={{width: 100, textAlign: 'right'}}>Кол-во</th>
              <th style={{width: 120}}>Статус</th>
              <th style={{width: 70, textAlign: 'right'}}>Брак</th>
              <th style={{width: 160}}>Оператор</th>
              <th style={{width: 28}}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => (
              <tr key={r.id} onClick={() => onNavigate('receiptDetail', { id: r.id })}>
                <td onClick={(e) => e.stopPropagation()}>
                  <Checkbox checked={selection.has(r.id)} onChange={() => toggleSel(r.id)}/>
                </td>
                <td><span className="mono" style={{fontWeight: 500}}>{r.id}</span></td>
                <td>
                  <div style={{fontWeight: 450}}>{r.client}</div>
                </td>
                <td className="muted">{r.date}</td>
                <td className="num">{r.sku_total}</td>
                <td className="num">{r.qty_total.toLocaleString('ru')}</td>
                <td><Badge tone={statusTone(r.status)} dot>{r.status_label}</Badge></td>
                <td className="num">
                  {r.defects > 0 ? <span style={{color: 'var(--c-warning)', fontWeight: 500}}>{r.defects}</span> : <span className="faint">—</span>}
                </td>
                <td>
                  <div className="row gap-8">
                    <Avatar initials={r.operator.split(' ').map(x => x[0]).join('').slice(0, 2)}/>
                    <span className="text-sm">{r.operator}</span>
                  </div>
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <button className="btn ghost icon sm"><Icon name="more" size={14}/></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div style={{display: 'flex', alignItems: 'center', marginTop: 14, gap: 8}}>
        <span className="text-xs subtle">Показано {filtered.length} из {D.receipts.length}</span>
        <div style={{flex: 1}}/>
        <button className="btn sm ghost" disabled><Icon name="arrowLeft" size={13}/></button>
        <button className="btn sm" style={{background: 'var(--c-bg-active)'}}>1</button>
        <button className="btn sm ghost">2</button>
        <button className="btn sm ghost">3</button>
        <button className="btn sm ghost"><Icon name="arrowRight" size={13}/></button>
      </div>
    </div>
  );
};

window.ReceiptsScreen = ReceiptsScreen;
