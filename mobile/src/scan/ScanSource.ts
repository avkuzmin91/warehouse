import { registerPlugin } from '@capacitor/core'

import { IS_NATIVE } from '../api/constants'

// Источник сканирования за абстракцией: сейчас камера, позже — аппаратный ТСД
// (вторая реализация ScanSource), без переписывания экранов. См. docs/mobile-plan.md §8.
export interface ScanSource {
  /** Доступно ли сканирование на этой платформе (камера в нативной сборке). */
  isAvailable(): Promise<boolean>
  /** Открыть сканер, вернуть код или null, если пользователь отменил. Бросает при отказе в доступе. */
  scan(): Promise<string | null>
}

// Нативный плагин ML Kit ставится перед сборкой:
//   npm i @capacitor-mlkit/barcode-scanning && npx cap sync
// Имя зарегистрированного плагина — 'BarcodeScanning'. В вебе он не зарегистрирован:
// isAvailable() вернёт false, экран покажет ручной ввод кода.
interface Barcode {
  rawValue?: string
  displayValue?: string
}
interface BarcodeScanningPlugin {
  isSupported(): Promise<{ supported: boolean }>
  requestPermissions(): Promise<{ camera: string }>
  scan(): Promise<{ barcodes: Barcode[] }>
}

const BarcodeScanning = registerPlugin<BarcodeScanningPlugin>('BarcodeScanning')

class CameraScanSource implements ScanSource {
  async isAvailable(): Promise<boolean> {
    if (!IS_NATIVE) return false
    try {
      return (await BarcodeScanning.isSupported()).supported
    } catch {
      return false
    }
  }

  async scan(): Promise<string | null> {
    const perm = await BarcodeScanning.requestPermissions()
    if (perm.camera !== 'granted' && perm.camera !== 'limited') {
      throw new Error('Нет доступа к камере. Разрешите доступ в настройках телефона.')
    }
    const { barcodes } = await BarcodeScanning.scan()
    const first = barcodes.find((b) => (b.rawValue ?? b.displayValue ?? '').trim())
    if (!first) return null
    return String(first.rawValue ?? first.displayValue ?? '').trim() || null
  }
}

export const scanSource: ScanSource = new CameraScanSource()
