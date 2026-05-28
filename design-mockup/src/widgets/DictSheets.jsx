// === Dictionary side sheets for simple dicts + clients ===

const SimpleDictSheet = ({ open, onClose, isNew, kind = 'Размер', initial }) => {
  const [name, setName] = React.useState(initial?.name || '');
  const [active, setActive] = React.useState(initial?.active ?? true);
  const [reqColor, setReqColor] = React.useState(false);
  const [reqSize, setReqSize] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setName(initial?.name || '');
      setActive(initial?.active ?? true);
    }
  }, [open, initial]);

  return (
    <SideSheet
      open={open}
      onClose={onClose}
      title={isNew ? `Новый «${kind.toLowerCase()}»` : `${kind}: ${initial?.name || ''}`}
      subtitle={isNew ? 'Простой справочник — добавление значения' : 'Редактирование'}
      width={440}
      footer={
        <>
          <button className="btn" onClick={onClose}>Отмена</button>
          {!isNew && <button className="btn danger"><Icon name="trash" size={13}/>Архивировать</button>}
          <button className="btn primary" onClick={onClose}>
            <Icon name="check" size={13}/>{isNew ? 'Создать' : 'Сохранить'}
          </button>
        </>
      }
    >
      <Field label="Значение" required>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={`Например: ${kind === 'Размер' ? '44' : kind === 'Цвет' ? 'Бирюзовый' : 'Новое значение'}`} autoFocus/>
      </Field>

      {kind === 'Тип товара' && (
        <>
          <Field label="Атрибуты вариантов" help="Какие признаки требует тип при создании товара">
            <div className="col gap-8" style={{padding: '8px 10px', background: 'var(--c-bg-sunken)', borderRadius: 6}}>
              <Toggle checked={reqColor} onChange={setReqColor} label="Имеет цвет"/>
              <Toggle checked={reqSize} onChange={setReqSize} label="Имеет размер"/>
            </div>
          </Field>
        </>
      )}

      {kind === 'Цвет' && (
        <Field label="Hex / визуальное обозначение">
          <div className="row gap-8">
            <div style={{width: 30, height: 30, borderRadius: 6, background: '#1a1a18', border: '1px solid var(--c-border)'}}/>
            <input className="input mono" placeholder="#1a1a18" defaultValue="#1a1a18"/>
          </div>
        </Field>
      )}

      <Field label="Статус" help="Архивные значения скрыты, но не удалены">
        <div style={{padding: '10px 12px', background: 'var(--c-bg-sunken)', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 10}}>
          <Toggle checked={active} onChange={setActive}/>
          <div>
            <div style={{fontSize: 13, fontWeight: 500}}>{active ? 'Активно' : 'Архив'}</div>
            <div className="text-xs subtle">{active ? 'Доступно для выбора в формах' : 'Не появляется в списках выбора'}</div>
          </div>
        </div>
      </Field>

      {!isNew && (
        <div style={{padding: '12px 14px', background: 'var(--c-bg-sunken)', borderRadius: 6, marginTop: 8}}>
          <div className="text-xs subtle" style={{marginBottom: 6}}>МЕТА</div>
          <div style={{display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 8, fontSize: 12.5}}>
            <span className="muted">Создано</span><span>12 апреля 2026 · Илья Никитин</span>
            <span className="muted">Изменено</span><span>18 мая 2026 · Анна Сорокина</span>
            <span className="muted">Используется</span><span>в 1 428 товарах</span>
          </div>
        </div>
      )}
    </SideSheet>
  );
};

const ClientSheet = ({ open, onClose, isNew, initial }) => {
  const [name, setName] = React.useState(initial?.name || '');
  const [tab, setTab] = React.useState('main');

  return (
    <SideSheet
      open={open}
      onClose={onClose}
      title={isNew ? 'Новый клиент' : initial?.name || ''}
      subtitle={isNew ? 'Юр. лицо или ИП — заведение в систему' : `Клиент · ${initial?.id || ''}`}
      width={560}
      footer={
        <>
          <button className="btn" onClick={onClose}>Отмена</button>
          <button className="btn primary" onClick={onClose}>
            <Icon name="check" size={13}/>{isNew ? 'Создать клиента' : 'Сохранить'}
          </button>
        </>
      }
    >
      <Tabs
        tabs={[
          { id: 'main', label: 'Основное' },
          { id: 'contacts', label: 'Контакты' },
          { id: 'billing', label: 'Реквизиты' },
          { id: 'access', label: 'Доступ' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'main' && (
        <>
          <Field label="Название" required>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="ООО «Mango Republic»"/>
          </Field>
          <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12}}>
            <Field label="Краткое имя" hint="для интерфейса">
              <input className="input" placeholder="Mango" defaultValue={initial?.brand || ''}/>
            </Field>
            <Field label="Договор">
              <input className="input mono" placeholder="2024-04" defaultValue="2024-04"/>
            </Field>
            <Field label="Дата старта">
              <input className="input" defaultValue="12 января 2026"/>
            </Field>
            <Field label="Статус">
              <Select value="active" options={[
                { value: 'active', label: 'Активен' },
                { value: 'paused', label: 'Приостановлен' },
                { value: 'closed', label: 'Закрыт' },
              ]}/>
            </Field>
          </div>
          <Field label="Описание / примечания">
            <textarea className="input" style={{height: 70, padding: 8, resize: 'vertical'}} placeholder="Особенности работы с клиентом…"/>
          </Field>
        </>
      )}

      {tab === 'contacts' && (
        <>
          <Field label="Контактное лицо" required>
            <input className="input" placeholder="Иван Иванов" defaultValue="Дмитрий Калинин"/>
          </Field>
          <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12}}>
            <Field label="Email" required>
              <input className="input" defaultValue={initial?.email || 'logistics@mango.ru'}/>
            </Field>
            <Field label="Телефон">
              <input className="input" defaultValue="+7 (495) 555-12-34"/>
            </Field>
          </div>
          <Field label="Адрес склада клиента">
            <textarea className="input" style={{height: 60, padding: 8, resize: 'vertical'}} defaultValue="Москва, Дмитровское ш., 100"/>
          </Field>
        </>
      )}

      {tab === 'billing' && (
        <>
          <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12}}>
            <Field label="ИНН"><input className="input mono" defaultValue="7710123456"/></Field>
            <Field label="КПП"><input className="input mono" defaultValue="771001001"/></Field>
            <Field label="ОГРН"><input className="input mono" defaultValue="1027700123456"/></Field>
            <Field label="Расчётный счёт"><input className="input mono" defaultValue="40702810500000012345"/></Field>
          </div>
          <Field label="Юридический адрес">
            <textarea className="input" style={{height: 60, padding: 8, resize: 'vertical'}} defaultValue="125009, Москва, Тверская, 1"/>
          </Field>
        </>
      )}

      {tab === 'access' && (
        <>
          <div className="text-xs subtle" style={{marginBottom: 8}}>Пользователи с доступом к кабинету клиента</div>
          <div className="col gap-4" style={{marginBottom: 14}}>
            {D.users.filter(u => u.client_id === (initial?.id || 'cl-01')).map(u => (
              <div key={u.id} style={{display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: '1px solid var(--c-border)', borderRadius: 6}}>
                <Avatar initials={u.initials}/>
                <div style={{flex: 1}}>
                  <div className="text-sm" style={{fontWeight: 450}}>{u.name}</div>
                  <div className="text-xs subtle">{u.email} · последний вход {u.last}</div>
                </div>
                <button className="btn ghost icon sm"><Icon name="more" size={13}/></button>
              </div>
            ))}
            {!D.users.some(u => u.client_id === (initial?.id || 'cl-01')) && (
              <div className="text-sm muted" style={{padding: '12px 10px'}}>Пока нет привязанных пользователей</div>
            )}
          </div>
          <button className="btn" style={{width: '100%'}}><Icon name="plus" size={13}/>Пригласить пользователя</button>
        </>
      )}
    </SideSheet>
  );
};

window.SimpleDictSheet = SimpleDictSheet;
window.ClientSheet = ClientSheet;
