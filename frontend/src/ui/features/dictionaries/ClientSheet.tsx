import { useCallback, useEffect, useState } from 'react'
import { fmtDateLong } from '../../../utils/format'
import {
  createClientStore,
  createDictionaryItem,
  deleteClientStore,
  getClientStores,
  updateClientStore,
  updateDictionaryItem,
} from '../../../api/adminApi'
import type { ClientStoreItem, DictionaryItem } from '../../../api/domainTypes'
import { getMpAccounts, MARKETPLACE_LABELS } from '../../../api/marketplacesApi'
import type { MpAccountItem } from '../../../api/marketplacesApi'
import { Drawer } from '../../feedback/Drawer'
import { Field, Input } from '../../primitives/Input'
import { Toggle } from '../../primitives/Checkbox'
import { Icon } from '../../primitives/Icon'

interface ClientSheetProps {
  open: boolean
  onClose: () => void
  onSaved: () => void
  isNew: boolean
  initial?: DictionaryItem | null
}

type StoreDraft = { name: string; is_active: boolean; mp_account_id: string }

export function ClientSheet({ open, onClose, onSaved, isNew, initial }: ClientSheetProps) {
  const [name, setName] = useState('')
  const [active, setActive] = useState(true)
  const [stores, setStores] = useState<ClientStoreItem[]>([])
  const [storeDrafts, setStoreDrafts] = useState<Record<string, StoreDraft>>({})
  const [accounts, setAccounts] = useState<MpAccountItem[]>([])
  const [newStoreName, setNewStoreName] = useState('')
  const [saving, setSaving] = useState(false)
  const [storesLoading, setStoresLoading] = useState(false)
  const [storeSavingId, setStoreSavingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [storeError, setStoreError] = useState<string | null>(null)

  const loadStores = useCallback(async (clientId: string) => {
    setStoresLoading(true)
    setStoreError(null)
    try {
      const items = await getClientStores(clientId)
      setStores(items)
      setStoreDrafts(Object.fromEntries(items.map((store) => [
        store.id,
        { name: store.name, is_active: store.is_active, mp_account_id: store.mp_account_id ?? '' },
      ])))
    } catch (e) {
      setStoreError(e instanceof Error ? e.message : 'Ошибка загрузки магазинов')
    } finally {
      setStoresLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setName(initial?.name ?? '')
    setActive(initial?.is_active ?? true)
    setStores([])
    setStoreDrafts({})
    setNewStoreName('')
    setError(null)
    setStoreError(null)
    setAccounts([])
    if (!isNew && initial?.id) {
      void loadStores(initial.id)
      // Кабинеты нужны для привязки магазина: ШК подтягиваются из кабинета его магазина.
      void getMpAccounts()
        .then((res) => setAccounts(res.items.filter((a) => a.client_id === initial.id)))
        .catch(() => setAccounts([]))
    }
  }, [open, initial, isNew, loadStores])

  const handleSave = async () => {
    if (!name.trim()) { setError('Введите название клиента'); return }
    setSaving(true)
    setError(null)
    try {
      const payload = { name: name.trim(), is_active: active }
      if (isNew) {
        await createDictionaryItem('clients', payload)
      } else if (initial) {
        await updateDictionaryItem('clients', initial.id, payload)
      }
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  async function handleAddStore() {
    if (!initial?.id) return
    if (!newStoreName.trim()) { setStoreError('Введите название магазина'); return }
    setStoreSavingId('new')
    setStoreError(null)
    try {
      await createClientStore(initial.id, { name: newStoreName.trim(), is_active: true })
      setNewStoreName('')
      await loadStores(initial.id)
    } catch (e) {
      setStoreError(e instanceof Error ? e.message : 'Ошибка сохранения магазина')
    } finally {
      setStoreSavingId(null)
    }
  }

  async function handleSaveStore(storeId: string) {
    if (!initial?.id) return
    const draft = storeDrafts[storeId]
    if (!draft) return
    if (!draft.name.trim()) { setStoreError('Введите название магазина'); return }
    setStoreSavingId(storeId)
    setStoreError(null)
    try {
      await updateClientStore(initial.id, storeId, {
        name: draft.name.trim(),
        is_active: draft.is_active,
        mp_account_id: draft.mp_account_id,
      })
      await loadStores(initial.id)
    } catch (e) {
      setStoreError(e instanceof Error ? e.message : 'Ошибка сохранения магазина')
    } finally {
      setStoreSavingId(null)
    }
  }

  async function handleDeleteStore(storeId: string) {
    if (!initial?.id) return
    setStoreSavingId(storeId)
    setStoreError(null)
    try {
      await deleteClientStore(initial.id, storeId)
      await loadStores(initial.id)
    } catch (e) {
      setStoreError(e instanceof Error ? e.message : 'Ошибка удаления магазина')
    } finally {
      setStoreSavingId(null)
    }
  }

  function setStoreDraft(storeId: string, patch: Partial<StoreDraft>) {
    setStoreDrafts((prev) => ({
      ...prev,
      [storeId]: { ...(prev[storeId] ?? { name: '', is_active: true, mp_account_id: '' }), ...patch },
    }))
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isNew ? 'Новый клиент' : (initial?.name ?? '')}
      subtitle={isNew ? 'Добавление клиента в систему' : 'Редактирование'}
      width={560}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={saving}>Отмена</button>
          <button className="btn primary" onClick={handleSave} disabled={saving}>
            <Icon name="check" size={13} />
            {saving ? 'Сохранение…' : isNew ? 'Создать' : 'Сохранить'}
          </button>
        </>
      }
    >
      <Field label="Название" required error={error ?? undefined}>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ООО «Mango Republic»"
          autoFocus
        />
      </Field>

      <Field label="Статус" help="Архивные клиенты скрыты, но не удалены">
        <div style={{ padding: '10px 12px', background: 'var(--c-bg-sunken)', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Toggle checked={active} onChange={setActive} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{active ? 'Активен' : 'Архив'}</div>
            <div className="text-xs subtle">{active ? 'Доступен для выбора в формах' : 'Не появляется в списках выбора'}</div>
          </div>
        </div>
      </Field>

      <div style={{ margin: '18px 0', height: 1, background: 'var(--c-border)' }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <Icon name="cart" size={15} style={{ color: 'var(--c-accent)' }} />
        <div style={{ fontSize: 14, fontWeight: 600 }}>Магазины</div>
      </div>

      {isNew ? (
        <div style={{ padding: '12px 14px', background: 'var(--c-bg-sunken)', borderRadius: 6, color: 'var(--c-text-subtle)', fontSize: 12.5 }}>
          Магазины можно добавить после создания клиента.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
            <Input
              value={newStoreName}
              onChange={(e) => setNewStoreName(e.target.value)}
              placeholder="Например, WB ООО Ромашка"
            />
            <button
              type="button"
              className="btn sm"
              onClick={handleAddStore}
              disabled={storeSavingId === 'new' || storesLoading}
            >
              <Icon name="plus" size={12} />
              Добавить
            </button>
          </div>

          {storeError && <div style={{ color: 'var(--c-danger)', fontSize: 12.5 }}>{storeError}</div>}

          {storesLoading ? (
            <div className="t-sub">Загрузка магазинов…</div>
          ) : stores.length === 0 ? (
            <div style={{ padding: '12px 14px', background: 'var(--c-bg-sunken)', borderRadius: 6, color: 'var(--c-text-subtle)', fontSize: 12.5 }}>
              У клиента пока нет магазинов.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {stores.map((store) => {
                const draft = storeDrafts[store.id]
                  ?? { name: store.name, is_active: store.is_active, mp_account_id: store.mp_account_id ?? '' }
                const dirty = draft.name !== store.name
                  || draft.is_active !== store.is_active
                  || draft.mp_account_id !== (store.mp_account_id ?? '')
                const busy = storeSavingId === store.id
                return (
                  <div
                    key={store.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr auto auto auto',
                      alignItems: 'center',
                      gap: 8,
                      padding: 8,
                      border: '1px solid var(--c-border)',
                      borderRadius: 6,
                      background: 'var(--c-bg-elev)',
                    }}
                  >
                    <Input
                      value={draft.name}
                      onChange={(e) => setStoreDraft(store.id, { name: e.target.value })}
                      disabled={busy}
                    />
                    <Toggle
                      checked={draft.is_active}
                      onChange={(v) => setStoreDraft(store.id, { is_active: v })}
                    />
                    <button
                      type="button"
                      className="btn ghost icon sm"
                      title="Сохранить магазин"
                      onClick={() => handleSaveStore(store.id)}
                      disabled={!dirty || busy}
                    >
                      <Icon name="save" size={13} />
                    </button>
                    <button
                      type="button"
                      className="btn ghost icon sm"
                      title="Удалить магазин"
                      onClick={() => handleDeleteStore(store.id)}
                      disabled={busy}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <select
                        className="input sm"
                        style={{ width: '100%' }}
                        value={draft.mp_account_id}
                        disabled={busy}
                        onChange={(e) => setStoreDraft(store.id, { mp_account_id: e.target.value })}
                      >
                        <option value="">Без кабинета маркетплейса</option>
                        {accounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {MARKETPLACE_LABELS[account.marketplace]} · {account.name}
                          </option>
                        ))}
                      </select>
                      <div className="text-xs subtle" style={{ marginTop: 4 }}>
                        Кабинет магазина — из него подтягиваются ШК товара
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {!isNew && initial && (
        <div style={{ padding: '12px 14px', background: 'var(--c-bg-sunken)', borderRadius: 6, marginTop: 18 }}>
          <div className="text-xs subtle" style={{ marginBottom: 6 }}>МЕТА</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 8, fontSize: 12.5 }}>
            <span className="muted">Создано</span>
            <span>{fmtDateLong(initial.created_at ?? null)}</span>
            <span className="muted">Изменено</span>
            <span>{fmtDateLong(initial.updated_at ?? null)}</span>
          </div>
        </div>
      )}
    </Drawer>
  )
}
