// === Receipt detail — the process screen ===

const ReceiptDetailScreen = ({ onNavigate }) => {
  const [step, setStep] = React.useState(2); // 1: draft, 2: arrived, 3: counting, 4: confirmed
  const [activeRow, setActiveRow] = React.useState(0);

  const steps = [
    { label: 'Создан', value: '23 мая, 14:08 · Анна С.' },
    { label: 'Прибыло', value: '23 мая, 14:32 · Сергей Д.' },
    { label: 'Приёмка', value: 'В процессе · 4 из 8 строк' },
    { label: 'Подтверждено', value: 'Ожидает завершения' },
  ];

  const total = D.receiptItems.reduce((s, r) => s + r.planned, 0);
  const accepted = D.receiptItems.reduce((s, r) => s + (r.accepted || 0), 0);
  const defects = D.receiptItems.reduce((s, r) => s + r.defect, 0);

  return (
    <div className="page">
      <div className="page-header" style={{alignItems: 'flex-start'}}>
        <div>
          <div className="row gap-8" style={{marginBottom: 6}}>
            <button className="btn ghost sm icon" onClick={() => onNavigate('receipts')}>
              <Icon name="arrowLeft" size={14}/>
            </button>
            <Badge tone="info" dot>Приёмка</Badge>
            <span className="text-xs subtle">создано 23 мая, 14:08</span>
          </div>
          <div className="page-title" style={{display: 'flex', alignItems: 'baseline', gap: 10}}>
            <span className="mono" style={{fontWeight: 500}}>RCP-0421</span>
            <span style={{fontSize: 14, color: 'var(--c-text-muted)', fontWeight: 450}}>· Mango Republic · паллеты 1–4</span>
          </div>
        </div>
        <div className="row gap-8">
          <button className="btn"><Icon name="download" size={14}/>Накладная</button>
          <button className="btn"><Icon name="qr" size={14}/>Сканер</button>
          <button className="btn primary"><Icon name="check" size={14}/>Завершить приёмку</button>
        </div>
      </div>

      {/* Stepper */}
      <div className="stepper">
        {steps.map((s, i) => {
          const state = i < step - 1 ? 'done' : i === step - 1 ? 'active' : '';
          return (
            <div key={i} className={`step ${state}`}>
              <div className="row gap-8">
                <div className="step-num">{state === 'done' ? <Icon name="check" size={11}/> : i + 1}</div>
                <span className="step-value">{s.label}</span>
              </div>
              <div className="step-label">{s.value}</div>
            </div>
          );
        })}
      </div>

      {/* KPI row */}
      <div className="kpi-grid mt-16" style={{gridTemplateColumns: 'repeat(4, 1fr)'}}>
        <div className="kpi">
          <div className="kpi-label">Планируется</div>
          <div className="kpi-value">{total}</div>
          <div className="text-xs subtle">{D.receiptItems.length} строк · 8 SKU</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Принято</div>
          <div className="kpi-value">{accepted}<span style={{fontSize: 14, color: 'var(--c-text-subtle)', fontWeight: 500, marginLeft: 6}}>/ {total}</span></div>
          <div className="prog mt-8"><div className="prog-fill" style={{width: `${(accepted/total)*100}%`}}/></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Брак</div>
          <div className="kpi-value" style={{color: defects > 0 ? 'var(--c-warning)' : ''}}>{defects}</div>
          <div className="text-xs subtle">2 SKU, оформить акт</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Расхождение</div>
          <div className="kpi-value" style={{color: 'var(--c-danger)'}}>−4</div>
          <div className="text-xs subtle">не пришло против плана</div>
        </div>
      </div>

      {/* Split view: rows + right panel */}
      <div className="mt-20" style={{display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16}}>
        {/* Rows table */}
        <div className="t-wrap">
          <div className="card-head">
            <Icon name="boxes" size={15} style={{color: 'var(--c-accent)'}}/>
            <div className="card-head-title">Строки приёмки</div>
            <span className="badge accent" style={{marginLeft: 6}}>{D.receiptItems.length}</span>
            <div className="right row gap-8">
              <div className="topbar-search" style={{minWidth: 180, height: 26}}>
                <Icon name="search" size={12}/><span>Найти строку…</span>
              </div>
              <button className="btn sm"><Icon name="plus" size={12}/>Добавить</button>
            </div>
          </div>
          <table className="t">
            <thead>
              <tr>
                <th style={{width: 28}}></th>
                <th>SKU · Вариант</th>
                <th style={{width: 80, textAlign: 'right'}}>План</th>
                <th style={{width: 110, textAlign: 'right'}}>Принято</th>
                <th style={{width: 70, textAlign: 'right'}}>Брак</th>
                <th style={{width: 110}}>Статус</th>
                <th style={{width: 28}}></th>
              </tr>
            </thead>
            <tbody>
              {D.receiptItems.map((r, i) => {
                const isActive = i === activeRow;
                return (
                  <tr key={i}
                      onClick={() => setActiveRow(i)}
                      style={{background: isActive ? 'var(--c-accent-bg)' : ''}}>
                    <td>
                      {r.status === 'reviewed'
                        ? <div style={{width: 14, height: 14, borderRadius: 50, background: 'var(--c-success)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white'}}><Icon name="check" size={9}/></div>
                        : r.status === 'in'
                        ? <div style={{width: 14, height: 14, borderRadius: 50, border: '2px solid var(--c-info)', borderTopColor: 'transparent', animation: 'spin 1.4s linear infinite'}}/>
                        : <div style={{width: 14, height: 14, borderRadius: 50, border: '1.5px dashed var(--c-text-faint)'}}/>}
                    </td>
                    <td>
                      <div style={{fontSize: 13, fontWeight: 450}}>{r.name}</div>
                      <div className="text-xs subtle mono">{r.sku} · {r.variant}</div>
                    </td>
                    <td className="num">{r.planned}</td>
                    <td className="num">
                      {r.accepted !== null ? (
                        <span style={{color: r.accepted < r.planned ? 'var(--c-warning)' : 'var(--c-text)', fontWeight: 500}}>{r.accepted}</span>
                      ) : <span className="faint">—</span>}
                    </td>
                    <td className="num">
                      {r.defect > 0 ? <span style={{color: 'var(--c-warning)', fontWeight: 500}}>{r.defect}</span> : <span className="faint">0</span>}
                    </td>
                    <td>
                      <Badge tone={statusTone(r.status)} dot>
                        {r.status === 'reviewed' ? 'Принято' : r.status === 'in' ? 'Считается' : 'Не начато'}
                      </Badge>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button className="btn ghost icon sm"><Icon name="more" size={14}/></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Right side panel — scan + assist */}
        <div className="col gap-16">
          <div className="card">
            <div className="card-head">
              <Icon name="qr" size={15} style={{color: 'var(--c-accent)'}}/>
              <div className="card-head-title">Сканер</div>
              <span className="text-xs subtle" style={{marginLeft: 'auto'}}>HID · готов</span>
            </div>
            <div className="card-body" style={{textAlign: 'center', paddingTop: 18, paddingBottom: 22}}>
              <div style={{
                width: 86, height: 86, borderRadius: 16,
                background: 'var(--c-accent-bg)', border: '1px dashed var(--c-accent-border)',
                margin: '0 auto 14px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--c-accent)',
              }}>
                <Icon name="qr" size={36}/>
              </div>
              <div style={{fontSize: 13, fontWeight: 500, marginBottom: 4}}>Отсканируйте товар</div>
              <div className="text-xs subtle">Или введите SKU вручную</div>
              <input className="input mt-12" placeholder="MNG-TS-01-…"/>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <Icon name="alert" size={15} style={{color: 'var(--c-warning)'}}/>
              <div className="card-head-title">Брак по строке</div>
            </div>
            <div className="card-body">
              <div className="text-xs subtle" style={{marginBottom: 6}}>Активная: MNG-TS-01 · Чёрный · M</div>
              <div className="field">
                <label className="label">Количество</label>
                <input className="input" defaultValue={2}/>
              </div>
              <div className="field" style={{marginBottom: 6}}>
                <label className="label">Причина</label>
                <select className="input" defaultValue="seam">
                  <option value="seam">Брак шва</option>
                  <option value="stain">Пятно на ткани</option>
                  <option value="size">Не соответствует размеру</option>
                  <option value="pkg">Повреждение упаковки</option>
                </select>
              </div>
              <button className="btn primary" style={{width: '100%', marginTop: 6}}>
                <Icon name="plus" size={13}/>Зафиксировать брак
              </button>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <Icon name="user" size={15}/>
              <div className="card-head-title">Документ</div>
            </div>
            <div className="card-body" style={{display: 'grid', gridTemplateColumns: '90px 1fr', rowGap: 8, fontSize: 12.5}}>
              <span className="muted">Клиент</span><span>Mango Republic</span>
              <span className="muted">Поставщик</span><span>Mango RU LLC</span>
              <span className="muted">ТТН</span><span className="mono">TTN-77821</span>
              <span className="muted">Прибытие</span><span>23 мая, 14:32</span>
              <span className="muted">Зона</span><span className="mono">A-12 · док №3</span>
              <span className="muted">Создал</span><span>Анна Сорокина</span>
            </div>
          </div>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

window.ReceiptDetailScreen = ReceiptDetailScreen;
