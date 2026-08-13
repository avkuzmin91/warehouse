import { ProductLink } from '../../shared/ProductLink'

type Props = {
  name: string
  sku: string
  color?: string | null
  size?: string | null
  productId?: string | null
}

export function LineIdentityCell({ name, sku, color, size, productId }: Props) {
  return (
    <div>
      <div style={{ fontWeight: 500 }}>
        <ProductLink productId={productId}>{name}</ProductLink>
      </div>
      <div className="t-sub mono">
        {sku}
        {color ? ` · ${color}` : ''}
        {size ? ` · ${size}` : ''}
      </div>
    </div>
  )
}
