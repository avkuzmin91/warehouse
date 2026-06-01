type Props = {
  name: string
  sku: string
  color?: string | null
  size?: string | null
}

export function LineIdentityCell({ name, sku, color, size }: Props) {
  return (
    <div>
      <div style={{ fontWeight: 500 }}>{name}</div>
      <div className="t-sub mono">
        {sku}
        {color ? ` · ${color}` : ''}
        {size ? ` · ${size}` : ''}
      </div>
    </div>
  )
}
