// === Users + role assignment ===
const UsersScreen = ({ onNavigate }) => {
  const [roleFilter, setRoleFilter] = React.useState('all');
  const [openRoleFor, setOpenRoleFor] = React.useState(null);

  const counts = D.users.reduce((acc, u) => {
    acc.all++;
    acc[u.role] = (acc[u.role] || 0) + 1;
    return acc;
  }, { all: 0 });

  const filtered = D.users.filter(u => roleFilter === 'all' || u.role === roleFilter);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Пользователи и роли</div>
          <div className="page-subtitle">Управление доступом · аудит действий · сессии</div>
        </div>
        <div className="row gap-8">
          <button className="btn"><Icon name="shield" size={14}/>Матрица прав</button>
          <button className="btn primary"><Icon name="plus" size={14}/>Пригласить</button>
        </div>
      </div>

      {/* Role overview pills */}
      <div style={{display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, marginBottom: 16}}>
        {[
          { role: 'all', label: 'Все', icon: 'users' },
          { role: 'admin', label: 'Администраторы', icon: 'shield' },
          { role: 'manager', label: 'Менеджеры', icon: 'star' },
          { role: 'warehouse_manager', label: 'Зав. склада', icon: 'archive' },
          { role: 'user', label: 'Операторы', icon: 'user' },
          { role: 'client', label: 'Клиенты', icon: 'box' },
        ].map(r => {
          const isActive = roleFilter === r.role;
          return (
            <div
              key={r.role}
              onClick={() => setRoleFilter(r.role)}
              style={{
                padding: '12px 14px',
                background: isActive ? 'var(--c-accent-bg)' : 'var(--c-bg-elev)',
                border: `1px solid ${isActive ? 'var(--c-accent-border)' : 'var(--c-border)'}`,
                borderRadius: 8,
                cursor: 'pointer',
              }}
            >
              <div className="row gap-8">
                <Icon name={r.icon} size={13} style={{color: isActive ? 'var(--c-accent)' : 'var(--c-text-subtle)'}}/>
                <span className="text-xs" style={{color: isActive ? 'var(--c-accent-text)' : 'var(--c-text-muted)', fontWeight: 500}}>{r.label}</span>
              </div>
              <div style={{fontSize: 20, fontWeight: 600, marginTop: 4, fontVariantNumeric: 'tabular-nums'}}>
                {counts[r.role] || 0}
              </div>
            </div>
          );
        })}
      </div>

      <div className="filters">
        <div className="topbar-search" style={{flex: '0 0 240px', height: 28}}>
          <Icon name="search" size={13}/><span>Email или имя…</span>
        </div>
        <FilterChip label="Статус" onClick={() => {}}/>
        <FilterChip label="Клиент" onClick={() => {}}/>
        <FilterChip label="Последний вход" onClick={() => {}}/>
      </div>

      <div className="t-wrap">
        <table className="t">
          <thead>
            <tr>
              <th style={{width: 30}}><Checkbox/></th>
              <th>Пользователь</th>
              <th>Email</th>
              <th style={{width: 160}}>Роль</th>
              <th style={{width: 160}}>Клиент / объект</th>
              <th style={{width: 130}}>Последний вход</th>
              <th style={{width: 50}}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(u => (
              <tr key={u.id}>
                <td><Checkbox/></td>
                <td>
                  <div className="row gap-8">
                    <Avatar initials={u.initials}/>
                    <div>
                      <div style={{fontWeight: 450}}>{u.name}</div>
                      <div className="text-xs subtle mono">{u.id}</div>
                    </div>
                  </div>
                </td>
                <td className="text-sm">{u.email}</td>
                <td style={{position: 'relative'}}>
                  <div
                    className="row gap-8"
                    style={{cursor: 'pointer', padding: '2px 6px', borderRadius: 4}}
                    onClick={(e) => { e.stopPropagation(); setOpenRoleFor(openRoleFor === u.id ? null : u.id); }}
                  >
                    <RoleBadge role={u.role}/>
                    <Icon name="chevDown" size={12} style={{color: 'var(--c-text-subtle)'}}/>
                  </div>
                  {openRoleFor === u.id && (
                    <RoleMenu currentRole={u.role} onSelect={() => setOpenRoleFor(null)} onClose={() => setOpenRoleFor(null)}/>
                  )}
                </td>
                <td>
                  {u.client_id ? <span className="text-sm">{D.clients.find(c => c.id === u.client_id)?.name}</span> : <span className="faint">—</span>}
                </td>
                <td className="text-sm muted">{u.last}</td>
                <td><button className="btn ghost icon sm"><Icon name="more" size={14}/></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Permission matrix preview */}
      <div className="card mt-20">
        <div className="card-head">
          <Icon name="shield" size={15} style={{color: 'var(--c-accent)'}}/>
          <div className="card-head-title">Матрица прав доступа</div>
          <span className="text-xs subtle">Кто и что может в системе</span>
          <div className="right">
            <button className="btn sm ghost"><Icon name="edit" size={12}/>Редактировать</button>
          </div>
        </div>
        <table className="t">
          <thead>
            <tr>
              <th style={{width: 260}}>Действие</th>
              <th style={{textAlign: 'center'}}>Админ</th>
              <th style={{textAlign: 'center'}}>Менеджер</th>
              <th style={{textAlign: 'center'}}>Зав. склада</th>
              <th style={{textAlign: 'center'}}>Оператор</th>
              <th style={{textAlign: 'center'}}>Клиент</th>
            </tr>
          </thead>
          <tbody>
            {[
              { name: 'Создавать поступления', perms: [1,1,1,1,0] },
              { name: 'Подтверждать приёмку', perms: [1,1,1,0,0] },
              { name: 'Создавать отгрузки', perms: [1,1,1,1,0] },
              { name: 'Изменять справочники', perms: [1,1,0,0,0] },
              { name: 'Управлять пользователями', perms: [1,0,0,0,0] },
              { name: 'Назначать роли', perms: [1,1,0,0,0] },
              { name: 'Видеть свои остатки', perms: [1,1,1,1,1] },
              { name: 'Видеть все клиенты', perms: [1,1,1,0,0] },
            ].map(r => (
              <tr key={r.name}>
                <td style={{fontWeight: 450}}>{r.name}</td>
                {r.perms.map((p, i) => (
                  <td key={i} style={{textAlign: 'center'}}>
                    {p ? (
                      <div style={{display: 'inline-flex', width: 18, height: 18, borderRadius: 4, background: 'var(--c-success-bg)', color: 'var(--c-success)', alignItems: 'center', justifyContent: 'center'}}>
                        <Icon name="check" size={11}/>
                      </div>
                    ) : (
                      <span style={{color: 'var(--c-text-faint)'}}>·</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const RoleMenu = ({ currentRole, onSelect, onClose }) => {
  const ref = React.useRef();
  React.useEffect(() => {
    const h = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    window.addEventListener('click', h);
    return () => window.removeEventListener('click', h);
  }, []);
  return (
    <div ref={ref} style={{
      position: 'absolute', top: 32, left: 0, zIndex: 30,
      minWidth: 220,
      background: 'var(--c-bg-elev)',
      border: '1px solid var(--c-border)',
      borderRadius: 8,
      boxShadow: 'var(--sh-3)',
      padding: 6,
    }}>
      <div className="text-xs subtle" style={{padding: '6px 8px'}}>Назначить роль</div>
      {Object.keys(D.roleLabels).map(role => (
        <div key={role} className="cmdk-item" onClick={() => onSelect(role)} style={{padding: '8px 10px'}}>
          <RoleBadge role={role}/>
          {role === currentRole && <Icon name="check" size={13} className="right" style={{color: 'var(--c-accent)'}}/>}
        </div>
      ))}
      <div style={{borderTop: '1px solid var(--c-border)', margin: '6px 0'}}/>
      <div className="cmdk-item" style={{color: 'var(--c-danger)', padding: '8px 10px'}}>
        <Icon name="lock" size={14}/>Заблокировать
      </div>
    </div>
  );
};

window.UsersScreen = UsersScreen;
