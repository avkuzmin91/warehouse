/** Цвет-свотч по названию цвета: известные имена → фикс. цвет, иначе детерминированный hsl. */
const NAMED: Record<string, string> = {
  'белый': '#e7e5e4', 'черный': '#1c1917',
  'красный': '#dc2626', 'синий': '#2563eb', 'зеленый': '#16a34a',
  'желтый': '#eab308', 'серый': '#9ca3af', 'розовый': '#ec4899',
  'оранжевый': '#ea580c', 'фиолетовый': '#7c3aed', 'голубой': '#0ea5e9',
  'бежевый': '#d6c7a1', 'коричневый': '#92400e', 'бордовый': '#7f1d1d',
  'хаки': '#78716c', 'золотой': '#d4af37', 'серебряный': '#cbd5e1',
}

export function colorSwatch(name: string | null | undefined): string {
  if (!name) return 'var(--c-border-strong)'
  const key = name.trim().toLowerCase().replace(/ё/g, 'е')
  if (NAMED[key]) return NAMED[key]
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 360
  return `hsl(${h} 52% 58%)`
}
