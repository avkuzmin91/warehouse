import type { ContainerLabel } from '../../../api/containersApi'

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c))
}

/** Лист этикеток коробов: QR «wms:box:<id>» + человекочитаемый номер, лента 58×40 мм.
 *
 * Возвращает false, если окно печати заблокировано браузером: короба к этому моменту
 * уже заведены, и молчать об этом нельзя — иначе человек жмёт «завести» ещё раз.
 */
export function printBoxLabels(labels: ContainerLabel[]): boolean {
  const win = window.open('', '_blank', 'width=900,height=700')
  if (!win) return false
  const cells = labels
    .map((l) => `
      <div class="label">
        <div class="qr">${l.qr_svg}</div>
        <div class="code">${escapeHtml(l.doc_number)}</div>
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

export const POPUP_BLOCKED_HINT = 'Окно печати заблокировано браузером — разрешите всплывающие окна и напечатайте ещё раз'
