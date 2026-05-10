/**
 * Как бэкенд `fold_ci`: lower + ё→е. Для клиентского фильтра списков автодополнения.
 */
export function foldCiSearch(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е')
}
