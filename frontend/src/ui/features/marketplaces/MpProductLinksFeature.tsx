import { useEffect, useMemo, useState } from 'react'
import {
  autoLinkMpAccount,
  getMpAccounts,
  getMpProducts,
  linkMpProduct,
  MARKETPLACE_LABELS,
  syncMpAccountCatalog,
  unlinkMpProduct,
} from '../../../api/marketplacesApi'
import type { MpAccountItem, MpLinkResult, MpProductItem } from '../../../api/marketplacesApi'
import { getProductVariants } from '../../../api/adminApi'
import { getInventoryProducts } from '../../../api/inventoryLookupsApi'
import { Link } from 'react-router-dom'
import { ListPage } from '../../layouts/ListPage'
import { Table, Td } from '../../data/Table'
import { Pagination } from '../../data/Pagination'
import { FiltersBar, FilterSelect } from '../../data/FiltersBar'
import { Combobox } from '../../data/Combobox'
import { Modal } from '../../feedback/Modal'
import { ProductLink } from '../shared/ProductLink'
import { useConfirm } from '../../feedback/ConfirmDialog'
import { useToast } from '../../feedback/Toast'
import { Alert } from '../../primitives/Alert'
import { Badge } from '../../primitives/Badge'
import { Icon } from '../../primitives/Icon'
import { SkeletonRows } from '../../primitives/Skeleton'
import { EmptyState } from '../../primitives/EmptyState'
import { useApi } from '../../../hooks/useApi'
import { useFilterParam, useFilterParamsActions, usePageParam } from '../../../hooks/useFilterParams'
import { fmtDateTime } from '../../../utils/format'

const PAGE_SIZE = 25

const LINK_OPTIONS = [
  { value: 'unlinked', label: 'Не связаны' },
  { value: 'linked', label: 'Связаны' },
]

function linkResultText(res: MpLinkResult): string {
  const parts = ['Связка сохранена']
  if (res.barcodes_written) parts.push(`ШК записано в вариант: ${res.barcodes_written}`)
  if (res.barcodes_skipped) parts.push(`занято другим вариантом: ${res.barcodes_skipped}`)
  return parts.join(' · ')
}

export function MpProductLinksFeature() {
  const toast = useToast()
  const confirm = useConfirm()

  const [accountId, setAccountId] = useFilterParam('account', '')
  const [linkedTab, setLinkedTab] = useFilterParam('linked', '')
  const [search, setSearch] = useFilterParam('search', '')
  const [page, setPage] = usePageParam()
  const { setMany } = useFilterParamsActions()
  const [linkTarget, setLinkTarget] = useState<MpProductItem | null>(null)
  const [busyKind, setBusyKind] = useState<'auto' | 'sync' | 'row' | null>(null)
  const busy = busyKind !== null
  const [reloadKey, setReloadKey] = useState(0)

  const [searchInput, setSearchInput] = useState(search)
  useEffect(() => { setSearchInput(search) }, [search])
  useEffect(() => {
    if (searchInput === search) return
    const timer = setTimeout(() => setSearch(searchInput), 250)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput, search])

  const { data: accountsData, loading: accountsLoading } = useApi(
    (s) => getMpAccounts(s),
    [reloadKey],
  )
  const accounts = accountsData?.items ?? []
  // Пустой фильтр = все кабинеты: подставлять чужой кабинет по умолчанию нельзя,
  // иначе список молча показывает товары одного клиента вместо всех.
  const account: MpAccountItem | null = accounts.find((a) => a.id === accountId) ?? null
  const targetAccounts = account ? [account] : accounts

  const { data, loading, error } = useApi(
    (signal) => getMpProducts({
      account_id: accountId || undefined, page, limit: PAGE_SIZE,
      linked: (linkedTab || 'all') as 'all' | 'linked' | 'unlinked',
      search: search.trim() || undefined,
    }, signal),
    [accountId, page, linkedTab, search, reloadKey],
  )

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const colCount = 7
  const filtersActive = !!(search.trim() || linkedTab)

  const resetFilters = () => {
    setSearchInput('')
    setMany({ search: '', linked: '' })
  }

  const runAction = async (kind: 'auto' | 'sync' | 'row', fn: () => Promise<void>) => {
    if (busy) return
    setBusyKind(kind)
    try {
      await fn()
      setReloadKey((k) => k + 1)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось выполнить операцию', 'error')
    } finally {
      setBusyKind(null)
    }
  }

  const handleAutoLink = () => runAction('auto', async () => {
    let linked = 0
    for (const a of targetAccounts) {
      const res = await autoLinkMpAccount(a.id)
      linked += res.stats.auto_linked ?? 0
    }
    if (linked > 0) toast(`Связано автоматически: ${linked}`)
    else toast('Совпадений по ШК нет: у карточек не заполнены штрихкоды либо эти ШК не заведены на вариантах WMS', 'error')
  })

  const handleSyncCatalog = () => runAction('sync', async () => {
    let fetched = 0
    let linked = 0
    for (const a of targetAccounts) {
      const res = await syncMpAccountCatalog(a.id)
      fetched += res.stats.fetched ?? 0
      linked += res.stats.auto_linked ?? 0
    }
    toast(`Карточки обновлены: ${fetched} · авто-связано: ${linked}`)
  })

  const handleQuickLink = (item: MpProductItem) => runAction('row', async () => {
    if (!item.suggestion) return
    const res = await linkMpProduct(item.id, {
      product_id: item.suggestion.product_id,
      variant_id: item.suggestion.variant_id,
    })
    toast(linkResultText(res))
  })

  const handleUnlink = async (item: MpProductItem) => {
    const ok = await confirm({
      title: 'Развязать товар?',
      body: `Карточка «${item.offer_id ?? item.title ?? item.external_id}» будет отвязана от товара WMS. Новые заказы по ней перестанут опознаваться.`,
      danger: true,
      confirmLabel: 'Развязать',
    })
    if (!ok) return
    await runAction('row', async () => {
      await unlinkMpProduct(item.id)
      toast('Связка удалена')
    })
  }

  return (
    <ListPage
      title="Связка товаров"
      subtitle="Карточки маркетплейса ↔ товары WMS: без связки заказ не опознаётся"
      actions={
        targetAccounts.length > 0 ? (
          <>
            <button className="btn" onClick={handleAutoLink} disabled={busy}>
              <Icon name="sparkles" size={14} />
              {busyKind === 'auto' ? 'Связывание…' : 'Авто-связка по ШК'}
            </button>
            <button className="btn" onClick={handleSyncCatalog} disabled={busy}>
              <Icon name="refresh" size={14} />
              {busyKind === 'sync' ? 'Обновление…' : 'Обновить карточки'}
            </button>
          </>
        ) : undefined
      }
      filters={
        <FiltersBar>
          <input
            className="input sm"
            placeholder="Поиск: артикул, название, ШК…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{ width: 280 }}
          />
          <FilterSelect
            label="Кабинет"
            value={accountId}
            options={accounts.map((a) => ({
              value: a.id,
              label: `${a.name} (${MARKETPLACE_LABELS[a.marketplace]})`,
            }))}
            onChange={(v) => { setAccountId(v); setPage(1) }}
          />
          <FilterSelect
            label="Связка"
            value={linkedTab}
            options={LINK_OPTIONS}
            onChange={(v) => { setLinkedTab(v); setPage(1) }}
          />
        </FiltersBar>
      }
    >
      {accounts.length === 0 && !accountsLoading ? (
        <EmptyState
          title="Нет подключённых кабинетов"
          sub="Карточки подтянутся автоматически, как только появится кабинет продавца."
          action={<Link className="btn primary" to="/marketplaces/accounts">Перейти к подключениям</Link>}
        />
      ) : (
        <>
          {account?.status === 'paused' && (
            <Alert tone="warning" style={{ marginBottom: 12 }}>
              Кабинет «{account.name}» на паузе: карточки и заказы не синхронизируются.
            </Alert>
          )}
          {account?.last_sync_error && (
            <Alert tone="danger" style={{ marginBottom: 12 }}>
              Последняя синхронизация не удалась: {account.last_sync_error}
            </Alert>
          )}
          <div className="t-sub" style={{ marginBottom: 8 }}>
            {loading ? 'Загрузка…' : `Карточек: ${total}`}
            {total > PAGE_SIZE && ` · по ${PAGE_SIZE} на странице`}
            {account
              ? ` · ${account.last_sync_at
                  ? `обновлены ${fmtDateTime(account.last_sync_at)}`
                  : 'ни разу не загружались из кабинета'}`
              : accounts.length > 1 && ` · кабинетов: ${accounts.length}`}
          </div>
          <Table>
            <thead>
              <tr>
                <th style={{ width: 150 }}>Артикул МП</th>
                <th>Карточка маркетплейса</th>
                <th style={{ width: 170 }}>Клиент</th>
                <th style={{ width: 170 }}>Штрихкоды</th>
                <th>Товар WMS</th>
                <th style={{ width: 110 }}>Связка</th>
                <th style={{ width: 190 }} />
              </tr>
            </thead>
            <tbody>
              {loading || accountsLoading ? (
                <SkeletonRows rows={8} cols={colCount} />
              ) : error ? (
                <tr><td colSpan={colCount}><EmptyState title="Не удалось загрузить" sub={error.message} /></td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={colCount}>
                  {filtersActive ? (
                    <EmptyState
                      title="Ничего не найдено"
                      sub="Ни одна карточка кабинета не подходит под поиск и фильтр."
                      action={<button className="btn" onClick={resetFilters}>Сбросить фильтры</button>}
                    />
                  ) : (
                    <EmptyState
                      title="Карточек нет"
                      sub="Каталог кабинета ещё не загружен в WMS."
                      action={
                        <button className="btn primary" onClick={handleSyncCatalog} disabled={busy}>
                          <Icon name="refresh" size={14} />
                          {busyKind === 'sync' ? 'Обновление…' : 'Обновить карточки'}
                        </button>
                      }
                    />
                  )}
                </td></tr>
              ) : (
                items.map((it) => (
                  <ProductRow
                    key={it.id}
                    item={it}
                    busy={busy}
                    onQuickLink={() => handleQuickLink(it)}
                    onLink={() => setLinkTarget(it)}
                    onUnlink={() => handleUnlink(it)}
                  />
                ))
              )}
            </tbody>
          </Table>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
        </>
      )}

      {linkTarget && (
        <LinkModal
          item={linkTarget}
          clientId={linkTarget.client_id}
          onClose={() => setLinkTarget(null)}
          onDone={() => { setLinkTarget(null); setReloadKey((k) => k + 1) }}
        />
      )}
    </ListPage>
  )
}

function ProductRow({ item, busy, onQuickLink, onLink, onUnlink }: {
  item: MpProductItem
  busy: boolean
  onQuickLink: () => void
  onLink: () => void
  onUnlink: () => void
}) {
  return (
    <tr>
      <Td className="mono" style={{ fontWeight: 600 }}>{item.offer_id ?? '—'}</Td>
      <Td>
        {item.title ?? '—'}
        {(item.external_color || item.external_size) && (
          <span style={{ color: 'var(--c-text-subtle)' }}>
            {' · '}{[item.external_color, item.external_size].filter(Boolean).join(' / ')}
          </span>
        )}
      </Td>
      <Td>
        {item.client_name ?? '—'}
        <div className="t-sub" style={{ fontSize: 11.5 }}>
          {item.account_name} · {MARKETPLACE_LABELS[item.marketplace]}
        </div>
      </Td>
      <Td className="mono" style={{ fontSize: 11.5, color: 'var(--c-text-subtle)' }}>
        {item.barcodes.length > 0 ? item.barcodes.join(', ') : '—'}
      </Td>
      <Td>
        {item.linked ? (
          <>
            <ProductLink productId={item.product_id}>
              <span className="mono">{item.product_sku}</span>
              {item.product_name && <span> · {item.product_name}</span>}
            </ProductLink>
            {(item.color_name || item.size_name) && (
              <span style={{ color: 'var(--c-text-subtle)' }}> · {[item.color_name, item.size_name].filter(Boolean).join(' / ')}</span>
            )}
          </>
        ) : item.suggestion ? (
          <span style={{ color: 'var(--c-text-subtle)' }}>
            Совпадение по ШК:{' '}
            <ProductLink productId={item.suggestion.product_id}>
              <span className="mono">{item.suggestion.product_sku}</span>
              {item.suggestion.product_name && <> · {item.suggestion.product_name}</>}
            </ProductLink>
          </span>
        ) : (
          <span style={{ color: 'var(--c-text-faint)' }}>—</span>
        )}
      </Td>
      <Td>
        {item.linked ? (
          <Badge tone="success">{item.link_source === 'barcode_auto' ? 'авто (ШК)' : 'вручную'}</Badge>
        ) : item.barcode_conflict ? (
          <span title="Штрихкоды карточки ведут к разным вариантам WMS — свяжите вручную">
            <Badge tone="danger" dot>конфликт ШК</Badge>
          </span>
        ) : (
          <Badge>нет</Badge>
        )}
      </Td>
      <Td style={{ textAlign: 'right' }}>
        {item.linked ? (
          <button className="btn ghost sm" onClick={onUnlink} disabled={busy}>Развязать</button>
        ) : (
          <span className="row gap-8" style={{ justifyContent: 'flex-end' }}>
            {item.suggestion && (
              <button className="btn sm" onClick={onQuickLink} disabled={busy} title="Принять совпадение по штрихкоду">
                <Icon name="check" size={13} />Принять
              </button>
            )}
            <button className="btn ghost sm" onClick={onLink} disabled={busy}>Связать…</button>
          </span>
        )}
      </Td>
    </tr>
  )
}

function LinkModal({ item, clientId, onClose, onDone }: {
  item: MpProductItem
  clientId: string
  onClose: () => void
  onDone: () => void
}) {
  const toast = useToast()
  const [productId, setProductId] = useState<string>(item.suggestion?.product_id ?? '')
  const [variantId, setVariantId] = useState<string>(item.suggestion?.variant_id ?? '')
  const [saving, setSaving] = useState(false)

  const { data: products, loading: productsLoading } = useApi(
    (s) => getInventoryProducts(clientId, s),
    [clientId],
  )
  const { data: variants, loading: variantsLoading } = useApi(
    (s) => productId ? getProductVariants(productId, s) : Promise.resolve(null),
    [productId],
  )

  const productOptions = useMemo(
    () => (products ?? []).map((p) => ({ value: p.id, label: `${p.sku} · ${p.name}` })),
    [products],
  )
  const variantOptions = useMemo(
    () => (variants ?? []).map((v) => ({
      value: v.id,
      label: [v.sku, [v.color_name, v.size_name].filter(Boolean).join(' / ')].filter(Boolean).join(' · '),
    })),
    [variants],
  )

  const handleSave = async () => {
    if (!productId) return
    setSaving(true)
    try {
      const res = await linkMpProduct(item.id, { product_id: productId, variant_id: variantId || undefined })
      toast(linkResultText(res))
      onDone()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось сохранить связку', 'error')
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Связать с товаром WMS"
      subtitle={[item.offer_id, item.title, item.external_size].filter(Boolean).join(' · ')}
      width={520}
      footer={
        <>
          <button className="btn ghost" onClick={onClose} disabled={saving}>Отмена</button>
          <button className="btn primary" onClick={handleSave} disabled={saving || !productId}>
            {saving ? 'Сохранение…' : 'Связать'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <div style={{ fontSize: 12, color: 'var(--c-text-subtle)', marginBottom: 4 }}>Товар</div>
          <Combobox
            value={productId || null}
            options={productOptions}
            loading={productsLoading}
            placeholder="Поиск товара клиента…"
            onChange={(v) => { setProductId(v ? String(v) : ''); setVariantId('') }}
          />
        </div>
        <div>
          <div style={{ fontSize: 12, color: 'var(--c-text-subtle)', marginBottom: 4 }}>
            Вариант (цвет / размер)
          </div>
          <Combobox
            value={variantId || null}
            options={variantOptions}
            loading={variantsLoading}
            disabled={!productId || variantOptions.length === 0}
            placeholder={variantOptions.length === 0 ? 'Без вариантов' : 'Выбрать вариант…'}
            onChange={(v) => setVariantId(v ? String(v) : '')}
            clearable
          />
        </div>
        {item.barcodes.length > 0 && (
          <div style={{ fontSize: 12, color: 'var(--c-text-subtle)' }}>
            ШК карточки: <span className="mono">{item.barcodes.join(', ')}</span>
          </div>
        )}
      </div>
    </Modal>
  )
}
