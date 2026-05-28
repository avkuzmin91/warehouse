// === Receipt create (full-page form) ===
const ReceiptCreate = ({ onNavigate }) => {
  const [lines, setLines] = React.useState([
    { id: 1, sku: 'MNG-TS-01-BLK-M', name: 'Футболка базовая · Чёрный · M', planned: 60 },
    { id: 2, sku: 'MNG-TS-01-BLK-L', name: 'Футболка базовая · Чёрный · L', planned: 80 },
    { id: 3, sku: 'MNG-HD-12-GRA-L', name: 'Худи oversize · Графит · L', planned: 40 },
  ]);
  const [client, setClient] = React.useState('cl-01');
  const [showAddLine, setShowAddLine] = React.useState(false);

  const addLine = () => {
    setLines(ls => [...ls, { id: Date.now(), sku: '', name: 'Новая строка', planned: 0 }]);
  };
  const removeLine = (id) => setLines(ls => ls.filter(l => l.id !== id));
  const updateLine = (id, patch) => setLines(ls => ls.map(l => l.id === id ? {...l, ...patch} : l));

  const totalQty = lines.reduce((s, l) => s + (l.planned || 0), 0);
  const totalSku = new Set(lines.map(l => l.sku.split('-').slice(0, 2).join('-')).filter(Boolean)).size;

  return (
    <div className="page">
      <div className="page-header" style={{alignItems: 'flex-start'}}>
        <div>
          <div className="row gap-8" style={{marginBottom: 6}}>
            <button className="btn ghost sm icon" onClick={() => onNavigate('receipts')}>
              <Icon name="arrowLeft" size={14}/>
            </button>
            <Badge dot>Черновик</Badge>
            <span className="text-xs subtle">не сохранено</span>
          </div>
          <div className="page-title">Новое поступление</div>
          <div className="page-subtitle">Создайте документ ожидаемого товара от клиента или поставщика</div>
        </div>
        <div className="row gap-8">
          <button className="btn ghost" onClick={() => onNavigate('receipts')}>Отмена</button>
          <button className="btn"><Icon name="file" size={14}/>Сохранить черновик</button>
          <button className="btn primary" onClick={() => onNavigate('receiptDetail')}>
            <Icon name="check" size={14}/>Создать и начать приёмку
          </button>
        </div>
      </div>

      <div style={{display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, alignItems: 'start'}}>
        {/* Main column */}
        <div className="col gap-16">
          {/* Section: Документ */}
          <div className="card">
            <div className="card-head">
              <Icon name="file" size={15} style={{color: 'var(--c-accent)'}}/>
              <div className="card-head-title">Документ</div>
              <div className="right text-xs subtle">Шаг 1 из 3</div>
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
                <Field label="Поставщик">
                  <input className="input" placeholder="Mango RU LLC" defaultValue="Mango RU LLC"/>
                </Field>
                <Field label="Дата прибытия" required>
                  <div style={{position: 'relative'}}>
                    <Icon name="calendar" size={14} style={{position: 'absolute', left: 10, top: 8, color: 'var(--c-text-subtle)'}}/>
                    <input className="input" style={{paddingLeft: 32}} defaultValue="23 мая 2026, 14:30"/>
                  </div>
                </Field>
                <Field label="ТТН / номер накладной">
                  <input className="input" placeholder="TTN-77821" defaultValue="TTN-77821"/>
                </Field>
                <Field label="Зона разгрузки">
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
                <Field label="Тип приёмки">
                  <Select
                    value="full"
                    options={[
                      { value: 'full', label: 'Полная (поштучная)' },
                      { value: 'partial', label: 'Выборочная' },
                      { value: 'package', label: 'По упаковкам' },
                    ]}
                  />
                </Field>
              </div>

              <Field label="Комментарий" hint="видно всем участникам процесса">
                <textarea className="input" style={{height: 56, padding: 8, resize: 'vertical'}} placeholder="Что нужно знать оператору…"/>
              </Field>
            </div>
          </div>

          {/* Section: Строки */}
          <div className="card">
            <div className="card-head">
              <Icon name="boxes" size={15} style={{color: 'var(--c-accent)'}}/>
              <div className="card-head-title">Ожидаемые строки</div>
              <span className="badge accent" style={{marginLeft: 6}}>{lines.length}</span>
              <div className="right row gap-8">
                <button className="btn sm"><Icon name="upload" size={12}/>Из Excel</button>
                <button className="btn sm"><Icon name="qr" size={12}/>Сканер</button>
                <button className="btn sm primary" onClick={() => setShowAddLine(true)}>
                  <Icon name="plus" size={12}/>Добавить
                </button>
              </div>
            </div>

            {lines.length === 0 ? (
              <div className="empty">
                <div className="empty-illust"/>
                <div style={{fontSize: 14, fontWeight: 500, color: 'var(--c-text)'}}>Нет ожидаемых строк</div>
                <div className="text-sm muted mt-8">Добавьте товары вручную, отсканируйте или импортируйте из Excel</div>
              </div>
            ) : (
              <table className="t">
                <thead>
                  <tr>
                    <th style={{width: 30}}></th>
                    <th>SKU · Товар</th>
                    <th style={{width: 130, textAlign: 'right'}}>План, шт</th>
                    <th style={{width: 100, textAlign: 'right'}}>Цена</th>
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
                      <td>
                        <div style={{display: 'flex', justifyContent: 'flex-end'}}>
                          <NumberStep value={l.planned} onChange={(v) => updateLine(l.id, { planned: v })}/>
                        </div>
                      </td>
                      <td className="num muted">—</td>
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
                    <td colSpan="2" style={{padding: '10px 12px', fontWeight: 500, fontSize: 12.5}}>
                      Итого: {totalSku} SKU
                    </td>
                    <td className="num" style={{padding: '10px 12px', fontWeight: 600, fontSize: 14}}>{totalQty}</td>
                    <td colSpan="2" style={{padding: '10px 12px'}} className="text-xs muted">шт</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>

        {/* Right column: summary + checklist */}
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
                { ok: false, label: 'Назначен оператор приёмки' },
                { ok: false, label: 'Зона свободна' },
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

          <div className="card">
            <div className="card-head">
              <Icon name="chart" size={15} style={{color: 'var(--c-accent)'}}/>
              <div className="card-head-title">Итого</div>
            </div>
            <div style={{padding: 16, display: 'grid', gridTemplateColumns: 'auto 1fr', rowGap: 10, columnGap: 12, fontSize: 13}}>
              <span className="muted">SKU</span><span className="right mono" style={{textAlign: 'right'}}>{totalSku}</span>
              <span className="muted">Строк</span><span className="right mono" style={{textAlign: 'right'}}>{lines.length}</span>
              <span className="muted">Кол-во</span><span className="right mono" style={{textAlign: 'right', fontWeight: 500, fontSize: 14}}>{totalQty}</span>
              <span className="muted">Объём, ~м³</span><span className="right mono" style={{textAlign: 'right'}}>0.84</span>
              <span className="muted">Паллет, ~шт</span><span className="right mono" style={{textAlign: 'right'}}>4</span>
            </div>
          </div>

          <div className="card" style={{background: 'var(--c-accent-bg)', borderColor: 'var(--c-accent-border)'}}>
            <div style={{padding: 14}}>
              <div className="row gap-8" style={{marginBottom: 6}}>
                <Icon name="sparkles" size={14} style={{color: 'var(--c-accent)'}}/>
                <span style={{fontWeight: 500, fontSize: 12.5, color: 'var(--c-accent-text)'}}>Совет</span>
              </div>
              <div className="text-sm" style={{color: 'var(--c-accent-text)'}}>
                Mango Republic обычно доставляет товар на паллете по 280 шт. Проверьте формат упаковки до прибытия.
              </div>
            </div>
          </div>
        </div>
      </div>

      <AddLineSheet
        open={showAddLine}
        onClose={() => setShowAddLine(false)}
        onAdd={(line) => { setLines(ls => [...ls, { id: Date.now(), ...line }]); setShowAddLine(false); }}
      />
    </div>
  );
};

// Side sheet for adding a line
const AddLineSheet = ({ open, onClose, onAdd }) => {
  const [sku, setSku] = React.useState('');
  const [qty, setQty] = React.useState(10);
  return (
    <SideSheet
      open={open}
      onClose={onClose}
      title="Добавить строку"
      subtitle="Найдите SKU или отсканируйте"
      width={460}
      footer={
        <>
          <button className="btn" onClick={onClose}>Отмена</button>
          <button className="btn primary" onClick={() => onAdd({ sku: sku || 'NEW-SKU', name: sku || 'Без названия', planned: qty })}>
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
            placeholder="MNG-TS-01-…"
            value={sku}
            onChange={(e) => setSku(e.target.value)}
          />
        </div>
      </Field>

      <div className="text-xs subtle" style={{marginBottom: 8, marginTop: 8}}>Подсказки</div>
      <div className="col gap-4">
        {[
          { sku: 'MNG-TS-01-BLK-S', name: 'Футболка базовая · Чёрный · S' },
          { sku: 'MNG-TS-01-WHT-M', name: 'Футболка базовая · Белый · M' },
          { sku: 'MNG-HD-12-GRA-XL', name: 'Худи oversize · Графит · XL' },
        ].map(s => (
          <div key={s.sku}
               onClick={() => setSku(s.sku)}
               style={{display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 6, cursor: 'pointer', background: sku === s.sku ? 'var(--c-accent-bg)' : 'transparent'}}>
            <div style={{width: 28, height: 28, borderRadius: 5, background: 'var(--c-bg-sunken)', display: 'flex', alignItems: 'center', justifyContent: 'center'}}><Icon name="box" size={14} style={{color: 'var(--c-text-muted)'}}/></div>
            <div style={{flex: 1}}>
              <div className="mono" style={{fontSize: 12.5, fontWeight: 500}}>{s.sku}</div>
              <div className="text-xs subtle">{s.name}</div>
            </div>
          </div>
        ))}
      </div>

      <Field label="Ожидаемое количество" required>
        <NumberStep value={qty} onChange={setQty} width={140}/>
      </Field>

      <Field label="Заметка к строке">
        <input className="input" placeholder="Например: проверить с особым вниманием"/>
      </Field>
    </SideSheet>
  );
};

window.ReceiptCreate = ReceiptCreate;
