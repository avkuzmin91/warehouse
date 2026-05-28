// === Shipment create (full-page form) ===
const ShipmentCreate = ({ onNavigate }) => {
  const [client, setClient] = React.useState('cl-01');
  const [dest, setDest] = React.useState('wb-koledino');
  const [courier, setCourier] = React.useState('main');
  const [lines, setLines] = React.useState([
    { id: 1, sku: 'MNG-TS-01-BLK-M', name: 'Футболка базовая · Чёрный · M', available: 198, qty: 40, location: 'A-12-03' },
    { id: 2, sku: 'MNG-TS-01-BLK-L', name: 'Футболка базовая · Чёрный · L', available: 280, qty: 60, location: 'A-12-04' },
    { id: 3, sku: 'MNG-HD-12-GRA-L', name: 'Худи oversize · Графит · L', available: 124, qty: 20, location: 'A-08-01' },
  ]);
  const [showPicker, setShowPicker] = React.useState(false);

  const updateLine = (id, patch) => setLines(ls => ls.map(l => l.id === id ? {...l, ...patch} : l));
  const removeLine = (id) => setLines(ls => ls.filter(l => l.id !== id));

  const totalQty = lines.reduce((s, l) => s + l.qty, 0);
  const totalSku = lines.length;
  const overSome = lines.some(l => l.qty > l.available);

  return (
    <div className="page">
      <div className="page-header">
        <div style={{display: 'flex', alignItems: 'flex-start', gap: 12}}>
          <button className="btn ghost icon" style={{marginTop: 2}} onClick={() => onNavigate('shipments')}>
            <Icon name="arrowLeft" size={16}/>
          </button>
          <div>
            <div className="page-title">Новая отгрузка</div>
          </div>
        </div>
        <div className="row gap-8">
          <button className="btn" onClick={() => onNavigate('shipments')}>Отмена</button>
          <button className="btn primary" disabled={overSome}>
            <Icon name="check" size={14}/>Запланировать отгрузку
          </button>
        </div>
      </div>

      <ShipmentStepper status="draft" style={{marginTop: -10}} />

      {overSome && (
        <div style={{
          padding: '10px 14px', marginBottom: 14,
          background: 'var(--c-warning-bg)', color: 'var(--c-warning)',
          border: '1px solid #ead1a3', borderRadius: 'var(--r-md)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <Icon name="alert" size={15}/>
          <span style={{fontSize: 13, fontWeight: 500}}>Запрошено больше, чем доступно по одной или нескольким строкам.</span>
          <span className="right text-xs">Подберите остатки или уменьшите количество.</span>
        </div>
      )}

      <div style={{display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, alignItems: 'start'}}>
        <div className="col gap-16">
          {/* Section: Документ */}
          <div className="card">
            <div className="card-head">
              <Icon name="file" size={15} style={{color: 'var(--c-accent)'}}/>
              <div className="card-head-title">Документ</div>
            </div>
            <div className="card-body">
              <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14}}>
                <Field label="Клиент" required>
                  <Select
                    value={client}
                    onChange={setClient}
                    options={D.clients.map(c => ({ value: c.id, label: c.name }))}
                    prefix="user"
                  />
                </Field>
                <Field label="Назначение / маркетплейс" required>
                  <Select
                    value={dest}
                    onChange={setDest}
                    options={[
                      { value: 'wb-koledino', label: 'Wildberries Коледино' },
                      { value: 'wb-elektrostal', label: 'Wildberries Электросталь' },
                      { value: 'wb-podolsk', label: 'Wildberries Подольск' },
                      { value: 'ozon-khorugv', label: 'Ozon Хоругвино' },
                      { value: 'ozon-tver', label: 'Ozon Тверь' },
                      { value: 'ym-dmitrov', label: 'Yandex Маркет Дмитров' },
                      { value: 'sm', label: 'СберМегаМаркет' },
                      { value: 'pickup', label: 'Самовывоз' },
                    ]}
                    prefix="map"
                  />
                </Field>
                <Field label="Дата отправки" required>
                  <div style={{position: 'relative'}}>
                    <Icon name="calendar" size={14} style={{position: 'absolute', left: 10, top: 8, color: 'var(--c-text-subtle)'}}/>
                    <input className="input" style={{paddingLeft: 32}} defaultValue="24 мая 2026, 09:00"/>
                  </div>
                </Field>
                <Field label="Перевозчик">
                  <Select
                    value={courier}
                    onChange={setCourier}
                    options={[
                      { value: 'main', label: 'Главдоставка' },
                      { value: 'cdek', label: 'СДЭК' },
                      { value: 'boxberry', label: 'Boxberry' },
                      { value: 'pochta', label: 'Почта России' },
                      { value: 'pickup', label: 'Самовывоз — клиент' },
                    ]}
                  />
                </Field>
                <Field label="Внешний № заказа" hint="из системы клиента">
                  <input className="input" placeholder="WB-2026-04421" defaultValue="WB-2026-04421"/>
                </Field>
                <Field label="Приоритет">
                  <div style={{display: 'flex', gap: 6}}>
                    {[
                      { v: 'low', label: 'Обычный', tone: '' },
                      { v: 'med', label: 'Срочный', tone: 'info' },
                      { v: 'high', label: 'Критичный', tone: 'danger' },
                    ].map(p => (
                      <button key={p.v}
                              className="btn sm"
                              style={p.v === 'med' ? {background: 'var(--c-info-bg)', color: 'var(--c-info)', borderColor: 'transparent', fontWeight: 500} : {}}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                </Field>
              </div>

              <Field label="Инструкции для сборки" help="видно операторам">
                <textarea className="input" style={{height: 60, padding: 8, resize: 'vertical'}}
                          defaultValue="Палеты обтянуть стрейчем. Маркировка WB обязательна."/>
              </Field>
            </div>
          </div>

          {/* Section: Lines */}
          <div className="card">
            <div className="card-head">
              <Icon name="boxes" size={15} style={{color: 'var(--c-accent)'}}/>
              <div className="card-head-title">Состав отгрузки</div>
              <span className="badge accent" style={{marginLeft: 6}}>{lines.length}</span>
              <div className="right row gap-8">
                <button className="btn sm"><Icon name="upload" size={12}/>Из заявки клиента</button>
                <button className="btn sm primary" onClick={() => setShowPicker(true)}>
                  <Icon name="plus" size={12}/>Добавить товар
                </button>
              </div>
            </div>

            {lines.length === 0 ? (
              <div className="empty">
                <div className="empty-illust"/>
                <div style={{fontSize: 14, fontWeight: 500}}>В отгрузке пока нет товаров</div>
                <div className="text-sm muted mt-8">Выберите из остатков или импортируйте заявку</div>
              </div>
            ) : (
              <table className="t">
                <thead>
                  <tr>
                    <th style={{width: 30}}></th>
                    <th>Товар · вариант</th>
                    <th style={{width: 110}}>Ячейка</th>
                    <th style={{width: 100, textAlign: 'right'}}>Доступно</th>
                    <th style={{width: 140, textAlign: 'right'}}>К отгрузке</th>
                    <th style={{width: 30}}></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => {
                    const over = l.qty > l.available;
                    return (
                      <tr key={l.id} style={over ? {background: 'var(--c-warning-bg)'} : {}}>
                        <td>
                          <div style={{width: 24, height: 24, borderRadius: 4, background: 'var(--c-bg-sunken)', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                            <Icon name="box" size={12} style={{color: 'var(--c-text-muted)'}}/>
                          </div>
                        </td>
                        <td>
                          <div style={{fontWeight: 450}}>{l.name}</div>
                          <div className="text-xs subtle mono">{l.sku}</div>
                        </td>
                        <td>
                          <span className="mono" style={{fontSize: 12, color: 'var(--c-accent-text)', background: 'var(--c-accent-bg)', padding: '1px 6px', borderRadius: 4}}>{l.location}</span>
                        </td>
                        <td className="num">{l.available}</td>
                        <td>
                          <div style={{display: 'flex', justifyContent: 'flex-end', gap: 6, alignItems: 'center'}}>
                            <NumberStep value={l.qty} onChange={(v) => updateLine(l.id, { qty: v })}/>
                            {over && <Icon name="alert" size={13} style={{color: 'var(--c-warning)'}}/>}
                          </div>
                        </td>
                        <td>
                          <button className="btn ghost icon sm" onClick={() => removeLine(l.id)}>
                            <Icon name="trash" size={13}/>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{background: 'var(--c-bg-sunken)'}}>
                    <td colSpan="3" style={{padding: '10px 12px', fontWeight: 500, fontSize: 12.5}}>
                      Итого: {totalSku} SKU
                    </td>
                    <td/>
                    <td className="num" style={{padding: '10px 12px', fontWeight: 600, fontSize: 14}}>{totalQty}</td>
                    <td/>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>

        {/* Right column */}
        <div className="col gap-16">
          <div className="card">
            <div className="card-head">
              <Icon name="map" size={15} style={{color: 'var(--c-accent)'}}/>
              <div className="card-head-title">Маршрут</div>
            </div>
            <div style={{padding: 14}}>
              <div style={{display: 'flex', flexDirection: 'column', gap: 14, position: 'relative'}}>
                {[
                  { label: 'Mango Republic', sub: 'Склад MSK-01, зона А', icon: 'box', tone: 'accent' },
                  { label: 'Сборка', sub: 'Пакет №3 · 1.5 ч', icon: 'boxes', tone: '' },
                  { label: 'Передача', sub: 'Главдоставка · 09:00', icon: 'truckOut', tone: 'info' },
                  { label: 'Wildberries Коледино', sub: 'Доставка ~3 ч', icon: 'map', tone: 'success' },
                ].map((s, i) => (
                  <div key={i} style={{display: 'flex', alignItems: 'flex-start', gap: 12, position: 'relative'}}>
                    <div style={{
                      width: 22, height: 22, borderRadius: 50, flex: '0 0 22px',
                      background: s.tone === 'accent' ? 'var(--c-accent-bg)' : s.tone === 'info' ? 'var(--c-info-bg)' : s.tone === 'success' ? 'var(--c-success-bg)' : 'var(--c-bg-sunken)',
                      color: s.tone === 'accent' ? 'var(--c-accent)' : s.tone === 'info' ? 'var(--c-info)' : s.tone === 'success' ? 'var(--c-success)' : 'var(--c-text-muted)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      zIndex: 2,
                    }}>
                      <Icon name={s.icon} size={11}/>
                    </div>
                    {i < 3 && <div style={{position: 'absolute', left: 10, top: 22, bottom: -14, width: 2, background: 'var(--c-border)', zIndex: 1}}/>}
                    <div>
                      <div style={{fontSize: 13, fontWeight: 500}}>{s.label}</div>
                      <div className="text-xs subtle">{s.sub}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <Icon name="chart" size={15} style={{color: 'var(--c-accent)'}}/>
              <div className="card-head-title">Итого</div>
            </div>
            <div style={{padding: 16, display: 'grid', gridTemplateColumns: 'auto 1fr', rowGap: 10, columnGap: 12, fontSize: 13}}>
              <span className="muted">SKU</span><span style={{textAlign: 'right'}} className="mono">{totalSku}</span>
              <span className="muted">Кол-во</span><span style={{textAlign: 'right', fontWeight: 500, fontSize: 14}} className="mono">{totalQty}</span>
              <span className="muted">Резерв</span><Badge tone="success" dot>встанет автоматически</Badge>
              <span className="muted">Упаковок</span><span style={{textAlign: 'right'}} className="mono">~3 короба</span>
              <span className="muted">Вес, ~кг</span><span style={{textAlign: 'right'}} className="mono">42</span>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <Icon name="layers" size={15}/>
              <div className="card-head-title">Этикетки</div>
            </div>
            <div style={{padding: 12}}>
              <div className="col gap-8">
                <Toggle checked={true} label="Этикетка Wildberries (ШК)"/>
                <Toggle checked={true} label="Лист сборщика"/>
                <Toggle checked={false} label="УПД печатать сразу"/>
              </div>
            </div>
          </div>
        </div>
      </div>

      <ShipmentPickerSheet open={showPicker} onClose={() => setShowPicker(false)} onAdd={(line) => { setLines(ls => [...ls, { id: Date.now(), ...line }]); setShowPicker(false); }}/>
    </div>
  );
};

const ShipmentPickerSheet = ({ open, onClose, onAdd }) => {
  const [search, setSearch] = React.useState('');
  const items = D.balances.filter(b => !search || b.name.toLowerCase().includes(search.toLowerCase()) || b.sku.toLowerCase().includes(search.toLowerCase()));
  return (
    <SideSheet
      open={open}
      onClose={onClose}
      title="Подобрать товар"
      subtitle="Из доступных остатков"
      width={560}
      footer={<button className="btn" onClick={onClose}>Готово</button>}
    >
      <div style={{position: 'relative', marginBottom: 14}}>
        <Icon name="search" size={14} style={{position: 'absolute', left: 10, top: 8, color: 'var(--c-text-subtle)'}}/>
        <input
          className="input"
          style={{paddingLeft: 32}}
          placeholder="SKU, название или ячейка…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
      </div>
      <div className="col gap-4">
        {items.map(b => (
          <div key={b.sku}
               style={{display: 'flex', alignItems: 'center', gap: 10, padding: '10px 10px', borderRadius: 6, cursor: 'pointer', border: '1px solid var(--c-border)'}}
               onMouseEnter={(e) => e.currentTarget.style.background = 'var(--c-bg-hover)'}
               onMouseLeave={(e) => e.currentTarget.style.background = ''}
               onClick={() => onAdd({ sku: b.sku, name: b.name, available: b.available, qty: 10, location: b.location })}>
            <div style={{width: 32, height: 32, borderRadius: 5, background: 'var(--c-bg-sunken)', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
              <Icon name="box" size={14} style={{color: 'var(--c-text-muted)'}}/>
            </div>
            <div style={{flex: 1, minWidth: 0}}>
              <div style={{fontSize: 13, fontWeight: 500}}>{b.name}</div>
              <div className="text-xs subtle mono">{b.sku} · {b.location}</div>
            </div>
            <div style={{textAlign: 'right'}}>
              <div className="mono text-sm" style={{color: 'var(--c-success)', fontWeight: 500}}>{b.available}</div>
              <div className="text-xs subtle">доступно</div>
            </div>
            <Icon name="plus" size={14} style={{color: 'var(--c-accent)'}}/>
          </div>
        ))}
      </div>
    </SideSheet>
  );
};

window.ShipmentCreate = ShipmentCreate;
