// === App shell: sidebar (A) / topnav (B), header, content slot ===

const navItems = [
  { id: 'dashboard', icon: 'home', label: 'Главная' },
  { id: 'receipts', icon: 'truckIn', label: 'Поступления', count: 4 },
  { id: 'receipts2', icon: 'layers', label: 'Поступления 2', count: 5, badge: 'v2' },
  { id: 'shipments', icon: 'truckOut', label: 'Отгрузки', count: 3 },
  { id: 'balances', icon: 'boxes', label: 'Остатки' },
  { id: 'defects', icon: 'alert', label: 'Брак', count: 7 },
  { id: 'dictionaries', icon: 'book', label: 'Справочники' },
];

const adminNav = [
  { id: 'users', icon: 'users', label: 'Пользователи' },
  { id: 'client', icon: 'user', label: 'Кабинет клиента' },
];

const labelById = Object.fromEntries([...navItems, ...adminNav].map(n => [n.id, n.label]));

const Sidebar = ({ active, onNavigate, role }) => (
  <aside className="sidebar">
    <div className="sidebar-brand">
      <Brand size={22} />
      <div>
        <div className="sidebar-brand-text">pack-men</div>
        <div className="sidebar-brand-sub">{role === 'client' ? 'Кабинет клиента' : 'WMS · MSK-01'}</div>
      </div>
    </div>

    <div className="sidebar-section">Операции</div>
    {navItems.map(item => (
      <div
        key={item.id}
        className={`nav-item ${active === item.id ? 'active' : ''}`}
        onClick={() => onNavigate(item.id)}
      >
        <Icon name={item.icon} className="nav-icon"/>
        <span>{item.label}</span>
        {item.badge && (
          <span style={{
            fontSize: 9.5, fontWeight: 600, letterSpacing: '0.04em',
            padding: '1px 5px', borderRadius: 4,
            background: 'var(--c-accent-bg)', color: 'var(--c-accent)',
            border: '1px solid var(--c-accent-border)',
            textTransform: 'uppercase',
            marginLeft: 4,
          }}>{item.badge}</span>
        )}
        {item.count > 0 && <span className="nav-count">{item.count}</span>}
      </div>
    ))}

    {role !== 'client' && (
      <>
        <div className="sidebar-section">Управление</div>
        {adminNav.map(item => (
          <div
            key={item.id}
            className={`nav-item ${active === item.id ? 'active' : ''}`}
            onClick={() => onNavigate(item.id)}
          >
            <Icon name={item.icon} className="nav-icon"/>
            <span>{item.label}</span>
          </div>
        ))}
      </>
    )}

    <div className="sidebar-footer">
      <Avatar initials={role === 'client' ? 'MR' : role === 'admin' ? 'ИН' : role === 'manager' ? 'АС' : 'СД'} />
      <div style={{flex: 1, minWidth: 0}}>
        <div style={{fontSize: 12.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
          {role === 'client' ? 'Mango Republic' : role === 'admin' ? 'Илья Никитин' : role === 'manager' ? 'Анна Сорокина' : 'Сергей Дунаев'}
        </div>
        <div style={{fontSize: 11, color: 'var(--c-text-subtle)'}}>
          {D.roleLabels[role]}
        </div>
      </div>
      <Icon name="chev" size={14} style={{color: 'var(--c-text-subtle)'}}/>
    </div>
  </aside>
);

const TopNav = ({ active, onNavigate, role }) => (
  <>
    <div className="topbar-brand">
      <Brand size={20} />
      <span>pack-men</span>
    </div>
    <nav className="topnav">
      {navItems.map(item => (
        <div
          key={item.id}
          className={`topnav-item ${active === item.id ? 'active' : ''}`}
          onClick={() => onNavigate(item.id)}
        >
          {item.label}
          {item.count > 0 && active !== item.id && (
            <span style={{marginLeft: 6, fontSize: 11, color: 'var(--c-text-subtle)', fontFamily: 'var(--font-mono)'}}>{item.count}</span>
          )}
        </div>
      ))}
      {role !== 'client' && adminNav.map(item => (
        <div
          key={item.id}
          className={`topnav-item ${active === item.id ? 'active' : ''}`}
          onClick={() => onNavigate(item.id)}
        >
          {item.label}
        </div>
      ))}
    </nav>
  </>
);

const Crumbs = ({ trail, onCrumb }) => (
  <div className="crumbs">
    {trail.map((c, i) => (
      <React.Fragment key={i}>
        {i > 0 && <span className="sep">/</span>}
        <span
          className={`crumb ${i === trail.length - 1 ? 'active' : ''}`}
          onClick={() => onCrumb && onCrumb(c.id, i)}
        >{c.label}</span>
      </React.Fragment>
    ))}
  </div>
);

const Topbar = ({ active, onNavigate, role, trail, onCrumb, onCmd }) => (
  <header className="topbar">
    <TopNav active={active} onNavigate={onNavigate} role={role} />
    {trail && <Crumbs trail={trail} onCrumb={onCrumb}/>}
    <div className="topbar-spacer"/>
    <div className="topbar-search" onClick={onCmd}>
      <Icon name="search" size={14}/>
      <span style={{flex: 1}}>Найти, выполнить…</span>
      <span className="kbd">⌘</span><span className="kbd">K</span>
    </div>
    <button className="btn icon ghost" title="Уведомления">
      <Icon name="bell" size={15}/>
    </button>
  </header>
);

const Shell = ({ active, onNavigate, role, trail, onCmd, children }) => (
  <div className="app-root">
    <Sidebar active={active} onNavigate={onNavigate} role={role}/>
    <main className="main">
      <Topbar active={active} onNavigate={onNavigate} role={role} trail={trail} onCrumb={onNavigate} onCmd={onCmd}/>
      <div className="content">{children}</div>
    </main>
  </div>
);

window.Shell = Shell;
window.labelById = labelById;
window.navItems = navItems;
window.adminNav = adminNav;
