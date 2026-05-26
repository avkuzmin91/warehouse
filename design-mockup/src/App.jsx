// === App: routing + role + command palette ===
const App = () => {
  const [route, setRoute] = React.useState({ name: 'login', params: {} });
  const [role, setRole] = React.useState('manager');
  const [cmdkOpen, setCmdkOpen] = React.useState(false);

  // Listen to Tweaks role changes
  React.useEffect(() => {
    const h = (e) => setRole(e.detail);
    window.addEventListener('packmen:role', h);
    return () => window.removeEventListener('packmen:role', h);
  }, []);

  // Keyboard: ⌘K
  React.useEffect(() => {
    const h = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdkOpen(true);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const navigate = (name, params = {}) => {
    if (name === '_role') {
      setRole(params.role);
      setRoute({ name: params.role === 'client' ? 'client' : 'dashboard', params: {} });
      return;
    }
    setRoute({ name, params });
  };

  // After login, go to right home
  const onLogin = (forcedRole) => {
    const r = forcedRole || role;
    setRole(r);
    setRoute({ name: r === 'client' ? 'client' : 'dashboard', params: {} });
  };

  // Trail for breadcrumbs (used in topnav concept)
  const trail = (() => {
    if (route.name === 'login') return null;
    const homeLabel = role === 'client' ? 'Кабинет' : 'Главная';
    if (route.name === 'dashboard') return [{ id: 'dashboard', label: homeLabel }];
    if (route.name === 'receiptCreate') return [
      { id: 'dashboard', label: homeLabel },
      { id: 'receipts', label: 'Поступления' },
      { id: 'receiptCreate', label: 'Новое' },
    ];
    if (route.name === 'receiptDetail') return [
      { id: 'dashboard', label: homeLabel },
      { id: 'receipts', label: 'Поступления' },
      { id: 'receiptDetail', label: 'RCP-0421' },
    ];
    if (route.name === 'receipt2Create') return [
      { id: 'dashboard', label: homeLabel },
      { id: 'receipts2', label: 'Поступления 2' },
      { id: 'receipt2Create', label: 'Новый документ' },
    ];
    if (route.name === 'receipt2Detail') return [
      { id: 'dashboard', label: homeLabel },
      { id: 'receipts2', label: 'Поступления 2' },
      { id: 'receipt2Detail', label: 'WH-2025-0042' },
    ];
    if (route.name === 'shipmentCreate') return [
      { id: 'dashboard', label: homeLabel },
      { id: 'shipments', label: 'Отгрузки' },
      { id: 'shipmentCreate', label: 'Новое' },
    ];
    if (route.name === 'productNew') return [
      { id: 'dashboard', label: homeLabel },
      { id: 'dictionaries', label: 'Справочники' },
      { id: 'productNew', label: 'Новый товар' },
    ];
    if (route.name === 'productEdit') return [
      { id: 'dashboard', label: homeLabel },
      { id: 'dictionaries', label: 'Справочники' },
      { id: 'productEdit', label: 'Редактирование товара' },
    ];
    const label = labelById[route.name] || route.name;
    return [
      { id: 'dashboard', label: homeLabel },
      { id: route.name, label },
    ];
  })();

  // Render current screen
  const renderScreen = () => {
    switch (route.name) {
      case 'dashboard': return <DashboardScreen onNavigate={navigate} role={role}/>;
      case 'receipts': return <ReceiptsScreen onNavigate={navigate}/>;
      case 'receiptCreate': return <ReceiptCreate onNavigate={navigate}/>;
      case 'receiptDetail': return <ReceiptDetailScreen onNavigate={navigate}/>;
      case 'receipts2': return <Receipts2Screen onNavigate={navigate}/>;
      case 'receipt2Create': return <Receipt2Create onNavigate={navigate}/>;
      case 'receipt2Detail': return <Receipt2DetailScreen onNavigate={navigate}/>;
      case 'shipments': return <ShipmentsScreen onNavigate={navigate}/>;
      case 'shipmentCreate': return <ShipmentCreate onNavigate={navigate}/>;
      case 'balances': return <BalancesScreen onNavigate={navigate}/>;
      case 'defects': return <DefectsScreen onNavigate={navigate}/>;
      case 'dictionaries': return <DictionariesScreen onNavigate={navigate}/>;
      case 'productNew': return <ProductEdit onNavigate={navigate} isNew={true}/>;
      case 'productEdit': return <ProductEdit onNavigate={navigate} isNew={false}/>;
      case 'users': return <UsersScreen onNavigate={navigate}/>;
      case 'client': return <ClientScreen onNavigate={navigate}/>;
      default: return <DashboardScreen onNavigate={navigate} role={role}/>;
    }
  };

  if (route.name === 'login') {
    return (
      <>
        <Login onLogin={onLogin}/>
        <Tweaks/>
      </>
    );
  }

  return (
    <>
      <Shell
        active={
          route.name === 'receiptDetail' || route.name === 'receiptCreate' ? 'receipts'
          : route.name === 'receipt2Detail' || route.name === 'receipt2Create' ? 'receipts2'
          : route.name === 'shipmentCreate' ? 'shipments'
          : route.name === 'productNew' || route.name === 'productEdit' ? 'dictionaries'
          : route.name
        }
        onNavigate={navigate}
        role={role}
        trail={trail}
        onCmd={() => setCmdkOpen(true)}
      >
        {renderScreen()}
      </Shell>
      <CommandPalette open={cmdkOpen} onClose={() => setCmdkOpen(false)} onNavigate={navigate}/>
      <Tweaks/>
    </>
  );
};

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
