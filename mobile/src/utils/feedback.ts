import { Haptics, ImpactStyle } from '@capacitor/haptics'

// Тактильный и звуковой отклик сканера. Haptics на вебе деградирует в
// navigator.vibrate (или no-op) — вызовы всегда обёрнуты в catch.

let audioCtx: AudioContext | null = null

/** Мягкий тон: атака ~8 мс убирает щелчок, из-за которого частый скан звучит резко. */
function beep(freq: number, ms: number, opts: { type?: OscillatorType; peak?: number; delayMs?: number } = {}): void {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    audioCtx ??= new Ctor()
    // WebView усыпляет контекст между сканами — без resume второй «пик» будет молчать.
    if (audioCtx.state === 'suspended') void audioCtx.resume().catch(() => {})
    const attack = 0.008
    const peak = opts.peak ?? 0.07
    const t0 = audioCtx.currentTime + (opts.delayMs ?? 0) / 1000
    const end = t0 + ms / 1000
    const osc = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    osc.type = opts.type ?? 'sine'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.exponentialRampToValueAtTime(peak, t0 + attack)
    gain.gain.exponentialRampToValueAtTime(0.0001, end)
    osc.connect(gain)
    gain.connect(audioCtx.destination)
    osc.start(t0)
    osc.stop(end + 0.01)
  } catch {
    // без звука — не критично
  }
}

/** Успешный скан: одиночный impact + короткий чистый «пик». */
export function scanSuccessFeedback(): void {
  void Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {})
  beep(1760, 80)
}

/** «Код не найден»: двойная вибрация + низкая нисходящая пара. */
export function scanNotFoundFeedback(): void {
  void Haptics.vibrate({ duration: 90 }).catch(() => {})
  setTimeout(() => {
    void Haptics.vibrate({ duration: 90 }).catch(() => {})
  }, 170)
  beep(330, 120, { type: 'triangle', peak: 0.09 })
  beep(220, 160, { type: 'triangle', peak: 0.09, delayMs: 140 })
}
