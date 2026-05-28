// === Product create/edit — full-page form with variant matrix ===
const ProductEdit = ({ onNavigate, isNew = true }) => {
  const [name, setName] = React.useState(isNew ? '' : 'Футболка базовая');
  const [skuBase, setSkuBase] = React.useState(isNew ? '' : 'MNG-TS-01');
  const [client, setClient] = React.useState('cl-01');
  const [type, setType] = React.useState('tshirt');
  const [requiresColor, setRequiresColor] = React.useState(true);
  const [requiresSize, setRequiresSize] = React.useState(true);
  const [selectedColors, setSelectedColors] = React.useState(['Чёрный', 'Белый', 'Кремовый']);
  const [selectedSizes, setSelectedSizes] = React.useState(['S', 'M', 'L', 'XL']);

  // Build variant matrix
  const variants = React.useMemo(() => {
    const colors = requiresColor ? selectedColors : ['—'];
    const sizes = requiresSize ? selectedSizes : ['—'];
    const out = [];
    for (const c of colors) {
      for (const s of sizes) {
        const cCode = { 'Чёрный': 'BLK', 'Белый': 'WHT', 'Кремовый': 'CRM', 'Серый меланж': 'GRY', 'Тёмно-синий': 'NVY', 'Бордовый': 'BRD', 'Терракотовый': 'TRC', 'Хаки': 'KHK', 'Оливковый': 'OLV', 'Графит': 'GRA' }[c] || '—';
        out.push({
          color: c, size: s,
          sku: skuBase ? `${skuBase}-${cCode}-${s}` : '—',
          dim: [340, 290, 20],
          active: true,
        });
      }
    }
    return out;
  }, [requiresColor, requiresSize, selectedColors, selectedSizes, skuBase]);

  return (
    <div className="page">
      <div className="page-header" style={{alignItems: 'flex-start'}}>
        <div>
          <div className="row gap-8" style={{marginBottom: 6}}>
            <button className="btn ghost sm icon" onClick={() => onNavigate('dictionaries')}>
              <Icon name="arrowLeft" size={14}/>
            </button>
            <Badge dot>{isNew ? 'Новый товар' : 'Редактирование'}</Badge>
            {!isNew && <span className="text-xs subtle mono">{skuBase}</span>}
          </div>
          <div className="page-title">{isNew ? 'Создать товар' : name || 'Без названия'}</div>
          <div className="page-subtitle">Базовая информация + матрица вариантов</div>
        </div>
        <div className="row gap-8">
          <button className="btn ghost" onClick={() => onNavigate('dictionaries')}>Отмена</button>
          <button className="btn"><Icon name="file" size={14}/>Сохранить черновик</button>
          <button className="btn primary" onClick={() => onNavigate('dictionaries')}>
            <Icon name="check" size={14}/>{isNew ? 'Создать' : 'Сохранить'}
          </button>
        </div>
      </div>

      <div style={{display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, alignItems: 'start'}}>
        <div className="col gap-16">
          {/* Section: Основное */}
          <div className="card">
            <div className="card-head">
              <Icon name="box" size={15} style={{color: 'var(--c-accent)'}}/>
              <div className="card-head-title">Основное</div>
            </div>
            <div className="card-body">
              <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14}}>
                <Field label="Название" required>
                  <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Например: Футболка базовая"/>
                </Field>
                <Field label="Тип товара" required>
                  <Select
                    value={type}
                    onChange={(v) => {
                      setType(v);
                      const pres = { tshirt: [true, true], hoodie: [true, true], cap: [true, false], bag: [false, false], bottle: [false, false] }[v];
                      if (pres) { setRequiresColor(pres[0]); setRequiresSize(pres[1]); }
                    }}
                    options={[
                      { value: 'tshirt', label: 'Футболка' },
                      { value: 'hoodie', label: 'Худи' },
                      { value: 'cap', label: 'Кепка' },
                      { value: 'bag', label: 'Сумка' },
                      { value: 'dress', label: 'Платье' },
                      { value: 'bottle', label: 'Бутылка' },
                    ]}
                  />
                </Field>
                <Field label="Базовый SKU" required hint="без цвета/размера">
                  <input className="input mono" style={{fontFamily: 'var(--font-mono)'}} value={skuBase} onChange={(e) => setSkuBase(e.target.value.toUpperCase())} placeholder="MNG-TS-01"/>
                </Field>
                <Field label="Клиент-владелец" required>
                  <Select
                    value={client}
                    onChange={setClient}
                    options={D.clients.map(c => ({ value: c.id, label: c.name }))}
                    prefix="user"
                  />
                </Field>
              </div>

              <div style={{display: 'flex', gap: 28, padding: '6px 0 4px'}}>
                <Toggle checked={requiresColor} onChange={setRequiresColor} label="Имеет цвет"/>
                <Toggle checked={requiresSize} onChange={setRequiresSize} label="Имеет размер"/>
                <div className="text-xs subtle" style={{marginLeft: 'auto'}}>Определяет генерацию вариантов</div>
              </div>
            </div>
          </div>

          {/* Section: Фото */}
          <div className="card">
            <div className="card-head">
              <Icon name="palette" size={15} style={{color: 'var(--c-accent)'}}/>
              <div className="card-head-title">Фото и медиа</div>
              <span className="text-xs subtle">PNG, JPG · до 5 МБ</span>
            </div>
            <div className="card-body">
              <div style={{display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10}}>
                {['🎽', '👕', '🧥'].map((emoji, i) => (
                  <div key={i} style={{aspectRatio: 1, borderRadius: 8, background: 'var(--c-bg-sunken)', border: '1px solid var(--c-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, position: 'relative', cursor: 'grab'}}>
                    {emoji}
                    {i === 0 && <div style={{position: 'absolute', top: 4, left: 4, fontSize: 9, color: 'white', background: 'var(--c-accent)', padding: '2px 5px', borderRadius: 3, fontWeight: 500}}>ГЛАВНОЕ</div>}
                    <button className="btn ghost icon sm" style={{position: 'absolute', top: 4, right: 4, height: 22, width: 22}}><Icon name="x" size={11}/></button>
                  </div>
                ))}
                <div className="dropzone" style={{padding: 0, aspectRatio: 1, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                  <div style={{textAlign: 'center'}}>
                    <Icon name="upload" size={18}/>
                    <div className="text-xs" style={{marginTop: 4}}>Загрузить</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Section: Варианты */}
          {(requiresColor || requiresSize) && (
            <div className="card">
              <div className="card-head">
                <Icon name="layers" size={15} style={{color: 'var(--c-accent)'}}/>
                <div className="card-head-title">Варианты</div>
                <span className="badge accent" style={{marginLeft: 6}}>{variants.length} шт</span>
                <div className="right text-xs subtle">авто-генерация по комбинациям</div>
              </div>

              <div className="card-body" style={{borderBottom: '1px solid var(--c-border)'}}>
                {requiresColor && (
                  <Field label="Цвета" hint={`${selectedColors.length} выбрано`}>
                    <div style={{display: 'flex', flexWrap: 'wrap', gap: 6}}>
                      {D.colors.map(c => {
                        const on = selectedColors.includes(c);
                        return (
                          <button
                            key={c}
                            className={`chip ${on ? 'active' : ''}`}
                            style={{borderStyle: 'solid'}}
                            onClick={() => setSelectedColors(s => on ? s.filter(x => x !== c) : [...s, c])}
                          >
                            <div style={{
                              width: 11, height: 11, borderRadius: 50,
                              background: { 'Чёрный': '#1a1a18', 'Белый': '#ffffff', 'Кремовый': '#f1e7d1', 'Серый меланж': '#9ca0a3', 'Тёмно-синий': '#1a2f55', 'Бордовый': '#7a1f33', 'Терракотовый': '#b45a3c', 'Хаки': '#7a6c2e', 'Оливковый': '#4d5926', 'Графит': '#3d3a36' }[c] || 'var(--c-text-subtle)',
                              border: '1px solid var(--c-border-strong)',
                            }}/>
                            {c}
                          </button>
                        );
                      })}
                    </div>
                  </Field>
                )}

                {requiresSize && (
                  <Field label="Размеры" hint={`${selectedSizes.length} выбрано`}>
                    <div style={{display: 'flex', flexWrap: 'wrap', gap: 6}}>
                      {D.sizes.map(s => {
                        const on = selectedSizes.includes(s);
                        return (
                          <button
                            key={s}
                            className={`chip ${on ? 'active' : ''}`}
                            style={{borderStyle: 'solid', fontFamily: 'var(--font-mono)'}}
                            onClick={() => setSelectedSizes(arr => on ? arr.filter(x => x !== s) : [...arr, s])}
                          >
                            {s}
                          </button>
                        );
                      })}
                    </div>
                  </Field>
                )}
              </div>

              <table className="t">
                <thead>
                  <tr>
                    <th>Полный SKU</th>
                    {requiresColor && <th style={{width: 130}}>Цвет</th>}
                    {requiresSize && <th style={{width: 80}}>Размер</th>}
                    <th style={{width: 200}}>Габариты, мм</th>
                    <th style={{width: 90}}>Активен</th>
                  </tr>
                </thead>
                <tbody>
                  {variants.slice(0, 12).map((v, i) => (
                    <tr key={i}>
                      <td className="mono" style={{fontSize: 12.5, fontWeight: 500}}>{v.sku}</td>
                      {requiresColor && (
                        <td>
                          <div className="row gap-8">
                            <div style={{width: 14, height: 14, borderRadius: 50, background: { 'Чёрный': '#1a1a18', 'Белый': '#ffffff', 'Кремовый': '#f1e7d1', 'Серый меланж': '#9ca0a3', 'Тёмно-синий': '#1a2f55', 'Бордовый': '#7a1f33', 'Графит': '#3d3a36' }[v.color] || 'var(--c-bg-sunken)', border: '1px solid var(--c-border)'}}/>
                            <span className="text-sm">{v.color}</span>
                          </div>
                        </td>
                      )}
                      {requiresSize && <td><span className="badge">{v.size}</span></td>}
                      <td>
                        <div className="row gap-4" style={{fontFamily: 'var(--font-mono)', fontSize: 12.5}}>
                          <input className="input sm" style={{width: 50, padding: 4, textAlign: 'center'}} defaultValue={v.dim[0]}/>
                          <span className="faint">×</span>
                          <input className="input sm" style={{width: 50, padding: 4, textAlign: 'center'}} defaultValue={v.dim[1]}/>
                          <span className="faint">×</span>
                          <input className="input sm" style={{width: 50, padding: 4, textAlign: 'center'}} defaultValue={v.dim[2]}/>
                        </div>
                      </td>
                      <td><Toggle checked={v.active}/></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {variants.length > 12 && (
                <div style={{padding: '10px 14px', textAlign: 'center', borderTop: '1px solid var(--c-border)', background: 'var(--c-bg-sunken)'}}>
                  <span className="text-xs subtle">… и ещё {variants.length - 12} вариантов</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="col gap-16">
          <div className="card">
            <div className="card-head">
              <Icon name="check" size={15} style={{color: 'var(--c-success)'}}/>
              <div className="card-head-title">Готовность</div>
            </div>
            <div style={{padding: '4px 0'}}>
              {[
                { ok: !!name, label: 'Название заполнено' },
                { ok: !!skuBase, label: 'Базовый SKU' },
                { ok: variants.length > 0, label: `Вариантов: ${variants.length}` },
                { ok: false, label: 'Загружено фото' },
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
              <Icon name="qr" size={15}/>
              <div className="card-head-title">Превью</div>
            </div>
            <div style={{padding: 16, textAlign: 'center'}}>
              <div style={{
                width: 100, height: 100, margin: '0 auto 14px',
                borderRadius: 12, background: 'var(--c-bg-sunken)', border: '1px solid var(--c-border)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 44,
              }}>🎽</div>
              <div style={{fontSize: 14, fontWeight: 500}}>{name || '—'}</div>
              <div className="text-xs subtle mono" style={{marginTop: 4}}>{skuBase || '—'}</div>
              <div className="mt-12">
                <Badge tone="accent">{variants.length} вариантов</Badge>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

window.ProductEdit = ProductEdit;
