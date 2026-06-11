import { useNavigate } from 'react-router-dom'
import { getCabinetBalances, getCabinetProducts } from '../../../api/cabinetApi'
import { useApi } from '../../../hooks/useApi'
import { Table, Td } from '../../data/Table'
import { ListPage } from '../../layouts/ListPage'
import { EmptyState } from '../../primitives/EmptyState'
import { Icon } from '../../primitives/Icon'
import { KPI } from '../../primitives/KPI'
import { SkeletonRows } from '../../primitives/Skeleton'

export function CabinetDashboardFeature() {
  const navigate = useNavigate()
  const balances = useApi(
    (signal) => getCabinetBalances({ page: 1, limit: 5, only_positive: true }, signal),
    [],
  )
  const products = useApi(
    (signal) => getCabinetProducts({ page: 1, limit: 5, sort: 'name_asc' }, signal),
    [],
  )

  const balanceItems = balances.data?.items ?? []
  const productItems = products.data?.items ?? []
  const totalShownQty = balanceItems.reduce((sum, item) => sum + item.total, 0)
  const goodShownQty = balanceItems.reduce(
    (sum, item) => sum + item.storage_good + item.packing_good + item.ready_good, 0,
  )
  const defectShownQty = balanceItems.reduce(
    (sum, item) => sum + item.storage_defect + item.packing_defect + item.ready_defect, 0,
  )

  return (
    <ListPage
      title="Личный кабинет"
      subtitle="Ваши товары и текущие складские остатки"
      actions={
        <>
          <button className="btn ghost sm" onClick={() => navigate('/cabinet/products')}>
            <Icon name="box" size={14} />Товары
          </button>
          <button className="btn primary sm" onClick={() => navigate('/cabinet/balances')}>
            <Icon name="boxes" size={14} />Остатки
          </button>
        </>
      }
    >
      <div className="kpi-grid" style={{ marginBottom: 20 }}>
        <KPI label="Товаров" value={(products.data?.total ?? 0).toLocaleString('ru-RU')} />
        <KPI label="Позиций с остатком" value={(balances.data?.total ?? 0).toLocaleString('ru-RU')} />
        <KPI label="Показано годного" value={goodShownQty.toLocaleString('ru-RU')} valueColor="var(--c-success)" unit="шт" />
        <KPI label="Показано брака" value={defectShownQty.toLocaleString('ru-RU')} valueColor="var(--c-warning)" unit="шт" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <section>
          <div className="card-head" style={{ marginBottom: 8 }}>
            <Icon name="boxes" size={15} className="ic-accent" />
            <span className="card-head-title">Остатки</span>
            <div className="flex-1" />
            <span className="t-sub mono">{totalShownQty.toLocaleString('ru-RU')} шт</span>
          </div>
          <Table>
            <thead>
              <tr>
                <th>Товар</th>
                <th style={{ textAlign: 'right', width: 90 }}>Всего</th>
              </tr>
            </thead>
            <tbody>
              {balances.loading ? (
                <SkeletonRows rows={5} cols={2} />
              ) : balances.error ? (
                <tr><Td colSpan={2}><EmptyState title="Не удалось загрузить остатки" sub={balances.error.message} /></Td></tr>
              ) : balanceItems.length === 0 ? (
                <tr><Td colSpan={2}><EmptyState title="Остатков нет" sub="Данные появятся после завершения поступлений" /></Td></tr>
              ) : (
                balanceItems.map((item, index) => (
                  <tr key={`${item.product_id}-${item.color_id}-${item.size_id}-${index}`}>
                    <Td>
                      <div style={{ fontWeight: 500 }}>{item.product_name}</div>
                      <div className="t-sub mono">
                        {[item.product_sku, item.color_name, item.size_name].filter(Boolean).join(' · ')}
                      </div>
                    </Td>
                    <Td className="num" style={{ fontWeight: 600 }}>{item.total.toLocaleString('ru-RU')}</Td>
                  </tr>
                ))
              )}
            </tbody>
          </Table>
        </section>

        <section>
          <div className="card-head" style={{ marginBottom: 8 }}>
            <Icon name="box" size={15} className="ic-accent" />
            <span className="card-head-title">Товары</span>
            <div className="flex-1" />
            <span className="t-sub mono">{(products.data?.total ?? 0).toLocaleString('ru-RU')}</span>
          </div>
          <Table>
            <thead>
              <tr>
                <th>Название</th>
                <th style={{ width: 140 }}>SKU</th>
              </tr>
            </thead>
            <tbody>
              {products.loading ? (
                <SkeletonRows rows={5} cols={2} />
              ) : products.error ? (
                <tr><Td colSpan={2}><EmptyState title="Не удалось загрузить товары" sub={products.error.message} /></Td></tr>
              ) : productItems.length === 0 ? (
                <tr><Td colSpan={2}><EmptyState title="Товаров нет" sub="Доступные товары появятся после привязки к вашему клиенту" /></Td></tr>
              ) : (
                productItems.map((product) => (
                  <tr key={product.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/cabinet/products/${product.id}`)}>
                    <Td style={{ fontWeight: 500 }}>{product.name}</Td>
                    <Td className="mono" style={{ fontSize: 12 }}>{product.sku_base}</Td>
                  </tr>
                ))
              )}
            </tbody>
          </Table>
        </section>
      </div>
    </ListPage>
  )
}
