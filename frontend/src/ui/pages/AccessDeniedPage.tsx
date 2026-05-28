import { useNavigate } from 'react-router-dom'
import { EmptyState } from '../primitives/EmptyState'

export function AccessDeniedPage() {
  const navigate = useNavigate()
  return (
    <div className="page">
      <EmptyState
        title="Доступ запрещён"
        sub="У вас нет прав для просмотра этой страницы"
        action={
          <button className="btn primary" onClick={() => navigate('/home')}>
            На главную
          </button>
        }
      />
    </div>
  )
}
