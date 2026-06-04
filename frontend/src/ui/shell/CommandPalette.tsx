import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Kbd } from '../primitives/Kbd'
import { Icon } from '../primitives/Icon'
import { useCurrentUser } from '../../hooks/useCurrentUser'
import { canManageUsers } from '../../utils/access'

interface CmdItem {
  section: string
  icon: string
  label: string
  sub: string
  to?: string
  usersAdminOnly?: boolean
}

const ALL_CMDS: CmdItem[] = [
  { section: 'Навигация', icon: 'home', label: 'Главная', sub: 'Сводка по складу', to: '/home' },
  { section: 'Навигация', icon: 'truckIn', label: 'Поступления', sub: 'Список и приемка', to: '/inventory/receipts' },
  { section: 'Навигация', icon: 'truckOut', label: 'Отгрузки', sub: 'Сборка заказов', to: '/inventory/shipments' },
  { section: 'Навигация', icon: 'boxes', label: 'Остатки', sub: 'Что и где лежит', to: '/inventory/balances' },
  { section: 'Навигация', icon: 'book', label: 'Справочники', sub: 'Товары, цвета, размеры, клиенты', to: '/dictionaries' },
  { section: 'Навигация', icon: 'users', label: 'Пользователи и роли', sub: 'Управление доступом', to: '/dictionaries/users', usersAdminOnly: true },
  { section: 'Действия', icon: 'plus', label: 'Новое поступление', sub: 'Создать черновик документа', to: '/inventory/receipts/new' },
  { section: 'Действия', icon: 'plus', label: 'Новая отгрузка', sub: 'Заявка от клиента', to: '/inventory/shipments/new' },
  { section: 'Аккаунт', icon: 'lock', label: 'Сменить пароль', sub: '', to: '/account/password' },
]

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const { user } = useCurrentUser()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open])

  const lq = q.toLowerCase()
  const filtered = ALL_CMDS.filter(
    (c) => (!c.usersAdminOnly || canManageUsers(user)) && (!lq || c.label.toLowerCase().includes(lq) || c.sub.toLowerCase().includes(lq)),
  )

  const grouped = filtered.reduce<Record<string, CmdItem[]>>((acc, c) => {
    ;(acc[c.section] = acc[c.section] || []).push(c)
    return acc
  }, {})

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(filtered.length - 1, s + 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)) }
    if (e.key === 'Enter') {
      e.preventDefault()
      const c = filtered[sel]
      if (c?.to) { navigate(c.to); onClose() }
    }
  }

  if (!open) return null

  let cursor = 0

  return (
    <div className="cmdk-backdrop" onClick={onClose}>
      <div className="cmdk" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="cmdk-input"
          placeholder="Найти команду, документ или раздел..."
          value={q}
          onChange={(e) => { setQ(e.target.value); setSel(0) }}
          onKeyDown={handleKey}
        />
        <div className="cmdk-list">
          {Object.entries(grouped).map(([section, items]) => (
            <div key={section}>
              <div className="cmdk-section">{section}</div>
              {items.map((c) => {
                const myIdx = cursor++
                return (
                  <div
                    key={c.label}
                    className={`cmdk-item ${myIdx === sel ? 'sel' : ''}`}
                    onMouseEnter={() => setSel(myIdx)}
                    onClick={() => { if (c.to) { navigate(c.to); onClose() } }}
                  >
                    <Icon name={c.icon as never} size={15} className="ic" />
                    <div>
                      <div>{c.label}</div>
                      {c.sub && <div className="cmdk-sub">{c.sub}</div>}
                    </div>
                    <Icon name="arrowRight" size={13} className="cmdk-arrow" />
                  </div>
                )
              })}
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--c-text-muted)', fontSize: 13 }}>
              Ничего не найдено
            </div>
          )}
        </div>
        <div style={{
          padding: '8px 14px',
          borderTop: '1px solid var(--c-border)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontSize: 11,
          color: 'var(--c-text-subtle)',
          background: 'var(--c-bg-sunken)',
        }}>
          <Kbd>↑</Kbd><Kbd>↓</Kbd>навигация
          <span style={{ flex: 1 }} />
          <Kbd>↵</Kbd>открыть
          <span style={{ flex: 1 }} />
          <Kbd>esc</Kbd>закрыть
        </div>
      </div>
    </div>
  )
}
