import { useState } from 'react'
import {
  checkMpAccount,
  createMpAccount,
  deleteMpAccount,
  getMpAccounts,
  MARKETPLACE_LABELS,
  marketplaceTone,
  MP_ACCOUNT_STATUS_LABELS,
  syncMpAccountCatalog,
  syncMpAccountOrders,
  updateMpAccount,
} from '../../../api/marketplacesApi'
import type { Marketplace, MpAccountItem } from '../../../api/marketplacesApi'
import { ListPage } from '../../layouts/ListPage'
import { Table, Td } from '../../data/Table'
import { Combobox } from '../../data/Combobox'
import { Modal } from '../../feedback/Modal'
import { useConfirm } from '../../feedback/ConfirmDialog'
import { useToast } from '../../feedback/Toast'
import { Badge } from '../../primitives/Badge'
import { Icon } from '../../primitives/Icon'
import { SkeletonRows } from '../../primitives/Skeleton'
import { EmptyState } from '../../primitives/EmptyState'
import { useApi } from '../../../hooks/useApi'
import { useLookups } from '../../../hooks/useLookups'
import { fmtDateTime } from '../../../utils/format'

export function MpAccountsFeature() {
  const toast = useToast()
  const confirm = useConfirm()
  const [reloadKey, setReloadKey] = useState(0)
  const [modal, setModal] = useState<{ mode: 'create' } | { mode: 'edit'; account: MpAccountItem } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const { data, loading, error } = useApi((s) => getMpAccounts(s), [reloadKey])
  const items = data?.items ?? []
  const colCount = 7

  const reload = () => setReloadKey((k) => k + 1)

  const runAction = async (accountId: string, fn: () => Promise<string>) => {
    if (busyId) return
    setBusyId(accountId)
    try {
      const message = await fn()
      if (message) toast(message)
      reload()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось выполнить операцию', 'error')
    } finally {
      setBusyId(null)
    }
  }

  const handleCheck = (a: MpAccountItem) => runAction(a.id, async () => {
    await checkMpAccount(a.id)
    return 'Связь с кабинетом в порядке'
  })

  const handleSyncOrders = (a: MpAccountItem) => runAction(a.id, async () => {
    const res = await syncMpAccountOrders(a.id)
    return `Заказы синхронизированы: получено ${res.stats.fetched ?? 0}, новых ${res.stats.created ?? 0}`
  })

  const handleSyncCatalog = (a: MpAccountItem) => runAction(a.id, async () => {
    const res = await syncMpAccountCatalog(a.id)
    return `Карточки обновлены: ${res.stats.fetched ?? 0} · авто-связано ${res.stats.auto_linked ?? 0}`
  })

  const handleTogglePause = (a: MpAccountItem) => runAction(a.id, async () => {
    await updateMpAccount(a.id, { status: a.status === 'active' ? 'paused' : 'active' })
    return a.status === 'active' ? 'Синхронизация приостановлена' : 'Синхронизация возобновлена'
  })

  const handleDelete = async (a: MpAccountItem) => {
    const ok = await confirm({
      title: 'Удалить подключение?',
      body: `Кабинет «${a.name}» будет отключён: заказы перестанут синхронизироваться. Уже загруженные заказы останутся в системе.`,
      danger: true,
      confirmLabel: 'Удалить',
    })
    if (!ok) return
    await runAction(a.id, async () => {
      await deleteMpAccount(a.id)
      return 'Подключение удалено'
    })
  }

  return (
    <ListPage
      title="Подключения маркетплейсов"
      subtitle="Кабинеты продавцов Ozon и Wildberries — источник FBS-заказов"
      actions={
        <button className="btn primary" onClick={() => setModal({ mode: 'create' })}>
          <Icon name="plus" size={14} />Подключить кабинет
        </button>
      }
    >
      <Table>
        <thead>
          <tr>
            <th>Название</th>
            <th style={{ width: 110 }}>Маркетплейс</th>
            <th>Клиент</th>
            <th style={{ width: 90 }}>Статус</th>
            <th style={{ width: 150 }}>Последний синк</th>
            <th>Ошибка</th>
            <th style={{ width: 210 }} />
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <SkeletonRows rows={4} cols={colCount} />
          ) : error ? (
            <tr><td colSpan={colCount}><EmptyState title="Не удалось загрузить" sub={error.message} /></td></tr>
          ) : items.length === 0 ? (
            <tr><td colSpan={colCount}>
              <EmptyState
                title="Кабинеты не подключены"
                sub="Подключите кабинет продавца: для Ozon нужны Client-Id и Api-Key, для Wildberries — токен с доступом «Маркетплейс» и «Контент»."
              />
            </td></tr>
          ) : (
            items.map((a) => (
              <tr key={a.id}>
                <Td style={{ fontWeight: 600 }}>{a.name}</Td>
                <Td><Badge tone={marketplaceTone(a.marketplace)}>{MARKETPLACE_LABELS[a.marketplace]}</Badge></Td>
                <Td>{a.client_name ?? '—'}</Td>
                <Td>
                  <Badge tone={a.status === 'active' ? 'success' : 'warning'}>
                    {MP_ACCOUNT_STATUS_LABELS[a.status]}
                  </Badge>
                </Td>
                <Td style={{ color: 'var(--c-text-subtle)' }}>
                  {a.last_sync_at ? fmtDateTime(a.last_sync_at) : '—'}
                </Td>
                <Td>
                  {a.last_sync_error ? (
                    <span title={a.last_sync_error}>
                      <Badge tone="danger" dot>ошибка</Badge>
                      <span style={{ fontSize: 12, color: 'var(--c-danger)', marginLeft: 6 }}>
                        {a.last_sync_error.length > 60 ? `${a.last_sync_error.slice(0, 60)}…` : a.last_sync_error}
                      </span>
                    </span>
                  ) : (
                    <span style={{ color: 'var(--c-text-faint)' }}>—</span>
                  )}
                </Td>
                <Td style={{ textAlign: 'right' }}>
                  <span className="row gap-8" style={{ justifyContent: 'flex-end' }}>
                    <button className="btn ghost icon sm" title="Проверить связь" onClick={() => handleCheck(a)} disabled={busyId === a.id}>
                      <Icon name="pulse" size={14} />
                    </button>
                    <button className="btn ghost icon sm" title="Синхронизировать заказы" onClick={() => handleSyncOrders(a)} disabled={busyId === a.id}>
                      <Icon name="refresh" size={14} />
                    </button>
                    <button className="btn ghost icon sm" title="Обновить карточки товаров" onClick={() => handleSyncCatalog(a)} disabled={busyId === a.id}>
                      <Icon name="download" size={14} />
                    </button>
                    <button
                      className="btn ghost icon sm"
                      title={a.status === 'active' ? 'Приостановить синхронизацию' : 'Возобновить синхронизацию'}
                      onClick={() => handleTogglePause(a)}
                      disabled={busyId === a.id}
                    >
                      <Icon name={a.status === 'active' ? 'pause' : 'play'} size={14} />
                    </button>
                    <button className="btn ghost icon sm" title="Изменить" onClick={() => setModal({ mode: 'edit', account: a })} disabled={busyId === a.id}>
                      <Icon name="edit" size={14} />
                    </button>
                    <button className="btn ghost icon sm" title="Удалить" onClick={() => handleDelete(a)} disabled={busyId === a.id}>
                      <Icon name="trash" size={14} style={{ color: 'var(--c-danger)' }} />
                    </button>
                  </span>
                </Td>
              </tr>
            ))
          )}
        </tbody>
      </Table>

      {modal && (
        <AccountModal
          account={modal.mode === 'edit' ? modal.account : null}
          onClose={() => setModal(null)}
          onDone={() => { setModal(null); reload() }}
        />
      )}
    </ListPage>
  )
}

function AccountModal({ account, onClose, onDone }: {
  account: MpAccountItem | null
  onClose: () => void
  onDone: () => void
}) {
  const toast = useToast()
  const { clients } = useLookups()
  const isEdit = account != null

  const [clientId, setClientId] = useState(account?.client_id ?? '')
  const [marketplace, setMarketplace] = useState<Marketplace>(account?.marketplace ?? 'ozon')
  const [name, setName] = useState(account?.name ?? '')
  const [ozonClientId, setOzonClientId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)

  const canSave = isEdit
    ? Boolean(name.trim())
    : Boolean(clientId && name.trim() && apiKey.trim() && (marketplace !== 'ozon' || ozonClientId.trim()))

  const handleSave = async () => {
    if (!canSave || saving) return
    setSaving(true)
    try {
      if (isEdit) {
        await updateMpAccount(account.id, {
          name: name.trim(),
          ozon_client_id: ozonClientId.trim() || undefined,
          api_key: apiKey.trim() || undefined,
        })
        toast('Подключение обновлено')
      } else {
        await createMpAccount({
          client_id: clientId,
          marketplace,
          name: name.trim(),
          ozon_client_id: marketplace === 'ozon' ? ozonClientId.trim() : undefined,
          api_key: apiKey.trim(),
        })
        toast('Кабинет подключён, карточки загружаются')
      }
      onDone()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось сохранить подключение', 'error')
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? 'Изменить подключение' : 'Подключить кабинет продавца'}
      subtitle={isEdit ? `${MARKETPLACE_LABELS[account.marketplace]} · ключи хранятся скрыто, для замены введите новые` : undefined}
      width={520}
      footer={
        <>
          <button className="btn ghost" onClick={onClose} disabled={saving}>Отмена</button>
          <button className="btn primary" onClick={handleSave} disabled={!canSave || saving}>
            {saving ? 'Проверка подключения…' : isEdit ? 'Сохранить' : 'Подключить'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {!isEdit && (
          <>
            <div>
              <div style={{ fontSize: 12, color: 'var(--c-text-subtle)', marginBottom: 4 }}>Клиент</div>
              <Combobox
                value={clientId || null}
                options={clients.map((c) => ({ value: c.id, label: c.name }))}
                placeholder="Чей это кабинет…"
                onChange={(v) => setClientId(v ? String(v) : '')}
              />
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--c-text-subtle)', marginBottom: 4 }}>Маркетплейс</div>
              <div className="tabs">
                {(['ozon', 'wb'] as Marketplace[]).map((mp) => (
                  <button key={mp} className={`tab ${marketplace === mp ? 'active' : ''}`} onClick={() => setMarketplace(mp)}>
                    {MARKETPLACE_LABELS[mp]}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
        <div>
          <div style={{ fontSize: 12, color: 'var(--c-text-subtle)', marginBottom: 4 }}>Название подключения</div>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Например: ИП Иванов — Ozon" />
        </div>
        {(isEdit ? account.marketplace === 'ozon' : marketplace === 'ozon') && (
          <div>
            <div style={{ fontSize: 12, color: 'var(--c-text-subtle)', marginBottom: 4 }}>
              Client-Id{isEdit && account.ozon_client_id_masked ? ` (сейчас: ${account.ozon_client_id_masked})` : ''}
            </div>
            <input
              className="input mono"
              value={ozonClientId}
              onChange={(e) => setOzonClientId(e.target.value)}
              placeholder={isEdit ? 'Оставьте пустым, чтобы не менять' : 'Client-Id из кабинета Ozon Seller'}
            />
          </div>
        )}
        <div>
          <div style={{ fontSize: 12, color: 'var(--c-text-subtle)', marginBottom: 4 }}>
            {(isEdit ? account.marketplace : marketplace) === 'ozon' ? 'Api-Key' : 'Токен API (Маркетплейс + Контент)'}
            {isEdit ? ` (сейчас: ${account.api_key_masked})` : ''}
          </div>
          <input
            className="input mono"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={isEdit ? 'Оставьте пустым, чтобы не менять' : 'Ключ не отображается после сохранения'}
            autoComplete="new-password"
          />
        </div>
      </div>
    </Modal>
  )
}
