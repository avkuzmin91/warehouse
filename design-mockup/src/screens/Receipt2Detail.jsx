// === Поступления 2 — детализация документа с журналом операций ===
// Главный концептуальный экран: показывает, что операции — источник истины,
// а текущее состояние всегда вычисляется.

const Receipt2DetailScreen = ({ onNavigate }) => {
  const docId = 'WH-2025-0042';
  const doc = D.receipts2.find(r => r.id === docId);
  const state = D.computeReceipt2State(docId);
  const ops = [...(D.receipt2Ops[docId] || [])].reverse(); // новые сверху

  const [activeLine, setActiveLine] = React.useState('L-5');
  const [opType, setOpType] = React.useState('receive'); // receive | defect
  const [opQty, setOpQty] = React.useState(2);
  const [opReason, setOpReason] = React.useState('seam');
  const [filterLine, setFilterLine] = React.useState(null);
  const [filterType, setFilterType] = React.useState(null);

  const statusOrder = D.receipt2Statuses.findIndex(s => s.id === doc.status);
  const activeLineRow = state.lines.find(l => l.id === activeLine);

  const visibleOps = ops.filter(op => {
    if (filterLine && op.lineId !== filterLine) return false;
    if (filterType && op.type !== filterType) return false;
    return true;
  });

  return (
    <div className="page">
      <div className="page-header" style={{alignItems: 'flex-start'}}>
        <div>
          <div className="row gap-8" style={{marginBottom: 6}}>
            <button className="btn ghost sm icon" onClick={() => onNavigate('receipts2')}>
              <Icon name="arrowLeft" size={14}/>
            </button>
            <Badge tone="warning" dot>В проверке</Badge>
            <Badge tone="accent">v2</Badge>
            <span className="text-xs subtle">создан {doc.createdAt} · {doc.operator}</span>
          </div>
          <div className="page-title" style={{display: 'flex', alignItems: 'baseline', gap: 10}}>
            <span className="mono" style={{fontWeight: 500}}>{doc.id}</span>
            <span style={{fontSize: 14, color: 'var(--c-text-muted)', fontWeight: 450}}>· {doc.client} · {doc.zone}</span>
          </div>
        </div>
        <div className="row gap-8">
          <button className="btn"><Icon name="download" size={14}/>Журнал в CSV</button>
          <button className="btn"><Icon name="file" size={14}/>Накладная</button>
          <button className="btn primary"><Icon name="shield" size={14}/>Завершить проверку</button>
        </div>
      </div>

      {/* Stepper — 5 статусов из ТЗ §5 */}
      <div className="stepper">
        {D.receipt2Statuses.map((s, i) => {
          const state = i < statusOrder ? 'done' : i === statusOrder ? 'active' : '';
          // привязка примерных событий
          const ts = ({
            draft:     '23 мая, 14:08',
            created:   '23 мая, 14:14',
            arrived:   '23 мая, 15:02',
            in_review: 'в процессе',
            done:      '—',
          })[s.id];
          return (
            <div key={s.id} className={`step ${state}`}>
              <div className="row gap-8">
                <div className="step-num">{state === 'done' ? <Icon name="check" size={11}/> : i + 1}</div>
                <span className="step-value">{s.label}</span>
              </div>
              <div className="step-label">{ts}</div>
            </div>
          );
        })}
      </div>

      {/* KPI: всё вычисляется из операций */}
      <div className="kpi-grid mt-16" style={{gridTemplateColumns: 'repeat(5, 1fr)'}}>
        <div className="kpi">
          <div className="kpi-label">План</div>
          <div className="kpi-value">{state.totalPlanned}</div>
          <div className="text-xs subtle">{state.lines.length} строк · {state.skuCount} SKU</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Принято <span className="text-xs faint" style={{marginLeft: 4}}>· из операций</span></div>
          <div className="kpi-value">
            {state.totalAccepted}
            <span style={{fontSize: 14, color: 'var(--c-text-subtle)', fontWeight: 500, marginLeft: 6}}>/ {state.totalPlanned}</span>
          </div>
          <div className="prog mt-8"><div className="prog-fill" style={{width: `${(state.totalAccepted/state.totalPlanned)*100}%`}}/></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Брак <span className="text-xs faint" style={{marginLeft: 4}}>· из операций</span></div>
          <div className="kpi-value" style={{color: state.totalDefect > 0 ? 'var(--c-warning)' : ''}}>{state.totalDefect}</div>
          <div className="text-xs subtle">по 2 строкам</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Расхождение</div>
          <div className="kpi-value" style={{color: 'var(--c-danger)'}}>
            −{state.totalPlanned - state.totalAccepted - state.totalDefect}
          </div>
          <div className="text-xs subtle">план − принято − брак</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Операций</div>
          <div className="kpi-value">{state.opsCount}</div>
          <div className="text-xs subtle">immutable · полный аудит</div>
        </div>
      </div>

      {/* Главная сетка: строки + журнал операций (это сердце v2) */}
      <div className="mt-20" style={{display: 'grid', gridTemplateColumns: '1fr 420px', gap: 16}}>
        {/* Левая колонка: строки + ввод операции */}
        <div className="col gap-16">
          <div className="t-wrap">
            <div className="card-head">
              <Icon name="boxes" size={15} style={{color: 'var(--c-accent)'}}/>
              <div className="card-head-title">Строки документа</div>
              <span className="badge accent" style={{marginLeft: 6}}>{state.lines.length}</span>
              <span className="text-xs subtle" style={{marginLeft: 6}}>состояние вычислено из {state.opsCount} операций</span>
              <div className="right row gap-8">
                <button className="btn sm"><Icon name="plus" size={12}/>Строка</button>
              </div>
            </div>
            <table className="t">
              <thead>
                <tr>
                  <th style={{width: 28}}></th>
                  <th>SKU · Цвет · Размер</th>
                  <th style={{width: 70, textAlign: 'right'}}>План</th>
                  <th style={{width: 90, textAlign: 'right'}}>Принято</th>
                  <th style={{width: 70, textAlign: 'right'}}>Брак</th>
                  <th style={{width: 70, textAlign: 'right'}}>Опер.</th>
                  <th style={{width: 28}}></th>
                </tr>
              </thead>
              <tbody>
                {state.lines.map((l) => {
                  const isActive = l.id === activeLine;
                  const isFull = l.accepted >= l.planned;
                  const isStarted = l.accepted > 0 || l.defect > 0;
                  return (
                    <tr key={l.id}
                        onClick={() => setActiveLine(l.id)}
                        style={{background: isActive ? 'var(--c-accent-bg)' : ''}}>
                      <td>
                        {isFull
                          ? <div style={{width: 14, height: 14, borderRadius: 50, background: 'var(--c-success)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white'}}><Icon name="check" size={9}/></div>
                          : isStarted
                          ? <div style={{width: 14, height: 14, borderRadius: 50, border: '2px solid var(--c-info)', borderTopColor: 'transparent'}}/>
                          : <div style={{width: 14, height: 14, borderRadius: 50, border: '1.5px dashed var(--c-text-faint)'}}/>}
                      </td>
                      <td>
                        <div style={{fontSize: 13, fontWeight: 450}}>{l.name}</div>
                        <div className="text-xs subtle mono">{l.sku} · {l.color} · {l.size}</div>
                      </td>
                      <td className="num">{l.planned}</td>
                      <td className="num">
                        {l.accepted > 0
                          ? <span style={{color: l.accepted < l.planned ? 'var(--c-warning)' : 'var(--c-text)', fontWeight: 500}}>{l.accepted}</span>
                          : <span className="faint">0</span>}
                      </td>
                      <td className="num">
                        {l.defect > 0
                          ? <span style={{color: 'var(--c-warning)', fontWeight: 500}}>{l.defect}</span>
                          : <span className="faint">0</span>}
                      </td>
                      <td className="num">
                        <span
                          className="text-xs mono"
                          style={{
                            color: l.opsCount > 0 ? 'var(--c-accent)' : 'var(--c-text-faint)',
                            cursor: 'pointer',
                            textDecoration: l.opsCount > 0 ? 'underline dotted' : 'none',
                          }}
                          onClick={(e) => { e.stopPropagation(); setFilterLine(l.id); }}
                          title="Показать операции этой строки в журнале"
                        >
                          {l.opsCount}
                        </span>
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

          {/* Форма ввода новой операции — приёмка / брак */}
          <div className="card">
            <div className="card-head">
              <Icon name={opType === 'receive' ? 'check' : 'alert'} size={15}
                    style={{color: opType === 'receive' ? 'var(--c-success)' : 'var(--c-warning)'}}/>
              <div className="card-head-title">
                Новая операция
                {activeLineRow && (
                  <span className="text-xs subtle" style={{fontWeight: 400, marginLeft: 8}}>
                    → {activeLineRow.sku} · {activeLineRow.color} · {activeLineRow.size}
                  </span>
                )}
              </div>
              <span className="text-xs subtle" style={{marginLeft: 'auto'}}>
                <Icon name="lock" size={11} style={{verticalAlign: '-2px', marginRight: 4}}/>
                после фиксации операция неизменяема
              </span>
            </div>
            <div className="card-body" style={{display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 12, alignItems: 'flex-end'}}>
              <Field label="Тип операции">
                <div style={{display: 'flex', gap: 0, border: '1px solid var(--c-border-strong)', borderRadius: 'var(--r-md)', overflow: 'hidden'}}>
                  <button
                    className="btn ghost sm"
                    style={{
                      flex: 1, borderRadius: 0, height: 30, border: 0,
                      background: opType === 'receive' ? 'var(--c-success-bg)' : 'transparent',
                      color: opType === 'receive' ? 'var(--c-success)' : 'var(--c-text)',
                      fontWeight: opType === 'receive' ? 500 : 400,
                    }}
                    onClick={() => setOpType('receive')}
                  >
                    <Icon name="check" size={12}/>Приёмка
                  </button>
                  <button
                    className="btn ghost sm"
                    style={{
                      flex: 1, borderRadius: 0, height: 30, border: 0, borderLeft: '1px solid var(--c-border)',
                      background: opType === 'defect' ? 'var(--c-warning-bg, color-mix(in oklab, var(--c-warning) 14%, transparent))' : 'transparent',
                      color: opType === 'defect' ? 'var(--c-warning)' : 'var(--c-text)',
                      fontWeight: opType === 'defect' ? 500 : 400,
                    }}
                    onClick={() => setOpType('defect')}
                  >
                    <Icon name="alert" size={12}/>Брак
                  </button>
                </div>
              </Field>
              <Field label="Количество">
                <NumberStep value={opQty} onChange={setOpQty} width="100%"/>
              </Field>
              {opType === 'defect' ? (
                <Field label="Причина брака">
                  <Select
                    value={opReason}
                    onChange={setOpReason}
                    options={[
                      { value: 'seam',  label: 'Брак шва' },
                      { value: 'stain', label: 'Пятно на ткани' },
                      { value: 'size',  label: 'Не соответствует размеру' },
                      { value: 'pkg',   label: 'Повреждение упаковки' },
                    ]}
                  />
                </Field>
              ) : (
                <Field label="Комментарий">
                  <input className="input" placeholder="не обязательно"/>
                </Field>
              )}
              <button
                className="btn primary"
                style={{height: 30, alignSelf: 'flex-end'}}
              >
                <Icon name="plus" size={13}/>Зафиксировать
              </button>
            </div>
          </div>

          {/* Реквизиты документа — компактно */}
          <div className="card">
            <div className="card-head">
              <Icon name="file" size={15}/>
              <div className="card-head-title">Реквизиты документа</div>
              <button className="btn ghost sm" style={{marginLeft: 'auto'}}>
                <Icon name="edit" size={12}/>Изменить
              </button>
            </div>
            <div className="card-body" style={{display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px 24px', fontSize: 12.5}}>
              <div><div className="muted text-xs">Клиент</div><div>{doc.client}</div></div>
              <div><div className="muted text-xs">Поставщик</div><div>{doc.supplier || '—'}</div></div>
              <div><div className="muted text-xs">ТТН</div><div className="mono">{doc.ttn}</div></div>
              <div><div className="muted text-xs">Дата прибытия (план)</div><div>{doc.arrivalAt}</div></div>
              <div><div className="muted text-xs">Зона разгрузки</div><div>{doc.zone || '—'}</div></div>
              <div><div className="muted text-xs">Стоимость логистики</div><div className="mono">{doc.logistics.toLocaleString('ru')} ₽</div></div>
            </div>
          </div>
        </div>

        {/* Правая колонка: журнал операций — главная фича v2 */}
        <div className="card" style={{position: 'sticky', top: 0, alignSelf: 'flex-start', maxHeight: 'calc(100vh - 100px)', display: 'flex', flexDirection: 'column'}}>
          <div className="card-head" style={{borderBottom: '1px solid var(--c-border)', flex: '0 0 auto'}}>
            <Icon name="layers" size={15} style={{color: 'var(--c-accent)'}}/>
            <div className="card-head-title">Журнал операций</div>
            <span className="badge accent" style={{marginLeft: 6}}>{ops.length}</span>
            <span className="text-xs subtle" style={{marginLeft: 'auto'}}>
              <Icon name="lock" size={11} style={{verticalAlign: '-2px', marginRight: 3}}/>
              append-only
            </span>
          </div>

          {/* Фильтры журнала */}
          <div style={{padding: '8px 12px', display: 'flex', flexWrap: 'wrap', gap: 6, borderBottom: '1px solid var(--c-border)', flex: '0 0 auto'}}>
            <FilterChip
              label="Тип"
              value={filterType ? D.opTypes[filterType]?.label : null}
              active={!!filterType}
              onClick={() => setFilterType(t => t ? null : 'receive')}
            />
            <FilterChip
              label="Строка"
              value={filterLine}
              active={!!filterLine}
              onClick={() => setFilterLine(null)}
            />
            <FilterChip label="Оператор" onClick={() => {}}/>
            <div style={{flex: 1}}/>
            <button className="btn ghost sm icon" title="Свернуть всё"><Icon name="list" size={12}/></button>
          </div>

          {/* Лента операций */}
          <div style={{flex: '1 1 auto', overflow: 'auto', padding: '4px 0'}}>
            {visibleOps.length === 0 ? (
              <div className="empty" style={{padding: '40px 20px'}}>
                <div className="text-sm muted">Под фильтр ничего не попало</div>
              </div>
            ) : (
              <div style={{position: 'relative'}}>
                {/* вертикальная линия */}
                <div style={{
                  position: 'absolute', left: 22, top: 12, bottom: 12,
                  width: 1, background: 'var(--c-border)',
                }}/>
                {visibleOps.map((op, i) => {
                  const meta = D.opTypes[op.type];
                  const tone = meta.tone;
                  const isLast = i === visibleOps.length - 1;
                  return (
                    <div key={op.id} style={{
                      display: 'grid',
                      gridTemplateColumns: '40px 1fr',
                      gap: 0,
                      padding: '8px 12px 8px 0',
                      position: 'relative',
                    }}>
                      {/* маркер */}
                      <div style={{display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: 2}}>
                        <div style={{
                          width: 22, height: 22, borderRadius: 50,
                          background: tone === 'accent' ? 'var(--c-accent-bg)'
                                    : tone === 'success' ? 'var(--c-success-bg)'
                                    : tone === 'warning' ? 'color-mix(in oklab, var(--c-warning) 18%, var(--c-bg))'
                                    : 'var(--c-bg-sunken)',
                          border: '1px solid ' + (
                            tone === 'accent' ? 'var(--c-accent-border)'
                          : tone === 'success' ? 'var(--c-success-border, color-mix(in oklab, var(--c-success) 35%, transparent))'
                          : tone === 'warning' ? 'color-mix(in oklab, var(--c-warning) 40%, transparent)'
                          : 'var(--c-border)'),
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: tone === 'accent' ? 'var(--c-accent)'
                               : tone === 'success' ? 'var(--c-success)'
                               : tone === 'warning' ? 'var(--c-warning)'
                               : 'var(--c-text-muted)',
                          position: 'relative', zIndex: 1,
                        }}>
                          <Icon name={meta.icon} size={11}/>
                        </div>
                      </div>
                      <div style={{minWidth: 0, paddingTop: 1}}>
                        <div className="row gap-8" style={{flexWrap: 'wrap', marginBottom: 2}}>
                          <span style={{fontSize: 12.5, fontWeight: 500}}>{meta.label}</span>
                          {op.lineId && (
                            <span
                              className="mono text-xs"
                              style={{
                                color: 'var(--c-accent)', cursor: 'pointer',
                                background: 'var(--c-accent-bg)',
                                padding: '1px 6px', borderRadius: 4,
                              }}
                              onClick={() => setFilterLine(op.lineId)}
                            >
                              {op.lineId}
                            </span>
                          )}
                          {op.qty != null && (
                            <span className="mono text-xs subtle">{op.qty} шт</span>
                          )}
                        </div>
                        <div className="text-xs" style={{color: 'var(--c-text-muted)', marginBottom: 4, lineHeight: 1.5}}>
                          {op.detail}
                        </div>
                        <div className="row gap-8" style={{fontSize: 11, color: 'var(--c-text-subtle)'}}>
                          <Avatar initials={op.userInitials}/>
                          <span>{op.user}</span>
                          <span>·</span>
                          <span className="mono">{op.at}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* подвал */}
          <div style={{
            padding: '8px 12px',
            borderTop: '1px solid var(--c-border)',
            background: 'var(--c-bg-sunken)',
            fontSize: 11,
            color: 'var(--c-text-subtle)',
            display: 'flex', alignItems: 'center', gap: 8,
            flex: '0 0 auto',
          }}>
            <Icon name="shield" size={11}/>
            <span style={{flex: 1}}>Операции не редактируются. Удаление запрещено. Изменение — это новая операция.</span>
          </div>
        </div>
      </div>
    </div>
  );
};

window.Receipt2DetailScreen = Receipt2DetailScreen;
