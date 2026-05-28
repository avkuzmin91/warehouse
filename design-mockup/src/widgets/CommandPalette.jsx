// === Command palette (⌘K) ===
const CommandPalette = ({ open, onClose, onNavigate }) => {
  const [q, setQ] = React.useState('');
  const [sel, setSel] = React.useState(0);
  const inputRef = React.useRef();

  React.useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 30);
      setQ('');
      setSel(0);
    }
  }, [open]);

  const allCmds = [
    { section: 'Навигация', icon: 'home', label: 'Главная', sub: 'Сводка по складу', go: 'dashboard' },
    { section: 'Навигация', icon: 'truckIn', label: 'Поступления', sub: 'Список и приёмка', go: 'receipts' },
    { section: 'Навигация', icon: 'truckOut', label: 'Отгрузки', sub: 'Сборка заказов', go: 'shipments' },
    { section: 'Навигация', icon: 'boxes', label: 'Остатки', sub: 'Что и где лежит', go: 'balances' },
    { section: 'Навигация', icon: 'alert', label: 'Брак', sub: 'Учёт некондиционного товара', go: 'defects' },
    { section: 'Навигация', icon: 'book', label: 'Справочники', sub: 'Товары · цвета · размеры · клиенты', go: 'dictionaries' },
    { section: 'Навигация', icon: 'users', label: 'Пользователи и роли', sub: 'Управление доступом', go: 'users' },

    { section: 'Действия', icon: 'plus', label: 'Новое поступление', sub: 'Создать черновик документа', go: 'receiptDetail' },
    { section: 'Действия', icon: 'plus', label: 'Новая отгрузка', sub: 'Заявка от клиента', go: 'shipments' },
    { section: 'Действия', icon: 'plus', label: 'Зафиксировать брак', sub: 'Из текущего поступления', go: 'defects' },
    { section: 'Действия', icon: 'qr', label: 'Сканировать товар', sub: 'Поиск по штрих-коду', go: null },
    { section: 'Действия', icon: 'upload', label: 'Импорт остатков из Excel', sub: 'Массовое обновление', go: null },

    { section: 'Документы', icon: 'file', label: 'RCP-0421 · Mango Republic', sub: 'Поступление, в работе', go: 'receiptDetail' },
    { section: 'Документы', icon: 'file', label: 'SHP-1208 · Lukomorye OOO', sub: 'Отгрузка, сборка', go: 'shipments' },
    { section: 'Документы', icon: 'file', label: 'DEF-244 · Брак шва', sub: '23 мая, 2 шт', go: 'defects' },

    { section: 'Переключение', icon: 'user', label: 'Войти как Оператор', sub: 'Перейти к ролевому виду', go: 'role:user' },
    { section: 'Переключение', icon: 'user', label: 'Войти как Клиент', sub: 'Mango Republic', go: 'role:client' },
    { section: 'Переключение', icon: 'shield', label: 'Войти как Администратор', sub: 'Илья Никитин', go: 'role:admin' },
  ];

  const lq = q.toLowerCase();
  const filtered = allCmds.filter(c =>
    !lq || c.label.toLowerCase().includes(lq) || c.sub.toLowerCase().includes(lq)
  );

  const grouped = filtered.reduce((acc, c) => {
    (acc[c.section] = acc[c.section] || []).push(c);
    return acc;
  }, {});

  const flat = filtered;

  const handleKey = (e) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(flat.length - 1, s + 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(0, s - 1)); }
    if (e.key === 'Enter') {
      e.preventDefault();
      const c = flat[sel];
      if (c) {
        if (c.go && c.go.startsWith('role:')) onNavigate('_role', { role: c.go.split(':')[1] });
        else if (c.go) onNavigate(c.go);
        onClose();
      }
    }
  };

  if (!open) return null;

  let cursor = 0;

  return (
    <div className="cmdk-backdrop" onClick={onClose}>
      <div className="cmdk" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="cmdk-input"
          placeholder="Найти команду, документ или раздел…"
          value={q}
          onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={handleKey}
        />
        <div className="cmdk-list">
          {Object.entries(grouped).map(([section, items]) => (
            <div key={section}>
              <div className="cmdk-section">{section}</div>
              {items.map((c) => {
                const isSel = cursor === sel;
                const myIdx = cursor++;
                return (
                  <div
                    key={c.label}
                    className={`cmdk-item ${myIdx === sel ? 'sel' : ''}`}
                    onMouseEnter={() => setSel(myIdx)}
                    onClick={() => {
                      if (c.go && c.go.startsWith('role:')) onNavigate('_role', { role: c.go.split(':')[1] });
                      else if (c.go) onNavigate(c.go);
                      onClose();
                    }}
                  >
                    <Icon name={c.icon} size={15} className="ic"/>
                    <div>
                      <div>{c.label}</div>
                      <div className="cmdk-sub">{c.sub}</div>
                    </div>
                    <Icon name="arrowRight" size={13} className="cmdk-arrow"/>
                  </div>
                );
              })}
            </div>
          ))}
          {flat.length === 0 && (
            <div style={{padding: 32, textAlign: 'center', color: 'var(--c-text-muted)', fontSize: 13}}>
              Ничего не найдено
            </div>
          )}
        </div>
        <div style={{
          padding: '8px 14px', borderTop: '1px solid var(--c-border)',
          display: 'flex', alignItems: 'center', gap: 10,
          fontSize: 11, color: 'var(--c-text-subtle)', background: 'var(--c-bg-sunken)',
        }}>
          <span className="kbd">↑</span><span className="kbd">↓</span>навигация
          <span style={{flex: 1}}/>
          <span className="kbd">↵</span>открыть
          <span style={{flex: 1}}/>
          <span className="kbd">esc</span>закрыть
        </div>
      </div>
    </div>
  );
};

window.CommandPalette = CommandPalette;
