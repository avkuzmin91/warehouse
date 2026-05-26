// === Создание документа поступления v2 ===
// Поля строго по ТЗ §4.1 + строки по §4.2.
// Сохранение черновика = операция doc_create. Любое поле меняется через doc_update.

const Receipt2Create = ({ onNavigate }) => {
  const [lines, setLines] = React.useState([
    { id: 1, sku: 'MNG-TS-01', name: 'Футболка базовая', color: 'Чёрный', size: 'M', planned: 60 },
    { id: 2, sku: 'MNG-TS-01', name: 'Футболка базовая', color: 'Чёрный', size: 'L', planned: 80 },
    { id: 3, sku: 'MNG-HD-12', name: 'Худи oversize',    color: 'Графит', size: 'L', planned: 40 },
  ]);
  const [client, setClient] = React.useState('cl-01');
  const [showAddLine, setShowAddLine] = React.useState(false);

  const removeLine = (id) => setLines(ls => ls.filter(l => l.id !== id));
  const updateLine = (id, patch) => setLines(ls => ls.map(l => l.id === id ? {...l, ...patch} : l));

  const totalQty = lines.reduce((s, l) => s + (l.planned || 0), 0);
  const totalSku = new Set(lines.map(l => l.sku).filter(Boolean)).size;

  return (
    <div className="page">
      <div className="page-header" style={{alignItems: 'flex-start'}}>
        <div>
          <div className="row gap-8" style={{marginBottom: 6}}>
            <button className="btn ghost sm icon" onClick={() => onNavigate('receipts2')}>
              <Icon name="arrowLeft" size={14}/>
            </button>
            <Badge dot>Черновик</Badge>
            <Badge tone="accent">v2</Badge>
            <span className="text-xs subtle">не сохранён · ничего не зафиксировано</span>
          </div>
          <div className="page-title">Новый документ поступления</div>
          <div className="page-subtitle">
            После сохранения будет создана операция <span className="mono">doc_create</span>. Все дальнейшие изменения — отдельные операции.
          </div>
        </div>
        <div className="row gap-8">
          <button className="btn ghost" onClick={() => onNavigate('receipts2')}>Отмена</button>
          <button className="btn">
            <Icon name="file" size={14}/>Сохранить черновик
          </button>
          <button className="btn primary" onClick={() => onNavigate('receipt2Detail')}>
            <Icon name="check" size={14}/>Создать документ
          </button>
        </div>
      </div>

      <div style={{display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, alignItems: 'start'}}>
        <div className="col gap-16">
          {/* Реквизиты документа — строго поля ТЗ §4.1 */}
          <div className="card">
            <div className="card-head">
              <Icon name="file" size={15} style={{color: 'var(--c-accent)'}}/>
              <div className="card-head-title">Реквизиты документа</div>
              <span className="text-xs subtle" style={{marginLeft: 8}}>
                операция: <span className="mono">doc_create</span>
              </span>
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
                <Field label="Поставщик" hint="не обязательно">
                  <input className="input" placeholder="Mango RU LLC" defaultValue="Mango RU LLC"/>
                </Field>
                <Field label="Дата прибытия (плановая)" required>
                  <div style={{position: 'relative'}}>
                    <Icon name="calendar" size={14} style={{position: 'absolute', left: 10, top: 8, color: 'var(--c-text-subtle)'}}/>
                    <input className="input" style={{paddingLeft: 32}} defaultValue="24 мая 2026, 12:00"/>
                  </div>
                </Field>
                <Field label="Номер ТТН" hint="текст, не обязательно">
                  <input className="input" placeholder="TTN-90022"/>
                </Field>
                <Field label="Зона разгрузки" hint="не обязательно">
                  <Select
                    value="A-12"
                    options={[
                      { value: 'A-12', label: 'A-12 · док №3' },
                      { value: 'A-04', label: 'A-04 · док №1' },
                      { value: 'B-01', label: 'B-01 · док №2' },
                    ]}
                    prefix="map"
                  />
                </Field>
                <Field label="Стоимость логистики" hint="число, ₽">
                  <input className="input" type="number" placeholder="0" defaultValue="18400"/>
                </Field>
              </div>
            </div>
          </div>

          {/* Строки документа — поля по ТЗ §4.2 */}
          <div className="card">
            <div className="card-head">
              <Icon name="boxes" size={15} style={{color: 'var(--c-accent)'}}/>
              <div className="card-head-title">Строки поступления</div>
              <span className="badge accent" style={{marginLeft: 6}}>{lines.length}</span>
              <span className="text-xs subtle" style={{marginLeft: 8}}>
                каждая строка = операция <span className="mono">line_add</span>
              </span>
              <div className="right row gap-8">
                <button className="btn sm"><Icon name="upload" size={12}/>Из Excel</button>
                <button className="btn sm primary" onClick={() => setShowAddLine(true)}>
                  <Icon name="plus" size={12}/>Добавить строку
                </button>
              </div>
            </div>

            {lines.length === 0 ? (
              <div className="empty">
                <div className="empty-illust"/>
                <div style={{fontSize: 14, fontWeight: 500, color: 'var(--c-text)'}}>Нет строк</div>
                <div className="text-sm muted mt-8">Нельзя создать строку без товара. Минимум 1 шт в строке.</div>
              </div>
            ) : (
              <table className="t">
                <thead>
                  <tr>
                    <th style={{width: 30}}></th>
                    <th>SKU · Товар</th>
                    <th style={{width: 110}}>Цвет</th>
                    <th style={{width: 80}}>Размер</th>
                    <th style={{width: 140, textAlign: 'right'}}>План, шт</th>
                    <th style={{width: 30}}></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={l.id}>
                      <td><span className="text-xs faint mono">{i + 1}</span></td>
                      <td>
                        <div style={{fontWeight: 450}}>{l.name}</div>
                        <div className="text-xs subtle mono">{l.sku}</div>
                      </td>
                      <td className="text-sm">{l.color || <span className="faint">—</span>}</td>
                      <td className="mono text-sm">{l.size || <span className="faint">—</span>}</td>
                      <td>
                        <div style={{display: 'flex', justifyContent: 'flex-end'}}>
                          <NumberStep value={l.planned} min={1} onChange={(v) => updateLine(l.id, { planned: v })}/>
                        </div>
                      </td>
                      <td>
                        <button className="btn ghost icon sm" onClick={() => removeLine(l.id)}>
                          <Icon name="trash" size={13}/>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{background: 'var(--c-bg-sunken)'}}>
                    <td colSpan="4" style={{padding: '10px 12px', fontWeight: 500, fontSize: 12.5}}>
                      Итого: {totalSku} SKU
                    </td>
                    <td className="num" style={{padding: '10px 12px', fontWeight: 600, fontSize: 14}}>{totalQty}</td>
                    <td/>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>

          {/* Принципы — компактный блок */}
          <div className="card" style={{background: 'var(--c-bg-sunken)'}}>
            <div className="card-body" style={{padding: '14px 16px'}}>
              <div className="row gap-8" style={{marginBottom: 8}}>
                <Icon name="shield" size={14} style={{color: 'var(--c-accent)'}}/>
                <span style={{fontSize: 12.5, fontWeight: 600}}>Принципы новой модели</span>
              </div>
              <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 24px', fontSize: 11.5, color: 'var(--c-text-muted)', lineHeight: 1.55}}>
                <div>· Данные не изменяются — только добавляются операции</div>
                <div>· Любое состояние документа вычисляется из журнала</div>
                <div>· Документ — контейнер, не источник истины</div>
                <div>· Остатки формируются только из операций приёмки</div>
                <div>· Нельзя выбрать SKU чужого клиента</div>
                <div>· План не влияет на склад, только факт</div>
              </div>
            </div>
          </div>
        </div>

        {/* Правая колонка: предпросмотр первых операций */}
        <div className="col gap-16" style={{position: 'sticky', top: 0}}>
          <div className="card">
            <div className="card-head">
              <Icon name="check" size={15} style={{color: 'var(--c-success)'}}/>
              <div className="card-head-title">Готовность</div>
            </div>
            <div style={{padding: '4px 0'}}>
              {[
                { ok: true, label: 'Клиент указан' },
                { ok: true, label: 'Дата прибытия' },
                { ok: lines.length > 0, label: `Строк добавлено: ${lines.length}` },
                { ok: lines.every(l => l.sku && l.planned >= 1), label: 'Все строки валидны (SKU + ≥1)' },
              ].map((c, i) => (
                <div key={i} style={{display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', fontSize: 13}}>
                  {c.ok ? (
                    <div style={{width: 16, height: 16, borderRadius: 50, background: 'var(--c-success-bg)', color: 'var(--c-success)', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                      <Icon name="check" size={10}/>
                    </div>
                  ) : (
                    <div style={{width: 16, height: 16, borderRadius: 50, border: '1.5px dashed var(--c-text-faint)'}}/>
                  )}
                  <span style={{color: c.ok ? 'var(--c-text)' : 'var(--c-text-muted)'}}>{c.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Предпросмотр будущего журнала */}
          <div className="card">
            <div className="card-head">
              <Icon name="layers" size={15} style={{color: 'var(--c-accent)'}}/>
              <div className="card-head-title">Будут зафиксированы</div>
              <span className="text-xs subtle" style={{marginLeft: 'auto'}}>{1 + lines.length} опер.</span>
            </div>
            <div style={{padding: '4px 0 8px'}}>
              <div style={{display: 'flex', gap: 10, padding: '8px 14px', alignItems: 'flex-start'}}>
                <div style={{
                  width: 22, height: 22, borderRadius: 50,
                  background: 'var(--c-accent-bg)',
                  border: '1px solid var(--c-accent-border)',
                  color: 'var(--c-accent)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flex: '0 0 22px',
                }}>
                  <Icon name="plus" size={11}/>
                </div>
                <div style={{minWidth: 0, flex: 1}}>
                  <div style={{fontSize: 12.5, fontWeight: 500}}>Создание документа</div>
                  <div className="text-xs subtle">черновик · клиент, дата, ТТН, зона</div>
                </div>
              </div>
              {lines.slice(0, 4).map((l, i) => (
                <div key={l.id} style={{display: 'flex', gap: 10, padding: '6px 14px', alignItems: 'flex-start'}}>
                  <div style={{
                    width: 22, height: 22, borderRadius: 50,
                    background: 'var(--c-bg-sunken)',
                    border: '1px solid var(--c-border)',
                    color: 'var(--c-text-muted)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flex: '0 0 22px',
                  }}>
                    <Icon name="plus" size={11}/>
                  </div>
                  <div style={{minWidth: 0, flex: 1}}>
                    <div style={{fontSize: 12.5, fontWeight: 500}}>Добавление строки</div>
                    <div className="text-xs subtle mono" style={{whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                      {l.sku} · {l.color} · {l.size} — {l.planned}
                    </div>
                  </div>
                </div>
              ))}
              {lines.length > 4 && (
                <div className="text-xs subtle" style={{padding: '4px 14px 8px 46px'}}>
                  и ещё {lines.length - 4} строк…
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <Icon name="chart" size={15} style={{color: 'var(--c-accent)'}}/>
              <div className="card-head-title">Итого</div>
            </div>
            <div style={{padding: 16, display: 'grid', gridTemplateColumns: 'auto 1fr', rowGap: 10, columnGap: 12, fontSize: 13}}>
              <span className="muted">SKU</span><span style={{textAlign: 'right'}} className="mono">{totalSku}</span>
              <span className="muted">Строк</span><span style={{textAlign: 'right'}} className="mono">{lines.length}</span>
              <span className="muted">План, шт</span><span style={{textAlign: 'right', fontWeight: 500, fontSize: 14}} className="mono">{totalQty}</span>
            </div>
          </div>
        </div>
      </div>

      <Receipt2AddLineSheet
        open={showAddLine}
        onClose={() => setShowAddLine(false)}
        onAdd={(line) => { setLines(ls => [...ls, { id: Date.now(), ...line }]); setShowAddLine(false); }}
      />
    </div>
  );
};

const Receipt2AddLineSheet = ({ open, onClose, onAdd }) => {
  const [sku, setSku] = React.useState('');
  const [name, setName] = React.useState('');
  const [color, setColor] = React.useState('Чёрный');
  const [size, setSize] = React.useState('M');
  const [qty, setQty] = React.useState(10);

  const pick = (s) => { setSku(s.sku); setName(s.name); };

  return (
    <SideSheet
      open={open}
      onClose={onClose}
      title="Добавить строку"
      subtitle="Операция line_add — после фиксации не изменяется"
      width={460}
      footer={
        <>
          <button className="btn" onClick={onClose}>Отмена</button>
          <button
            className="btn primary"
            disabled={!sku || qty < 1}
            onClick={() => onAdd({
              sku: sku || 'NEW-SKU',
              name: name || 'Без названия',
              color, size,
              planned: qty,
            })}
          >
            <Icon name="plus" size={13}/>Добавить
          </button>
        </>
      }
    >
      <Field label="SKU / Артикул" required>
        <div style={{position: 'relative'}}>
          <Icon name="search" size={14} style={{position: 'absolute', left: 10, top: 8, color: 'var(--c-text-subtle)'}}/>
          <input
            className="input"
            style={{paddingLeft: 32}}
            placeholder="MNG-TS-01"
            value={sku}
            onChange={(e) => setSku(e.target.value)}
          />
        </div>
      </Field>

      <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14}}>
        <Field label="Цвет">
          <Select
            value={color} onChange={setColor}
            options={D.colors.slice(0, 8)}
            prefix="palette"
          />
        </Field>
        <Field label="Размер">
          <Select
            value={size} onChange={setSize}
            options={['XS','S','M','L','XL','XXL','One Size']}
            prefix="ruler"
          />
        </Field>
      </div>

      <Field label="Плановое количество" required hint="≥ 1">
        <NumberStep value={qty} min={1} onChange={setQty} width={160}/>
      </Field>
    </SideSheet>
  );
};

window.Receipt2Create = Receipt2Create;
