import { registerPlugin } from '@capacitor/core'

import { IS_NATIVE } from '../api/constants'

// Источник сканирования за абстракцией: сейчас камера, позже — аппаратный ТСД
// (вторая реализация ScanSource), без переписывания экранов. См. docs/mobile-plan.md §8.
export interface ScanSource {
  /** Доступно ли сканирование на этой платформе. */
  isAvailable(): Promise<boolean>
  /**
   * Открыть сканер, вернуть код или null, если пользователь отменил. Бросает при отказе в доступе.
   * `onModuleProgress` — прогресс разовой докачки движка Google (0–100); вызывается только при
   * первой установке модуля, иначе не дёргается.
   */
  scan(onModuleProgress?: (percent: number) => void): Promise<string | null>
}

// Нативный плагин ML Kit ставится перед сборкой:
//   npm i @capacitor-mlkit/barcode-scanning && npx cap sync
// Имя зарегистрированного плагина — 'BarcodeScanner'. В вебе экран покажет ручной ввод кода.
interface Barcode {
  rawValue?: string
  displayValue?: string
}
interface ModuleInstallEvent {
  state: number
  progress?: number
}
interface ListenerHandle {
  remove(): Promise<void>
}
interface BarcodeScanningPlugin {
  isSupported(): Promise<{ supported: boolean }>
  requestPermissions(): Promise<{ camera: string }>
  scan(options?: { formats?: string[]; autoZoom?: boolean }): Promise<{ barcodes: Barcode[] }>
  isGoogleBarcodeScannerModuleAvailable(): Promise<{ available: boolean }>
  installGoogleBarcodeScannerModule(): Promise<void>
  addListener(
    eventName: 'googleBarcodeScannerModuleInstallProgress',
    listenerFunc: (event: ModuleInstallEvent) => void,
  ): Promise<ListenerHandle>
}

const BarcodeScanning = registerPlugin<BarcodeScanningPlugin>('BarcodeScanner')

const SCAN_FORMATS = [
  'CODE_128',
  'CODE_39',
  'CODE_93',
  'CODABAR',
  'EAN_13',
  'EAN_8',
  'ITF',
  'UPC_A',
  'UPC_E',
  'QR_CODE',
  'DATA_MATRIX',
  'PDF_417',
  'AZTEC',
]

// GoogleBarcodeScannerModuleInstallState (из плагина): нужные нам терминальные состояния.
const MODULE_STATE_CANCELED = 3
const MODULE_STATE_COMPLETED = 4
const MODULE_STATE_FAILED = 5

// scan() использует готовый сканер Google (GMS). Сам модуль распознавания в APK не вшит —
// Play Services качают его по требованию при первом использовании. До скачивания scan()
// бросает «module is not available», поэтому модуль надо доустановить заранее и дождаться
// события прогресса (installGoogleBarcodeScannerModule только запускает установку).
async function ensureGoogleModule(onProgress?: (percent: number) => void): Promise<void> {
  const { available } = await BarcodeScanning.isGoogleBarcodeScannerModuleAvailable()
  if (available) return
  let handle: ListenerHandle | undefined
  try {
    await new Promise<void>((resolve, reject) => {
      BarcodeScanning.addListener('googleBarcodeScannerModuleInstallProgress', (e) => {
        onProgress?.(typeof e.progress === 'number' ? e.progress : 0)
        if (e.state === MODULE_STATE_COMPLETED) resolve()
        else if (e.state === MODULE_STATE_FAILED || e.state === MODULE_STATE_CANCELED) {
          reject(new Error('Не удалось установить модуль сканера. Проверьте интернет и Google Play.'))
        }
      })
        .then((h) => {
          handle = h
          return BarcodeScanning.installGoogleBarcodeScannerModule()
        })
        .catch(reject)
    })
  } finally {
    await handle?.remove()
  }
}

class CameraScanSource implements ScanSource {
  async isAvailable(): Promise<boolean> {
    return IS_NATIVE
  }

  async scan(onModuleProgress?: (percent: number) => void): Promise<string | null> {
    const perm = await BarcodeScanning.requestPermissions()
    if (perm.camera !== 'granted' && perm.camera !== 'limited') {
      throw new Error('Нет доступа к камере. Разрешите доступ в настройках телефона.')
    }
    await ensureGoogleModule(onModuleProgress)
    const { barcodes } = await BarcodeScanning.scan({ formats: SCAN_FORMATS, autoZoom: true })
    const first = barcodes.find((b) => (b.rawValue ?? b.displayValue ?? '').trim())
    if (!first) return null
    return String(first.rawValue ?? first.displayValue ?? '').trim() || null
  }
}

export const scanSource: ScanSource = new CameraScanSource()
