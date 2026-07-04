import { Haptics, ImpactStyle } from '@capacitor/haptics'

// Тактильный и звуковой отклик сканера. Haptics на вебе деградирует в
// navigator.vibrate (или no-op) — вызовы всегда обёрнуты в catch.

let audioCtx: AudioContext | null = null

function beep(freq: number, ms: number, delayMs = 0): void {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    audioCtx ??= new Ctor()
    const t0 = audioCtx.currentTime + delayMs / 1000
    const osc = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    osc.type = 'square'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.08, t0)
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + ms / 1000)
    osc.connect(gain)
    gain.connect(audioCtx.destination)
    osc.start(t0)
    osc.stop(t0 + ms / 1000)
  } catch {
    // без звука — не критично
  }
}

/** Успешный скан: одиночный impact + короткий высокий сигнал. */
export function scanSuccessFeedback(): void {
  void Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {})
  beep(1175, 90)
}

/** «Код не найден»: двойная вибрация + низкий сигнал. */
export function scanNotFoundFeedback(): void {
  void Haptics.vibrate({ duration: 90 }).catch(() => {})
  setTimeout(() => {
    void Haptics.vibrate({ duration: 90 }).catch(() => {})
  }, 170)
  beep(220, 140)
}
