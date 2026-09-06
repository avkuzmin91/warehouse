export type QrLabelSheetItem = {
  qr_svg: string
  code: string
  sub?: string
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c))
}

/** Лист QR-этикеток (короба, грузовые места): QR + человекочитаемый номер, лента 58×40 мм.
 *
 * Возвращает false, если окно печати заблокировано браузером: объекты к этому моменту
 * уже заведены, и молчать об этом нельзя — иначе человек жмёт «завести» ещё раз.
 */
export function openQrLabelSheet(labels: QrLabelSheetItem[]): boolean {
  const win = window.open('', '_blank', 'width=900,height=700')
  if (!win) return false
  const cells = labels
    .map((l) => `
      <div class="label">
        <div class="qr">${l.qr_svg}</div>
        <div class="text">
          <div class="code">${escapeHtml(l.code)}</div>
          ${l.sub ? `<div class="sub">${escapeHtml(l.sub)}</div>` : ''}
        </div>
      </div>`)
    .join('')
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title></title>
    <style>
      @page { size: 58mm 40mm; margin: 0mm; }
      * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      html, body { margin: 0; padding: 0; font-family: ui-monospace, monospace; background: #fff; color: #000; }
      .toolbar { padding: 12px 16px; border-bottom: 1px solid #ddd; font-family: system-ui, sans-serif; }
      .toolbar button { font-size: 14px; padding: 6px 14px; cursor: pointer; }
      .label {
        width: 58mm; height: 40mm; padding: 2mm;
        display: flex; align-items: center; gap: 2mm;
        break-inside: avoid; page-break-inside: avoid;
      }
      .label .qr { width: 32mm; height: 32mm; flex: none; }
      .label .qr svg { width: 100%; height: 100%; }
      .label .code { font-size: 15px; font-weight: 600; letter-spacing: 0.04em; }
      .label .sub { font-size: 10px; margin-top: 3px; color: #333; font-family: system-ui, sans-serif; }
      @media screen { body { background: #f4f4f4; } .label { margin: 8px auto; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.2); } }
      @media print { .toolbar { display: none !important; } .label { margin: 0 !important; box-shadow: none !important; } }
    </style></head><body>
    <div class="toolbar"><button onclick="window.print()">Печать</button> &nbsp; Этикеток: ${labels.length} • лента 58×40 мм • масштаб 100% / «Реальный размер».</div>
    ${cells}
    <script>window.addEventListener('load', () => setTimeout(() => window.print(), 150))</script>
    </body></html>`)
  win.document.close()
  return true
}

export type BarcodeLabelSheetItem = {
  barcode: string
  barcode_svg: string
  /** Ширина кода в модулях (с тихими зонами) — держит толщину модуля постоянной. */
  modules: number
  title: string
  sub?: string
  qty: number
}

/** Ширина модуля на печати, мм. У образцов площадок 0.23 мм; берём чуть толще —
 * термопринтер 203 dpi кладёт точку 0.125 мм, и на тонком модуле код «плывёт». */
const MODULE_MM = 0.28
const LABEL_W_MM = 43
const LABEL_H_MM = 25
const CODE_MAX_W_MM = 39

/** Лист этикеток ШК товара: Code 128 + код цифрами + наименование, лента 43×25 мм.
 *
 * Картинка приходит с backend на каждый запрос печати и никуда не сохраняется:
 * штрих-код — функция от цифр, а цифры живут в карточке товара.
 */
export function openBarcodeLabelSheet(items: BarcodeLabelSheetItem[]): boolean {
  const total = items.reduce((s, i) => s + Math.max(1, i.qty), 0)
  if (total === 0) return true
  const win = window.open('', '_blank', 'width=900,height=700')
  if (!win) return false
  // Штрихи каждого кода объявляются один раз символом, а этикетки ссылаются на него
  // через <use>: тираж в тысячи штук — обычное дело, и столько же копий разметки
  // кода (сотня прямоугольников на каждую) вешает вкладку печати.
  const symbols: string[] = []
  const cells = items
    .flatMap((item, i) => {
      const widthMm = Math.min(CODE_MAX_W_MM, item.modules * MODULE_MM)
      const id = `bc${i}`
      symbols.push(
        `<symbol id="${id}" viewBox="0 0 ${item.modules} 10" preserveAspectRatio="none">`
        + item.barcode_svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')
        + '</symbol>',
      )
      const cell = `
      <div class="label">
        <div class="code">${escapeHtml(item.barcode)}</div>
        <svg class="bars" viewBox="0 0 ${item.modules} 10" preserveAspectRatio="none"
             style="width:${widthMm.toFixed(2)}mm"><use href="#${id}"/></svg>
        <div class="title">${escapeHtml(item.title)}</div>
        ${item.sub ? `<div class="sub">${escapeHtml(item.sub)}</div>` : ''}
      </div>`
      return Array.from({ length: Math.max(1, item.qty) }, () => cell)
    })
    .join('')
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title></title>
    <style>
      @page { size: ${LABEL_W_MM}mm ${LABEL_H_MM}mm; margin: 0mm; }
      * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      html, body { margin: 0; padding: 0; font-family: system-ui, sans-serif; background: #fff; color: #000; }
      .toolbar { padding: 12px 16px; border-bottom: 1px solid #ddd; }
      .toolbar button { font-size: 14px; padding: 6px 14px; cursor: pointer; }
      .label {
        width: ${LABEL_W_MM}mm; height: ${LABEL_H_MM}mm; padding: 1mm 1.5mm;
        display: flex; flex-direction: column; align-items: center; justify-content: flex-start;
        overflow: hidden; break-inside: avoid; page-break-inside: avoid; page-break-after: always;
      }
      .label .code { font-family: ui-monospace, monospace; font-size: 7.5pt; letter-spacing: 0.02em; line-height: 1.05; }
      .label .bars { height: 12mm; margin: 0.4mm 0 0.5mm; display: block; fill: #000; }
      .defs { position: absolute; width: 0; height: 0; overflow: hidden; }
      /* Наименование обрезается по второй строке целиком: половина строки букв под
         штрих-кодом читается как брак печати. */
      .label .title {
        font-size: 6.5pt; line-height: 1.1; text-align: center; overflow: hidden;
        display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2;
      }
      .label .sub { font-size: 6pt; line-height: 1.1; text-align: center; color: #333; white-space: nowrap; }
      @media screen { body { background: #f4f4f4; } .label { margin: 8px auto; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.2); } }
      @media print { .toolbar { display: none !important; } .label { margin: 0 !important; box-shadow: none !important; } }
    </style></head><body>
    <svg class="defs" aria-hidden="true">${symbols.join('')}</svg>
    <div class="toolbar"><button onclick="window.print()">Печать</button> &nbsp; Этикеток: ${total} • лента ${LABEL_W_MM}×${LABEL_H_MM} мм • масштаб 100% / «Реальный размер».</div>
    ${cells}
    <script>window.addEventListener('load', () => setTimeout(() => window.print(), 300))</script>
    </body></html>`)
  win.document.close()
  return true
}

/** Этикетка заказа от площадки: PNG печатается листом 58×40, PDF открывается как есть. */
export function openOrderLabel(href: string): boolean {
  if (!/\.png(\?|$)/i.test(href)) {
    return window.open(href, '_blank') !== null
  }
  const win = window.open('', '_blank', 'width=900,height=700')
  if (!win) return false
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title></title>
    <style>
      @page { size: 58mm 40mm; margin: 0mm; }
      html, body { margin: 0; padding: 0; background: #fff; }
      .label { width: 58mm; height: 40mm; display: flex; align-items: center; justify-content: center; }
      .label img { width: 58mm; height: 40mm; object-fit: contain; }
      .toolbar { padding: 12px 16px; border-bottom: 1px solid #ddd; font-family: system-ui, sans-serif; }
      @media screen { body { background: #f4f4f4; } .label { margin: 8px auto; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.2); } }
      @media print { .toolbar { display: none !important; } .label { margin: 0 !important; box-shadow: none !important; } }
    </style></head><body>
    <div class="toolbar"><button onclick="window.print()">Печать</button> &nbsp; Этикетка заказа • лента 58×40 мм.</div>
    <div class="label"><img src="${escapeHtml(href)}" alt="" /></div>
    <script>window.addEventListener('load', () => setTimeout(() => window.print(), 300))</script>
    </body></html>`)
  win.document.close()
  return true
}

/** Лента этикеток заказов от площадки: по одному PNG на страницу 58×40.
 *
 * Печать стартует по событию load окна, а не таймером: картинок здесь десятки, и
 * недогруженная этикетка ушла бы в печать пустой. */
export function openOrderLabelSheet(hrefs: string[]): boolean {
  if (hrefs.length === 0) return true
  const win = window.open('', '_blank', 'width=900,height=700')
  if (!win) return false
  const cells = hrefs
    .map((href) => `<div class="label"><img src="${escapeHtml(href)}" alt="" /></div>`)
    .join('')
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title></title>
    <style>
      @page { size: 58mm 40mm; margin: 0mm; }
      html, body { margin: 0; padding: 0; background: #fff; }
      .label {
        width: 58mm; height: 40mm; display: flex; align-items: center; justify-content: center;
        break-inside: avoid; page-break-inside: avoid; page-break-after: always;
      }
      .label img { width: 58mm; height: 40mm; object-fit: contain; }
      .toolbar { padding: 12px 16px; border-bottom: 1px solid #ddd; font-family: system-ui, sans-serif; }
      .toolbar button { font-size: 14px; padding: 6px 14px; cursor: pointer; }
      @media screen { body { background: #f4f4f4; } .label { margin: 8px auto; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.2); } }
      @media print { .toolbar { display: none !important; } .label { margin: 0 !important; box-shadow: none !important; } }
    </style></head><body>
    <div class="toolbar"><button onclick="window.print()">Печать</button> &nbsp; Этикеток: ${hrefs.length} • лента 58×40 мм • масштаб 100% / «Реальный размер».</div>
    ${cells}
    <script>window.addEventListener('load', () => setTimeout(() => window.print(), 300))</script>
    </body></html>`)
  win.document.close()
  return true
}

export const POPUP_BLOCKED_HINT = 'Окно печати заблокировано браузером — разрешите всплывающие окна и напечатайте ещё раз'
