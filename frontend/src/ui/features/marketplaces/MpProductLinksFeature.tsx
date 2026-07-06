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
import type { MpAccountItem, MpProductItem } from '../../../api/marketplacesApi'
import { getProductVariants } from '../../../api/adminApi'
import { getInventoryProducts } from '../../../api/inventoryLookupsApi'
import { ListPage } from '../../layouts/ListPage'
import { Table, Td } from '../../data/Table'
import { Pagination } from '../../data/Pagination'
import { FiltersBar, FilterSelect } from '../../data/FiltersBar'
import { Combobox } from '../../data/Combobox'
import { Modal } from '../../feedback/Modal'
import { useConfirm } from '../../feedback/ConfirmDialog'
import { useToast } from '../../feedback/Toast'
import { Badge } from '../../primitives/Badge'
import { Icon } from '../../primitives/Icon'
import { SkeletonRows } from '../../primitives/Skeleton'
import { EmptyState } from '../../primitives/EmptyState'
import { useApi } from '../../../hooks/useApi'
import { useFilterParam, usePageParam } from '../../../hooks/useFilterParams'

const PAGE_SIZE = 25

const TABS = [
  { key: '', label: 'Все' },
  { key: 'unlinked', label: 'Не связаны' },
  { key: 'linked', label: 'Связаны' },
] as const

export function MpProductLinksFeature() {
  const toast = useToast()
  const confirm = useConfirm()

  const [accountId, setAccountId] = useFilterParam('account', '')
  const [linkedTab, setLinkedTab] = useFilterParam('linked', '')
  const [search, setSearch] = useFilterParam('search', '')
  const [page, setPage] = usePageParam()
  const [linkTarget, setLinkTarget] = useState<MpProductItem | null>(null)
  const [busy, setBusy] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const [searchInput, setSearchInput] = useState(search)
  useEffect(() => { setSearchInput(search) }, [search])
  useEffect(() => {
    if (searchInput === search) return
    const timer = setTimeout(() => setSearch(searchInput), 250)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput, search])

  const { data: accountsData } = useApi((s) => getMpAccounts(s), [])
  const accounts = accountsData?.items ?? []
  const account: MpAccountItem | null = accounts.find((a) => a.id === accountId) ?? null

  useEffect(() => {
    if (!accountId && accounts.length > 0) setAccountId(accounts[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts.length])

  const { data, loading, error } = useApi(
    (signal) => accountId
      ? getMpProducts({
          account_id: accountId, page, limit: PAGE_SIZE,
          linked: (linkedTab || 'all') as 'all' | 'linked' | 'unlinked',
          search: search.trim() || undefined,
        }, signal)
      : Promise.resolve(null),
    [accountId, page, linkedTab, search, reloadKey],
  )

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const colCount = 6

  const runAction = async (fn: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    try {
      await fn()
      setReloadKey((k) => k + 1)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось выполнить операцию', 'error')
    } finally {
      setBusy(false)
    }
  }

  const handleAutoLink = () => runAction(async () => {
    const res = await autoLinkMpAccount(accountId)
    toast(`Связано автоматически: ${res.stats.auto_linked ?? 0}`)
  })

  const handleSyncCatalog = () => runAction(async () => {
    const res = await syncMpAccountCatalog(accountId)
    toast(`Карточки обновлены: ${res.stats.fetched ?? 0} · авто-связано: ${res.stats.auto_linked ?? 0}`)
  })

  const handleQuickLink = (item: MpProductItem) => runAction(async () => {
    if (!item.suggestion) return
    await linkMpProduct(item.id, {
      product_id: item.suggestion.product_id,
      variant_id: item.suggestion.variant_id,
    })
    toast('Связка сохранена')
  })

  const handleUnlink = async (item: MpProductItem) => {
    const ok = await confirm({
      title: 'Развязать товар?',
      body: `Карточка «${item.offer_id ?? item.title ?? item.external_id}» будет отвязана от товара WMS. Новые заказы по ней перестанут опознаваться.`,
      danger: true,
      confirmLabel: 'Развязать',
    })
    if (!ok) return
    await runAction(async () => {
      await unlinkMpProduct(item.id)
      toast('Связка удалена')
    })
  }

  return (
    <ListPage
      title="Связка товаров"
      subtitle="Карточки маркетплейса ↔ товары WMS: без связки заказ не опознаётся"
      actions={
        accountId ? (
          <>
            <button className="btn" onClick={handleAutoLink} disabled={busy}>
              <Icon name="sparkles" size={14} />Авто-связка по ШК
            </button>
            <button className="btn" onClick={handleSyncCatalog} disabled={busy}>
              <Icon name="refresh" size={14} />Обновить карточки
            </button>
          </>
        ) : undefined
      }
      filters={
        <FiltersBar>
          <FilterSelect
            label="Кабинет"
            value={accountId}
            options={accounts.map((a) => ({
              value: a.id,
              label: `${a.name} (${MARKETPLACE_LABELS[a.marketplace]})`,
            }))}
            onChange={(v) => { setAccountId(v); setPage(1) }}
          />
          <input
            className="input sm"
            placeholder="Поиск: артикул, название, ШК…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{ width: 240 }}
          />
          <div className="tabs" style={{ marginLeft: 'auto' }}>
            {TABS.map((t) => (
              <button
                key={t.key}
                className={`tab ${linkedTab === t.key ? 'active' : ''}`}
                onClick={() => { setLinkedTab(t.key); setPage(1) }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </FiltersBar>
      }
    >
      {accounts.length === 0 && !loading ? (
        <EmptyState
          title="Нет подключённых кабинетов"
          sub="Сначала подключите кабинет продавца в разделе «Подключения» — карточки подтянутся автоматически."
        />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <th style={{ width: 150 }}>Артикул МП</th>
                <th>Карточка маркетплейса</th>
                <th style={{ width: 170 }}>Штрихкоды</th>
                <th>Товар WMS</th>
                <th style={{ width: 110 }}>Связка</th>
                <th style={{ width: 190 }} />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows rows={8} cols={colCount} />
              ) : error ? (
                <tr><td colSpan={colCount}><EmptyState title="Не удалось загрузить" sub={error.message} /></td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={colCount}>
                  <EmptyState title="Карточек нет" sub="Обновите карточки кабинета или измените фильтр" />
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

      {linkTarget && account && (
        <LinkModal
          item={linkTarget}
          clientId={account.client_id}
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
        {item.external_size && <span style={{ color: 'var(--c-text-subtle)' }}> · {item.external_size}</span>}
      </Td>
      <Td className="mono" style={{ fontSize: 11.5, color: 'var(--c-text-subtle)' }}>
        {item.barcodes.length > 0 ? item.barcodes.join(', ') : '—'}
      </Td>
      <Td>
        {item.linked ? (
          <>
            <span className="mono">{item.product_sku}</span>
            {item.product_name && <span> · {item.product_name}</span>}
            {(item.color_name || item.size_name) && (
              <span style={{ color: 'var(--c-text-subtle)' }}> · {[item.color_name, item.size_name].filter(Boolean).join(' / ')}</span>
            )}
          </>
        ) : item.suggestion ? (
          <span style={{ color: 'var(--c-text-subtle)' }}>
            Совпадение по ШК: <span className="mono">{item.suggestion.product_sku}</span>
            {item.suggestion.product_name && <> · {item.suggestion.product_name}</>}
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
      await linkMpProduct(item.id, { product_id: productId, variant_id: variantId || undefined })
      toast('Связка сохранена')
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
