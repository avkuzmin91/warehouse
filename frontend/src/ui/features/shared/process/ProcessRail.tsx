import { Icon } from '../../../primitives/Icon'
import type { IconName } from '../../../primitives/Icon'
import { RoleChip } from './RoleChip'
import { roleAccent } from './roles'
import type { ProcessRole } from './roles'

/** Вертикальный таймлайн фаз процесса. Заменяет горизонтальный степпер.
 *  done — пройденный шаг (галочка + время), active — текущий («сейчас»),
 *  future — пунктирная остановка. Шаги считает домен (рейс / отгрузка). */
export type ProcessStep = {
  key: string
  title: string
  role: ProcessRole | null
  icon: IconName
  state: 'done' | 'active' | 'future'
  /** Подпись времени (mono); для future игнорируется. */
  time?: string | null
  /** Короткая подсказка под active-шагом. */
  sub?: string
}

export function ProcessRail({ steps }: { steps: ProcessStep[] }) {
  return (
    <div style={{ padding: '6px 4px' }}>
      {steps.map((step, i) => {
        const last = i === steps.length - 1
        const done = step.state === 'done'
        const active = step.state === 'active'
        const future = step.state === 'future'
        const dotColor = done ? 'var(--c-success)'
          : active ? roleAccent(step.role)
          : 'var(--c-border-strong)'
        return (
          <div key={step.key} style={{ display: 'flex', gap: 12, position: 'relative' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 22 }}>
              <div style={{
                width: 22, height: 22, borderRadius: 99, flexShrink: 0, zIndex: 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                // done — сплошная заливка (зелёный) + галочка; active — «полый» кружок
                // с цветной рамкой и иконкой роли. Иначе active-шаг роли «Начальник
                // склада» (акцент = зелёный) сливается с зелёным done-шагом.
                background: done ? dotColor : 'var(--c-bg-elev)',
                border: future ? '1.5px dashed var(--c-border-strong)' : `${active ? 2 : 1.5}px solid ${dotColor}`,
                color: done ? '#fff' : active ? dotColor : 'var(--c-text-faint)',
                boxShadow: active ? `0 0 0 4px color-mix(in oklab, ${dotColor} 16%, transparent)` : 'none',
              }}>
                {done ? <Icon name="check" size={11} /> : <Icon name={step.icon} size={11} />}
              </div>
              {!last && (
                <div style={{ width: 2, flex: 1, minHeight: 24, background: done ? 'var(--c-success)' : 'var(--c-border)' }} />
              )}
            </div>
            <div style={{ paddingBottom: last ? 0 : 14, flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  fontSize: 13, fontWeight: active ? 600 : 500,
                  color: future ? 'var(--c-text-subtle)' : 'var(--c-text)',
                }}>{step.title}</span>
                {active && (
                  <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: dotColor }}>
                    сейчас
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
                {step.role && <RoleChip role={step.role} faded={!active} />}
                <span className="mono" style={{ fontSize: 11, color: 'var(--c-text-subtle)' }}>
                  {future || !step.time ? '—' : step.time}
                </span>
              </div>
              {active && step.sub && (
                <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', marginTop: 3 }}>{step.sub}</div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
