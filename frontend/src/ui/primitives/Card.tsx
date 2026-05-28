import type { ReactNode, CSSProperties } from 'react'

interface CardProps {
  children: ReactNode
  style?: CSSProperties
  className?: string
}

export function Card({ children, style, className = '' }: CardProps) {
  return (
    <div className={`card ${className}`} style={style}>
      {children}
    </div>
  )
}

interface CardHeadProps {
  children: ReactNode
  style?: CSSProperties
}

export function CardHead({ children, style }: CardHeadProps) {
  return (
    <div className="card-head" style={style}>
      {children}
    </div>
  )
}

interface CardBodyProps {
  children: ReactNode
  style?: CSSProperties
}

export function CardBody({ children, style }: CardBodyProps) {
  return (
    <div className="card-body" style={style}>
      {children}
    </div>
  )
}
