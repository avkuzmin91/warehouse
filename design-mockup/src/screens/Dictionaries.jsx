// === Dictionaries (Справочники) ===
const DictionariesScreen = ({ onNavigate }) => {
  const [active, setActive] = React.useState('products');
  const [sheet, setSheet] = React.useState(null); // null | { type: 'simple'|'client', kind, isNew, initial }

  const openSimple = (kind, initial = null) => setSheet({ type: 'simple', kind, isNew: !initial, initial });
  const openClient = (initial = null) => setSheet({ type: 'client', isNew: !initial, initial });

  const dict = D.dictionaries.find(d => d.id === active);

  const onCreate = () => {
    if (active === 'products') onNavigate('productNew');
    else if (active === 'clients') openClient();
    else openSimple(dict?.name === 'Размеры' ? 'Размер' : dict?.name === 'Цвета' ? 'Цвет' : dict?.name === 'Типы товаров' ? 'Тип товара' : 'Значение');
  };

  const renderContent = () => {
    if (active === 'products') return <ProductsDict onNavigate={onNavigate}/>;
    if (active === 'colors') return <SimpleDict items={D.colors} title="Цвет" onEdit={(name) => openSimple('Цвет', { name, active: true })}/>;
    if (active === 'sizes') return <SimpleDict items={D.sizes} title="Размер" onEdit={(name) => openSimple('Размер', { name, active: true })}/>;
    if (active === 'product-types') return <SimpleDict items={['Футболка','Худи','Платье','Кепка','Сумка','Бутылка']} title="Тип товара" onEdit={(name) => openSimple('Тип товара', { name, active: true })}/>;
    if (active === 'clients') return <ClientsDict onEdit={(c) => openClient(c)}/>;
    return <SimpleDict items={['Категория А', 'Категория Б', 'Категория В']} title="Значение" onEdit={(name) => openSimple(dict?.name || 'Значение', { name, active: true })}/>;
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Справочники</div>
          <div className="page-subtitle">Базовые сущности системы и правила их создания</div>
        </div>
        <div className="row gap-8">
          <button className="btn"><Icon name="upload" size={14}/>Импорт</button>
          <button className="btn primary" onClick={onCreate}>
            <Icon name="plus" size={14}/>
            {active === 'products' ? 'Новый товар' : active === 'clients' ? 'Новый клиент' : 'Создать запись'}
          </button>
        </div>
      </div>

      <div style={{display: 'grid', gridTemplateColumns: '240px 1fr', gap: 20, alignItems: 'start'}}>
        {/* Left list */}
        <div className="card" style={{position: 'sticky', top: 0}}>
          <div style={{padding: 8}}>
            {D.dictionaries.map(d => (
              <div
                key={d.id}
                className={`nav-item ${active === d.id ? 'active' : ''}`}
                style={{height: 32}}
                onClick={() => setActive(d.id)}
              >
                <Icon name={d.icon} className="nav-icon"/>
                <span>{d.name}</span>
                <span className="nav-count">{d.count}</span>
              </div>
            ))}
          </div>
          <div style={{borderTop: '1px solid var(--c-border)', padding: 10}}>
            <div className="text-xs subtle">Системные</div>
            <div className="nav-item" style={{height: 30, color: 'var(--c-text-subtle)'}}>
              <Icon name="archive" size={14} className="nav-icon"/>
              <span>Архив</span>
            </div>
          </div>
        </div>

        <div>{renderContent()}</div>
      </div>

      {/* Sheets */}
      {sheet?.type === 'simple' && (
        <SimpleDictSheet
          open={true}
          onClose={() => setSheet(null)}
          isNew={sheet.isNew}
          kind={sheet.kind}
          initial={sheet.initial}
        />
      )}
      {sheet?.type === 'client' && (
        <ClientSheet
          open={true}
          onClose={() => setSheet(null)}
          isNew={sheet.isNew}
          initial={sheet.initial}
        />
      )}
    </div>
  );
};

const ProductsDict = ({ onNavigate }) => {
  return (
    <div>
      <div className="filters" style={{marginBottom: 14}}>
        <div className="topbar-search" style={{flex: '0 0 240px', height: 28}}>
          <Icon name="search" size={13}/><span>Поиск SKU или название…</span>
        </div>
        <FilterChip label="Клиент" value="все" onClick={() => {}}/>
        <FilterChip label="Тип" onClick={() => {}}/>
        <FilterChip label="Только активные" active onClick={() => {}}/>
      </div>

      <div className="t-wrap">
        <table className="t">
          <thead>
            <tr>
              <th style={{width: 30}}><Checkbox/></th>
              <th style={{width: 50}}></th>
              <th>Товар · базовый SKU</th>
              <th style={{width: 140}}>Тип</th>
              <th style={{width: 180}}>Клиент</th>
              <th style={{width: 110, textAlign: 'right'}}>Варианты</th>
              <th style={{width: 110, textAlign: 'right'}}>На складе</th>
              <th style={{width: 90}}>Статус</th>
            </tr>
          </thead>
          <tbody>
            {D.products.map(p => (
              <tr key={p.sku} onClick={() => onNavigate('productEdit', { sku: p.sku })}>
                <td><Checkbox/></td>
                <td>
                  <div style={{width: 32, height: 32, borderRadius: 6, background: 'var(--c-bg-sunken)', border: '1px solid var(--c-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16}}>{p.image}</div>
                </td>
                <td>
                  <div style={{fontWeight: 450}}>{p.name}</div>
                  <div className="text-xs subtle mono">{p.sku}</div>
                </td>
                <td><Badge>{p.type}</Badge></td>
                <td className="text-sm">{p.client}</td>
                <td className="num"><span className="badge accent" style={{height: 18}}>{p.variants} шт</span></td>
                <td className="num">{p.qty.toLocaleString('ru')}</td>
                <td><Badge tone="success" dot>Активен</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card mt-20">
        <div className="card-head">
          <Icon name="sparkles" size={15} style={{color: 'var(--c-accent)'}}/>
          <div className="card-head-title">Варианты SKU · MNG-TS-01 Футболка базовая</div>
          <div className="right text-xs subtle">Цвета · размеры · артикулы</div>
        </div>
        <div className="card-body" style={{padding: 0}}>
          <table className="t">
            <thead>
              <tr>
                <th>Полный SKU</th>
                <th style={{width: 120}}>Цвет</th>
                <th style={{width: 100}}>Размер</th>
                <th style={{width: 140, textAlign: 'right'}}>Габариты, мм</th>
                <th style={{width: 100, textAlign: 'right'}}>Остаток</th>
                <th style={{width: 90}}>Статус</th>
              </tr>
            </thead>
            <tbody>
              {[
                { sku: 'MNG-TS-01-BLK-S', color: 'Чёрный', size: 'S', dim: '320×280×20', qty: 142 },
                { sku: 'MNG-TS-01-BLK-M', color: 'Чёрный', size: 'M', dim: '340×290×20', qty: 218 },
                { sku: 'MNG-TS-01-BLK-L', color: 'Чёрный', size: 'L', dim: '360×300×22', qty: 312 },
                { sku: 'MNG-TS-01-WHT-M', color: 'Белый', size: 'M', dim: '340×290×20', qty: 188 },
                { sku: 'MNG-TS-01-CRM-L', color: 'Кремовый', size: 'L', dim: '360×300×22', qty: 0 },
              ].map(v => (
                <tr key={v.sku}>
                  <td className="mono" style={{fontSize: 12.5}}>{v.sku}</td>
                  <td>
                    <div className="row gap-8">
                      <div style={{width: 14, height: 14, borderRadius: 50, background: v.color === 'Чёрный' ? '#1a1a18' : v.color === 'Белый' ? '#ffffff' : '#f1e7d1', border: '1px solid var(--c-border)'}}/>
                      <span className="text-sm">{v.color}</span>
                    </div>
                  </td>
                  <td><span className="badge">{v.size}</span></td>
                  <td className="num">{v.dim}</td>
                  <td className="num">{v.qty || <span className="faint">0</span>}</td>
                  <td>{v.qty > 0 ? <Badge tone="success" dot>Активен</Badge> : <Badge dot>Нет в наличии</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const SimpleDict = ({ items, title, onEdit }) => {
  return (
    <div className="t-wrap">
      <div className="card-head">
        <div className="card-head-title">Значения справочника</div>
        <div className="right row gap-8">
          <div className="topbar-search" style={{minWidth: 220, height: 26}}>
            <Icon name="search" size={12}/><span>Поиск…</span>
          </div>
          <button className="btn sm" onClick={() => onEdit && onEdit('')}><Icon name="plus" size={12}/>Добавить</button>
        </div>
      </div>
      <table className="t">
        <thead>
          <tr>
            <th style={{width: 30}}><Checkbox/></th>
            <th>{title}</th>
            <th style={{width: 130}}>Создано</th>
            <th style={{width: 150}}>Кем</th>
            <th style={{width: 100}}>Статус</th>
            <th style={{width: 30}}></th>
          </tr>
        </thead>
        <tbody>
          {items.map((v, i) => (
            <tr key={v} onClick={() => onEdit && onEdit(v)}>
              <td onClick={(e) => e.stopPropagation()}><Checkbox/></td>
              <td style={{fontWeight: 450}}>{v}</td>
              <td className="text-sm muted">{i < 3 ? '12 апр' : i < 6 ? '18 мар' : '2 фев'}</td>
              <td><div className="row gap-8"><Avatar initials="ИН"/><span className="text-sm">Илья Никитин</span></div></td>
              <td><Badge tone={i === items.length - 1 ? '' : 'success'} dot>{i === items.length - 1 ? 'Архив' : 'Активно'}</Badge></td>
              <td onClick={(e) => e.stopPropagation()}><button className="btn ghost icon sm"><Icon name="more" size={14}/></button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const ClientsDict = ({ onEdit }) => (
  <div className="t-wrap">
    <div className="card-head">
      <div className="card-head-title">Клиенты</div>
      <div className="right row gap-8">
        <button className="btn sm" onClick={() => onEdit && onEdit(null)}><Icon name="plus" size={12}/>Добавить клиента</button>
      </div>
    </div>
    <table className="t">
      <thead><tr>
        <th style={{width: 30}}><Checkbox/></th>
        <th>Клиент</th>
        <th>Email</th>
        <th style={{width: 120, textAlign: 'right'}}>Артикулов</th>
        <th style={{width: 120, textAlign: 'right'}}>Остаток</th>
        <th style={{width: 100}}>Статус</th>
      </tr></thead>
      <tbody>
        {D.clients.map(c => (
          <tr key={c.id} onClick={() => onEdit && onEdit(c)}>
            <td onClick={(e) => e.stopPropagation()}><Checkbox/></td>
            <td>
              <div className="row gap-8">
                <Avatar initials={c.brand.slice(0, 2).toUpperCase()}/>
                <div>
                  <div style={{fontWeight: 450}}>{c.name}</div>
                  <div className="text-xs subtle mono">{c.id}</div>
                </div>
              </div>
            </td>
            <td className="text-sm">{c.email}</td>
            <td className="num">{Math.round(c.active / 100)}</td>
            <td className="num">{c.active.toLocaleString('ru')}</td>
            <td><Badge tone="success" dot>Активен</Badge></td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

window.DictionariesScreen = DictionariesScreen;
