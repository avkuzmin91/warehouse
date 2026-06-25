import type { ReactNode, CSSProperties } from 'react'

interface TableProps {
  children: ReactNode
  style?: CSSProperties
  tableStyle?: CSSProperties
}

export function Table({ children, style, tableStyle }: TableProps) {
  return (
    <div className="t-wrap" style={style}>
      <table className="t" style={tableStyle}>{children}</table>
    </div>
  )
}

interface ThProps {
  children: ReactNode
  style?: CSSProperties
  onClick?: () => void
  className?: string
}

export function Th({ children, style, onClick, className = '' }: ThProps) {
  return (
    <th style={{ cursor: onClick ? 'pointer' : undefined, ...style }} onClick={onClick} className={className}>
      {children}
    </th>
  )
}

interface TdProps {
  children?: ReactNode
  style?: CSSProperties
  className?: string
  colSpan?: number
}

export function Td({ children, style, className = '', colSpan }: TdProps) {
  return (
    <td style={style} className={className} colSpan={colSpan}>
      {children}
    </td>
  )
}
