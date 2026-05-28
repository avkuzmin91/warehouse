// === Mock data for the prototype ===
const D = {};

D.clients = [
  { id: 'cl-01', name: 'Mango Republic', email: 'logistics@mango.ru', active: 30421, brand: 'Mango' },
  { id: 'cl-02', name: 'Lukomorye OOO', email: 'wh@lukomorye.ru', active: 12044, brand: 'Lukomorye' },
  { id: 'cl-03', name: 'Sever Trade', email: 'ops@sever.trade', active: 8330, brand: 'Север' },
  { id: 'cl-04', name: 'Brutto Studio', email: 'hi@brutto.studio', active: 5128, brand: 'Brutto' },
  { id: 'cl-05', name: 'Aqua Vita', email: 'help@aquavita.ru', active: 2901, brand: 'AquaVita' },
];

D.users = [
  { id: 'u-01', email: 'anna@pack-men.ru', name: 'Анна Сорокина', role: 'manager', client_id: null, last: '5 мин назад', initials: 'АС' },
  { id: 'u-02', email: 'pavel@pack-men.ru', name: 'Павел Громов', role: 'warehouse_manager', client_id: null, last: '2 ч назад', initials: 'ПГ' },
  { id: 'u-03', email: 'sergey@pack-men.ru', name: 'Сергей Дунаев', role: 'user', client_id: null, last: '12 мин назад', initials: 'СД' },
  { id: 'u-04', email: 'logistics@mango.ru', name: 'Mango — логистика', role: 'client', client_id: 'cl-01', last: 'вчера', initials: 'MR' },
  { id: 'u-05', email: 'wh@lukomorye.ru', name: 'Lukomorye OOO', role: 'client', client_id: 'cl-02', last: '3 дня назад', initials: 'LK' },
  { id: 'u-06', email: 'admin@pack-men.ru', name: 'Илья Никитин', role: 'admin', client_id: null, last: 'сейчас', initials: 'ИН' },
  { id: 'u-07', email: 'ops@sever.trade', name: 'Север Trade', role: 'client', client_id: 'cl-03', last: '15 мин назад', initials: 'СТ' },
  { id: 'u-08', email: 'maria@pack-men.ru', name: 'Мария Лей', role: 'user', client_id: null, last: '1 ч назад', initials: 'МЛ' },
];

D.roleLabels = {
  admin: 'Администратор',
  manager: 'Менеджер',
  warehouse_manager: 'Зав. склада',
  user: 'Оператор',
  client: 'Клиент',
};

D.roleColors = {
  admin: 'danger',
  manager: 'accent',
  warehouse_manager: 'info',
  user: 'success',
  client: '',
};

D.dictionaries = [
  { id: 'products', name: 'Товары', count: 1428, icon: 'box', type: 'rich' },
  { id: 'product-types', name: 'Типы товаров', count: 24, icon: 'tag', type: 'simple' },
  { id: 'sizes', name: 'Размеры', count: 18, icon: 'ruler', type: 'simple' },
  { id: 'colors', name: 'Цвета', count: 42, icon: 'palette', type: 'simple' },
  { id: 'clients', name: 'Клиенты', count: 38, icon: 'users', type: 'rich' },
  { id: 'warehouses', name: 'Склады', count: 3, icon: 'map', type: 'simple' },
  { id: 'reasons', name: 'Причины брака', count: 12, icon: 'alert', type: 'simple' },
  { id: 'carriers', name: 'Перевозчики', count: 7, icon: 'truckOut', type: 'simple' },
];

D.products = [
  { sku: 'MNG-TS-01', name: 'Футболка базовая', type: 'Футболка', client: 'Mango Republic', variants: 28, qty: 1840, image: '🎽' },
  { sku: 'MNG-HD-12', name: 'Худи oversize cotton', type: 'Худи', client: 'Mango Republic', variants: 18, qty: 920, image: '🧥' },
  { sku: 'LK-DR-03', name: 'Платье миди вискоза', type: 'Платье', client: 'Lukomorye OOO', variants: 12, qty: 410, image: '👗' },
  { sku: 'BR-CP-04', name: 'Кепка с принтом', type: 'Кепка', client: 'Brutto Studio', variants: 6, qty: 1240, image: '🧢' },
  { sku: 'SV-BG-01', name: 'Сумка-шопер', type: 'Сумка', client: 'Sever Trade', variants: 4, qty: 680, image: '👜' },
  { sku: 'AV-WB-01', name: 'Бутылка стекло 0.5л', type: 'Бутылка', client: 'Aqua Vita', variants: 3, qty: 2204, image: '🧴' },
];

D.colors = ['Чёрный','Белый','Серый меланж','Кремовый','Тёмно-синий','Бордовый','Терракотовый','Хаки','Оливковый','Графит'];

D.sizes = ['XS','S','M','L','XL','XXL','36','38','40','42','44','46','One Size'];

// receipts (Поступления)
D.receipts = [
  { id: 'RCP-0421', client: 'Mango Republic', date: '23 мая, 14:32', sku_total: 12, qty_total: 488, status: 'in_progress', status_label: 'Приёмка', operator: 'Сергей Дунаев', defects: 2 },
  { id: 'RCP-0420', client: 'Lukomorye OOO', date: '23 мая, 11:08', sku_total: 4, qty_total: 120, status: 'done', status_label: 'Принято', operator: 'Мария Лей', defects: 0 },
  { id: 'RCP-0419', client: 'Brutto Studio', date: '22 мая, 18:40', sku_total: 8, qty_total: 1240, status: 'done', status_label: 'Принято', operator: 'Сергей Дунаев', defects: 5 },
  { id: 'RCP-0418', client: 'Sever Trade', date: '22 мая, 15:12', sku_total: 3, qty_total: 220, status: 'verified', status_label: 'Проверено', operator: 'Павел Громов', defects: 0 },
  { id: 'RCP-0417', client: 'Mango Republic', date: '22 мая, 09:55', sku_total: 22, qty_total: 1840, status: 'done', status_label: 'Принято', operator: 'Мария Лей', defects: 8 },
  { id: 'RCP-0416', client: 'Aqua Vita', date: '21 мая, 16:24', sku_total: 2, qty_total: 480, status: 'draft', status_label: 'Черновик', operator: 'Анна Сорокина', defects: 0 },
  { id: 'RCP-0415', client: 'Lukomorye OOO', date: '21 мая, 11:00', sku_total: 5, qty_total: 215, status: 'done', status_label: 'Принято', operator: 'Сергей Дунаев', defects: 1 },
  { id: 'RCP-0414', client: 'Brutto Studio', date: '20 мая, 17:30', sku_total: 7, qty_total: 980, status: 'cancelled', status_label: 'Отменено', operator: 'Анна Сорокина', defects: 0 },
];

D.shipments = [
  { id: 'SHP-1208', client: 'Mango Republic', dest: 'Wildberries Коледино', date: '23 мая, 16:00', sku_total: 8, qty_total: 320, status: 'packing', status_label: 'Сборка', operator: 'Мария Лей', courier: 'Главдоставка' },
  { id: 'SHP-1207', client: 'Lukomorye OOO', dest: 'Ozon Хоругвино', date: '23 мая, 12:30', sku_total: 3, qty_total: 96, status: 'shipped', status_label: 'Отправлено', operator: 'Сергей Дунаев', courier: 'СДЭК' },
  { id: 'SHP-1206', client: 'Brutto Studio', dest: 'Самовывоз', date: '22 мая, 19:15', sku_total: 12, qty_total: 540, status: 'ready', status_label: 'Готово', operator: 'Павел Громов', courier: '—' },
  { id: 'SHP-1205', client: 'Aqua Vita', dest: 'СберМегаМаркет', date: '22 мая, 14:20', sku_total: 2, qty_total: 480, status: 'shipped', status_label: 'Отправлено', operator: 'Мария Лей', courier: 'Boxberry' },
  { id: 'SHP-1204', client: 'Mango Republic', dest: 'Yandex Маркет Дмитров', date: '22 мая, 09:00', sku_total: 14, qty_total: 612, status: 'shipped', status_label: 'Отправлено', operator: 'Сергей Дунаев', courier: 'Главдоставка' },
  { id: 'SHP-1203', client: 'Sever Trade', dest: 'WB Подольск', date: '21 мая, 17:45', sku_total: 4, qty_total: 200, status: 'shipped', status_label: 'Отправлено', operator: 'Мария Лей', courier: 'СДЭК' },
];

// Receipt detail rows
D.receiptItems = [
  { sku: 'MNG-TS-01', name: 'Футболка базовая', variant: 'Чёрный · M', planned: 60, accepted: 58, defect: 2, status: 'reviewed' },
  { sku: 'MNG-TS-01', name: 'Футболка базовая', variant: 'Чёрный · L', planned: 80, accepted: 80, defect: 0, status: 'reviewed' },
  { sku: 'MNG-TS-01', name: 'Футболка базовая', variant: 'Белый · M', planned: 60, accepted: 60, defect: 0, status: 'reviewed' },
  { sku: 'MNG-HD-12', name: 'Худи oversize', variant: 'Графит · L', planned: 40, accepted: 40, defect: 0, status: 'reviewed' },
  { sku: 'MNG-HD-12', name: 'Худи oversize', variant: 'Графит · XL', planned: 40, accepted: 38, defect: 2, status: 'in' },
  { sku: 'MNG-HD-12', name: 'Худи oversize', variant: 'Бордовый · M', planned: 30, accepted: null, defect: 0, status: 'pending' },
  { sku: 'MNG-HD-12', name: 'Худи oversize', variant: 'Бордовый · L', planned: 40, accepted: null, defect: 0, status: 'pending' },
  { sku: 'MNG-HD-12', name: 'Худи oversize', variant: 'Хаки · M', planned: 30, accepted: null, defect: 0, status: 'pending' },
];

// Balances grouped by client
D.balances = [
  { sku: 'MNG-TS-01-BLK-M', name: 'Футболка базовая · Чёрный · M', client: 'Mango Republic', total: 218, available: 198, reserved: 20, defect: 0, location: 'A-12-03', updated: '12 мин назад' },
  { sku: 'MNG-TS-01-BLK-L', name: 'Футболка базовая · Чёрный · L', client: 'Mango Republic', total: 312, available: 280, reserved: 32, defect: 4, location: 'A-12-04', updated: '12 мин назад' },
  { sku: 'MNG-HD-12-GRA-L', name: 'Худи oversize · Графит · L', client: 'Mango Republic', total: 140, available: 124, reserved: 16, defect: 2, location: 'A-08-01', updated: '1 ч назад' },
  { sku: 'LK-DR-03-NVY-S', name: 'Платье миди · Синий · S', client: 'Lukomorye OOO', total: 42, available: 42, reserved: 0, defect: 1, location: 'B-04-12', updated: '3 ч назад' },
  { sku: 'LK-DR-03-RED-M', name: 'Платье миди · Красный · M', client: 'Lukomorye OOO', total: 28, available: 24, reserved: 4, defect: 0, location: 'B-04-13', updated: 'вчера' },
  { sku: 'BR-CP-04-BLK-OS', name: 'Кепка с принтом · Чёрный · OS', client: 'Brutto Studio', total: 412, available: 380, reserved: 32, defect: 8, location: 'C-02-08', updated: '5 ч назад' },
  { sku: 'SV-BG-01-NAT-OS', name: 'Сумка-шопер · Натуральный · OS', client: 'Sever Trade', total: 180, available: 180, reserved: 0, defect: 2, location: 'C-06-04', updated: '2 дня назад' },
  { sku: 'AV-WB-01-CLR-OS', name: 'Бутылка 0.5л · Прозрачный · OS', client: 'Aqua Vita', total: 1240, available: 1200, reserved: 40, defect: 18, location: 'D-01-02', updated: '30 мин назад' },
];

D.defects = [
  { id: 'DEF-244', sku: 'MNG-TS-01', variant: 'Чёрный · M', client: 'Mango Republic', qty: 2, reason: 'Брак шва', source: 'RCP-0421', date: '23 мая, 14:48', status: 'open' },
  { id: 'DEF-243', sku: 'MNG-HD-12', variant: 'Графит · XL', client: 'Mango Republic', qty: 2, reason: 'Пятно на ткани', source: 'RCP-0421', date: '23 мая, 15:02', status: 'open' },
  { id: 'DEF-242', sku: 'BR-CP-04', variant: 'Чёрный · OS', client: 'Brutto Studio', qty: 5, reason: 'Дефект принта', source: 'RCP-0419', date: '22 мая, 18:55', status: 'reported' },
  { id: 'DEF-241', sku: 'MNG-TS-01', variant: 'Белый · L', client: 'Mango Republic', qty: 8, reason: 'Не соответствует размеру', source: 'RCP-0417', date: '22 мая, 11:24', status: 'returned' },
  { id: 'DEF-240', sku: 'BR-CP-04', variant: 'Чёрный · OS', client: 'Brutto Studio', qty: 3, reason: 'Дефект принта', source: 'RCP-0419', date: '22 мая, 19:05', status: 'open' },
  { id: 'DEF-239', sku: 'LK-DR-03', variant: 'Синий · S', client: 'Lukomorye OOO', qty: 1, reason: 'Повреждение упаковки', source: 'RCP-0415', date: '21 мая, 11:25', status: 'reported' },
  { id: 'DEF-238', sku: 'AV-WB-01', variant: 'Прозрачный · OS', client: 'Aqua Vita', qty: 18, reason: 'Скол / трещина', source: 'инвентаризация', date: '21 мая, 09:00', status: 'returned' },
];

D.activity = [
  { kind: 'receipt', icon: 'truckIn', text: 'Принято поступление RCP-0421', meta: 'Mango Republic · 488 шт', time: '14:32', tone: 'accent' },
  { kind: 'shipment', icon: 'truckOut', text: 'Отгружено SHP-1207', meta: 'Lukomorye OOO → Ozon Хоругвино', time: '12:30', tone: 'success' },
  { kind: 'defect', icon: 'alert', text: 'Зафиксирован брак DEF-244', meta: 'MNG-TS-01 · 2 шт · Брак шва', time: '14:48', tone: 'warning' },
  { kind: 'user', icon: 'user', text: 'Анна Сорокина изменила роль', meta: 'sergey@pack-men.ru: operator → manager', time: '11:02', tone: '' },
  { kind: 'dict', icon: 'plus', text: 'Создан размер 44', meta: 'Справочник «Размеры»', time: 'вчера', tone: '' },
];

// ============================================================
// === Поступления v2 (новая логика: операции как источник истины)
// ============================================================
// Статусы документа: draft → created → arrived → in_review → done
D.receipt2Statuses = [
  { id: 'draft',     label: 'Черновик',  tone: '',        order: 0 },
  { id: 'created',   label: 'Создан',    tone: 'info',    order: 1 },
  { id: 'arrived',   label: 'Прибыл',    tone: 'accent',  order: 2 },
  { id: 'in_review', label: 'В проверке',tone: 'warning', order: 3 },
  { id: 'done',      label: 'Завершён',  tone: 'success', order: 4 },
];

// Статус проверки качества (вычисляется по операциям)
D.qcStatuses = {
  none:       { label: 'Не начата',     tone: '' },
  partial:    { label: 'Частично',      tone: 'info' },
  has_defect: { label: 'Есть брак',     tone: 'warning' },
  clean:      { label: 'Без брака',     tone: 'success' },
  done:       { label: 'Завершена',     tone: 'success' },
};

// Типы операций (immutable journal entries)
D.opTypes = {
  doc_create:    { label: 'Создание документа',  icon: 'plus',    tone: 'accent' },
  doc_update:    { label: 'Изменение документа', icon: 'edit',    tone: '' },
  line_add:      { label: 'Добавление строки',   icon: 'plus',    tone: '' },
  line_update:   { label: 'Изменение строки',    icon: 'edit',    tone: '' },
  arrival:       { label: 'Фиксация прибытия',   icon: 'truckIn', tone: 'accent' },
  receive:       { label: 'Приёмка товара',      icon: 'check',   tone: 'success' },
  defect:        { label: 'Фиксация брака',      icon: 'alert',   tone: 'warning' },
  qc_complete:   { label: 'Завершение проверки', icon: 'shield',  tone: 'success' },
};

// Документы поступлений 2
D.receipts2 = [
  {
    id: 'WH-2025-0042',
    client: 'Mango Republic', clientId: 'cl-01',
    supplier: 'Mango RU LLC',
    ttn: 'TTN-90021',
    zone: 'A-12 · док №3',
    logistics: 18400,
    operator: 'Анна Сорокина',
    createdAt: '23 мая, 14:08',
    arrivalAt: '23 мая, 15:00',
    arrivalDate: '2026-05-23',
    status: 'in_review',
  },
  {
    id: 'WH-2025-0041',
    client: 'Lukomorye OOO', clientId: 'cl-02',
    supplier: 'Lukomorye Production',
    ttn: 'TTN-90018',
    zone: 'A-04 · док №1',
    logistics: 9600,
    operator: 'Мария Лей',
    createdAt: '23 мая, 09:40',
    arrivalAt: '23 мая, 11:30',
    arrivalDate: '2026-05-23',
    status: 'arrived',
  },
  {
    id: 'WH-2025-0040',
    client: 'Brutto Studio', clientId: 'cl-04',
    supplier: 'Brutto Print',
    ttn: 'TTN-90014',
    zone: 'B-01 · док №2',
    logistics: 12200,
    operator: 'Сергей Дунаев',
    createdAt: '22 мая, 18:20',
    arrivalAt: '22 мая, 19:00',
    arrivalDate: '2026-05-22',
    status: 'done',
  },
  {
    id: 'WH-2025-0039',
    client: 'Sever Trade', clientId: 'cl-03',
    supplier: null,
    ttn: 'TTN-89987',
    zone: null,
    logistics: 6400,
    operator: 'Анна Сорокина',
    createdAt: '22 мая, 09:10',
    arrivalAt: '22 мая, 14:00',
    arrivalDate: '2026-05-22',
    status: 'done',
  },
  {
    id: 'WH-2025-0038',
    client: 'Mango Republic', clientId: 'cl-01',
    supplier: 'Mango RU LLC',
    ttn: 'TTN-89952',
    zone: 'A-12 · док №3',
    logistics: 22800,
    operator: 'Сергей Дунаев',
    createdAt: '20 мая, 11:00',
    arrivalAt: '21 мая, 10:00',
    arrivalDate: '2026-05-21',
    // Просрочен: arrived но не закрыт, дата прошла
    status: 'arrived',
  },
  {
    id: 'WH-2025-0037',
    client: 'Aqua Vita', clientId: 'cl-05',
    supplier: null,
    ttn: null,
    zone: null,
    logistics: 0,
    operator: 'Анна Сорокина',
    createdAt: '23 мая, 16:48',
    arrivalAt: '25 мая, 10:00',
    arrivalDate: '2026-05-25',
    status: 'draft',
  },
  {
    id: 'WH-2025-0036',
    client: 'Lukomorye OOO', clientId: 'cl-02',
    supplier: 'Lukomorye Production',
    ttn: 'TTN-89901',
    zone: 'A-04 · док №1',
    logistics: 7800,
    operator: 'Мария Лей',
    createdAt: '22 мая, 11:00',
    arrivalAt: '24 мая, 12:00',
    arrivalDate: '2026-05-24',
    status: 'created',
  },
];

// Сегодня (для расчёта просрочки в моке)
D.today2 = '2026-05-24';
D.isOverdue2 = (doc) => doc.status !== 'done' && doc.arrivalDate < D.today2;

// Строки документа WH-2025-0042 (активный, в проверке)
D.receipt2Lines = {
  'WH-2025-0042': [
    { id: 'L-1', sku: 'MNG-TS-01', name: 'Футболка базовая', color: 'Чёрный', size: 'M', planned: 60 },
    { id: 'L-2', sku: 'MNG-TS-01', name: 'Футболка базовая', color: 'Чёрный', size: 'L', planned: 80 },
    { id: 'L-3', sku: 'MNG-TS-01', name: 'Футболка базовая', color: 'Белый',  size: 'M', planned: 60 },
    { id: 'L-4', sku: 'MNG-HD-12', name: 'Худи oversize',   color: 'Графит', size: 'L', planned: 40 },
    { id: 'L-5', sku: 'MNG-HD-12', name: 'Худи oversize',   color: 'Графит', size: 'XL', planned: 40 },
    { id: 'L-6', sku: 'MNG-HD-12', name: 'Худи oversize',   color: 'Бордовый', size: 'M', planned: 30 },
  ],
};

// Журнал операций для WH-2025-0042 (хронологически, неизменяемый)
D.receipt2Ops = {
  'WH-2025-0042': [
    { id: 'op-001', type: 'doc_create',  at: '23 мая, 14:08:12', user: 'Анна Сорокина', userInitials: 'АС',
      detail: 'Документ создан как черновик', lineId: null },
    { id: 'op-002', type: 'doc_update',  at: '23 мая, 14:09:34', user: 'Анна Сорокина', userInitials: 'АС',
      detail: 'Заполнены реквизиты: ТТН TTN-90021, зона A-12', lineId: null },
    { id: 'op-003', type: 'line_add',    at: '23 мая, 14:11:02', user: 'Анна Сорокина', userInitials: 'АС',
      detail: 'MNG-TS-01 · Чёрный · M — план 60', lineId: 'L-1' },
    { id: 'op-004', type: 'line_add',    at: '23 мая, 14:11:30', user: 'Анна Сорокина', userInitials: 'АС',
      detail: 'MNG-TS-01 · Чёрный · L — план 80', lineId: 'L-2' },
    { id: 'op-005', type: 'line_add',    at: '23 мая, 14:12:08', user: 'Анна Сорокина', userInitials: 'АС',
      detail: 'MNG-TS-01 · Белый · M — план 60', lineId: 'L-3' },
    { id: 'op-006', type: 'line_add',    at: '23 мая, 14:12:44', user: 'Анна Сорокина', userInitials: 'АС',
      detail: 'MNG-HD-12 · Графит · L — план 40', lineId: 'L-4' },
    { id: 'op-007', type: 'line_add',    at: '23 мая, 14:13:18', user: 'Анна Сорокина', userInitials: 'АС',
      detail: 'MNG-HD-12 · Графит · XL — план 40', lineId: 'L-5' },
    { id: 'op-008', type: 'line_add',    at: '23 мая, 14:13:55', user: 'Анна Сорокина', userInitials: 'АС',
      detail: 'MNG-HD-12 · Бордовый · M — план 30', lineId: 'L-6' },
    { id: 'op-009', type: 'arrival',     at: '23 мая, 15:02:11', user: 'Сергей Дунаев', userInitials: 'СД',
      detail: 'Машина прибыла на зону A-12', lineId: null },
    { id: 'op-010', type: 'receive',     at: '23 мая, 15:18:47', user: 'Сергей Дунаев', userInitials: 'СД',
      detail: 'Принято 60 шт', lineId: 'L-1', qty: 60 },
    { id: 'op-011', type: 'receive',     at: '23 мая, 15:24:02', user: 'Сергей Дунаев', userInitials: 'СД',
      detail: 'Принято 78 шт (из 80)', lineId: 'L-2', qty: 78 },
    { id: 'op-012', type: 'receive',     at: '23 мая, 15:31:55', user: 'Сергей Дунаев', userInitials: 'СД',
      detail: 'Принято 60 шт', lineId: 'L-3', qty: 60 },
    { id: 'op-013', type: 'receive',     at: '23 мая, 15:42:18', user: 'Сергей Дунаев', userInitials: 'СД',
      detail: 'Принято 40 шт', lineId: 'L-4', qty: 40 },
    { id: 'op-014', type: 'defect',      at: '23 мая, 16:04:30', user: 'Павел Громов', userInitials: 'ПГ',
      detail: 'Брак шва — 2 шт', lineId: 'L-1', qty: 2, reason: 'Брак шва' },
    { id: 'op-015', type: 'receive',     at: '23 мая, 16:18:09', user: 'Сергей Дунаев', userInitials: 'СД',
      detail: 'Принято 38 шт (из 40)', lineId: 'L-5', qty: 38 },
    { id: 'op-016', type: 'defect',      at: '23 мая, 16:22:44', user: 'Павел Громов', userInitials: 'ПГ',
      detail: 'Пятно на ткани — 2 шт', lineId: 'L-5', qty: 2, reason: 'Пятно на ткани' },
  ],
};

// Вычисление текущего состояния документа из операций
D.computeReceipt2State = (docId) => {
  const lines = D.receipt2Lines[docId] || [];
  const ops = D.receipt2Ops[docId] || [];
  const byLine = {};
  for (const l of lines) byLine[l.id] = { ...l, accepted: 0, defect: 0, opsCount: 0 };
  for (const op of ops) {
    if (op.lineId && byLine[op.lineId]) {
      if (op.type === 'receive') byLine[op.lineId].accepted += op.qty || 0;
      if (op.type === 'defect')  byLine[op.lineId].defect   += op.qty || 0;
      byLine[op.lineId].opsCount += 1;
    }
  }
  const list = Object.values(byLine);
  return {
    lines: list,
    totalPlanned:  list.reduce((s, l) => s + l.planned, 0),
    totalAccepted: list.reduce((s, l) => s + l.accepted, 0),
    totalDefect:   list.reduce((s, l) => s + l.defect, 0),
    skuCount:      new Set(list.map(l => l.sku)).size,
    opsCount:      ops.length,
  };
};

// Сводка для списка
D.receipt2Summary = (doc) => {
  // Если есть строки/операции — считаем из них
  if (D.receipt2Lines[doc.id]) {
    const s = D.computeReceipt2State(doc.id);
    return { ...s, planned: s.totalPlanned, defect: s.totalDefect };
  }
  // Заглушки для остальных документов в моке
  const fake = {
    'WH-2025-0041': { skuCount: 5, planned: 215,  defect: 0, totalAccepted: 215, qc: 'clean' },
    'WH-2025-0040': { skuCount: 8, planned: 1240, defect: 5, totalAccepted: 1235, qc: 'done' },
    'WH-2025-0039': { skuCount: 3, planned: 220,  defect: 0, totalAccepted: 220,  qc: 'done' },
    'WH-2025-0038': { skuCount: 12,planned: 488,  defect: 0, totalAccepted: 0,    qc: 'none' },
    'WH-2025-0037': { skuCount: 2, planned: 480,  defect: 0, totalAccepted: 0,    qc: 'none' },
    'WH-2025-0036': { skuCount: 4, planned: 120,  defect: 0, totalAccepted: 0,    qc: 'none' },
  };
  return fake[doc.id] || { skuCount: 0, planned: 0, defect: 0, totalAccepted: 0 };
};

// Статус проверки качества для документа
D.receipt2QcStatus = (doc) => {
  if (doc.status === 'done') {
    const s = D.receipt2Summary(doc);
    return s.defect > 0 ? 'done' : 'done';
  }
  if (doc.status === 'in_review') {
    const s = D.receipt2Summary(doc);
    return s.defect > 0 ? 'has_defect' : 'partial';
  }
  if (doc.status === 'arrived') {
    const s = D.receipt2Summary(doc);
    return s.totalAccepted > 0 ? 'partial' : 'none';
  }
  return 'none';
};

D.spark = (seed = 1, n = 14) => {
  const out = [];
  let v = 0.5;
  for (let i = 0; i < n; i++) {
    v += (Math.sin(i * 1.3 + seed) + Math.cos(i * 0.7 + seed * 2)) * 0.08;
    out.push(Math.max(0.05, Math.min(0.95, v)));
  }
  return out;
};

window.D = D;
