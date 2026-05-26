// === Поступления 2 — новая логика через журнал операций ===
// Реализует ТЗ: операции вместо изменения данных, 5 статусов документа,
// статус проверки качества как отдельная колонка, вычисляемая просрочка.

const Receipts2Screen = ({ onNavigate }) => {
  const [tab, setTab] = React.useState('all');
  const [filters, setFilters] = React.useState({ client: null, status: null, overdue: false });

  // Сортировка по дате прибытия (по убыванию) — из ТЗ §9
  const sorted = [...D.receipts2].sort((a, b) => b.arrivalDate.localeCompare(a.arrivalDate));

  const filtered = sorted.filter(r => {
    if (tab === 'active' && (r.status === 'done')) return false;
    if (tab === 'done' && r.status !== 'done') return false;
    if (tab === 'drafts' && r.status !== 'draft') return false;
    if (tab === 'overdue' && !D.isOverdue2(r)) return false;
    if (filters.client && r.client !== filters.client) return false;
    if (filters.status && r.status !== filters.status) return false;
    if (filters.overdue && !D.isOverdue2(r)) return false;
    return true;
  });

  const counts = {
    all: D.receipts2.length,
    active: D.receipts2.filter(r => r.status !== 'done').length,
    done: D.receipts2.filter(r => r.status === 'done').length,
    drafts: D.receipts2.filter(r => r.status === 'draft').length,
    overdue: D.receipts2.filter(r => D.isOverdue2(r)).length,
  };

  const statusBadge = (id) => {
    const s = D.receipt2Statuses.find(x => x.id === id);
    return <Badge tone={s.tone} dot>{s.label}</Badge>;
  };

  const qcBadge = (id) => {
    const q = D.qcStatuses[id];
    return <Badge tone={q.tone}>{q.label}</Badge>;
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="row gap-8" style={{marginBottom: 6}}>
            <div className="page-title" style={{margin: 0}}>Поступления 2</div>
            <Badge tone="accent">v2 · operations</Badge>
          </div>
          <div className="page-subtitle">Новая модель: документ → строки → журнал операций. Операции неизменяемы, состояние вычисляется.</div>
        </div>
        <div className="row gap-8">
          <button className="btn"><Icon name="layers" size={14}/>Журнал склада</button>
          <button className="btn"><Icon name="download" size={14}/>Экспорт</button>
          <button className="btn primary" onClick={() => onNavigate('receipt2Create')}>
            <Icon name="plus" size={14}/>Новый документ
          </button>
        </div>
      </div>

      {/* Инфо-баннер: что нового */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 12,
        padding: '12px 14px',
        background: 'var(--c-accent-bg)',
        border: '1px solid var(--c-accent-border)',
        borderRadius: 'var(--r-md)',
        marginBottom: 16,
      }}>
        <Icon name="sparkles" size={16} style={{color: 'var(--c-accent)', marginTop: 1}}/>
        <div style={{flex: 1, fontSize: 12.5, color: 'var(--c-accent-text)', lineHeight: 1.55}}>
          <div style={{fontWeight: 600, marginBottom: 2}}>Параллельная система учёта</div>
          Документы создаются только в новой модели. Старые поступления остаются для просмотра истории. Любое действие — отдельная операция, ничего не перезаписывается.
        </div>
        <button className="btn ghost sm"><Icon name="x" size={12}/></button>
      </div>

      <Tabs
        tabs={[
          { id: 'all', label: 'Все', count: counts.all },
          { id: 'active', label: 'В работе', count: counts.active },
          { id: 'overdue', label: 'Просрочка', count: counts.overdue },
          { id: 'done', label: 'Завершённые', count: counts.done },
          { id: 'drafts', label: 'Черновики', count: counts.drafts },
        ]}
        active={tab}
        onChange={setTab}
      />

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
          value={filters.status ? D.receipt2Statuses.find(s => s.id === filters.status)?.label : null}
          active={!!filters.status}
          onClick={() => setFilters(f => ({...f, status: f.status ? null : 'arrived'}))}
        />
        <FilterChip label="Период" onClick={() => {}}/>
        <FilterChip label="Зона разгрузки" onClick={() => {}}/>
        <FilterChip label="Проверка качества" onClick={() => {}}/>
        <button className="btn ghost sm" style={{marginLeft: 'auto'}}>
          <Icon name="settings" size={13}/>Колонки
        </button>
      </div>

      {/* Таблица — колонки строго по ТЗ §9 + индикатор просрочки */}
      <div className="t-wrap">
        <table className="t">
          <thead>
            <tr>
              <th style={{width: 22}}></th>
              <th style={{width: 140}}>Номер документа</th>
              <th>Клиент</th>
              <th style={{width: 130}}>Дата прибытия</th>
              <th style={{width: 80, textAlign: 'right'}}>SKU</th>
              <th style={{width: 100, textAlign: 'right'}}>План, шт</th>
              <th style={{width: 130}}>Статус документа</th>
              <th style={{width: 80, textAlign: 'right'}}>Брак</th>
              <th style={{width: 140}}>Проверка качества</th>
              <th style={{width: 28}}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => {
              const sum = D.receipt2Summary(r);
              const overdue = D.isOverdue2(r);
              const qc = D.receipt2QcStatus(r);
              return (
                <tr
                  key={r.id}
                  onClick={() => onNavigate('receipt2Detail', { id: r.id })}
                  style={overdue ? {
                    background: 'color-mix(in oklab, var(--c-danger) 5%, transparent)',
                    borderLeft: '2px solid var(--c-danger)',
                  } : {}}
                >
                  <td style={{paddingLeft: overdue ? 6 : 8}}>
                    {overdue && (
                      <span title="Документ просрочен" style={{
                        display: 'inline-flex',
                        color: 'var(--c-danger)',
                      }}>
                        <Icon name="alert" size={14}/>
                      </span>
                    )}
                  </td>
                  <td>
                    <span className="mono" style={{fontWeight: 500}}>{r.id}</span>
                    {overdue && (
                      <div className="text-xs" style={{color: 'var(--c-danger)', marginTop: 2, fontWeight: 500}}>
                        просрочен
                      </div>
                    )}
                  </td>
                  <td>
                    <div style={{fontWeight: 450}}>{r.client}</div>
                    {r.supplier && <div className="text-xs subtle">{r.supplier}</div>}
                  </td>
                  <td>
                    <div className={overdue ? '' : 'muted'} style={overdue ? {color: 'var(--c-danger)', fontWeight: 500} : {}}>
                      {r.arrivalAt}
                    </div>
                  </td>
                  <td className="num">{sum.skuCount}</td>
                  <td className="num">{sum.planned.toLocaleString('ru')}</td>
                  <td>{statusBadge(r.status)}</td>
                  <td className="num">
                    {sum.defect > 0
                      ? <span style={{color: 'var(--c-warning)', fontWeight: 500}}>{sum.defect}</span>
                      : <span className="faint">—</span>}
                  </td>
                  <td>{qcBadge(qc)}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button className="btn ghost icon sm"><Icon name="more" size={14}/></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Подпись внизу: напоминание о принципе */}
      <div style={{display: 'flex', alignItems: 'center', marginTop: 14, gap: 8}}>
        <span className="text-xs subtle">
          <Icon name="shield" size={11} style={{verticalAlign: '-2px', marginRight: 4}}/>
          Сортировка: по дате прибытия ↓ · показано {filtered.length} из {D.receipts2.length}
        </span>
        <div style={{flex: 1}}/>
        <span className="text-xs faint">Архитектура: документ → строки → операции. История важнее текущего состояния.</span>
      </div>
    </div>
  );
};

window.Receipts2Screen = Receipts2Screen;
