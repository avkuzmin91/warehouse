import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../primitives/Icon'

interface FormPageProps {
  title: string
  subtitle?: string
  backTo?: string
  actions?: ReactNode
  children: ReactNode
}

export function FormPage({ title, subtitle, backTo, actions, children }: FormPageProps) {
  const navigate = useNavigate()
  return (
    <div className="page">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          {backTo && (
            <button className="btn ghost icon" style={{ marginTop: 2 }} onClick={() => navigate(backTo)}>
              <Icon name="arrowLeft" size={16} />
            </button>
          )}
          <div>
            <div className="page-title">{title}</div>
            {subtitle && <div className="page-subtitle">{subtitle}</div>}
          </div>
        </div>
        {actions && <div className="row gap-8">{actions}</div>}
      </div>
      {children}
    </div>
  )
}
