import { Link, useLocation } from 'react-router-dom'
import { buildBreadcrumbsFromPathname } from '../utils/breadcrumbLabels'

export function Breadcrumbs() {
  const { pathname } = useLocation()
  const items = buildBreadcrumbsFromPathname(pathname)
  if (items.length === 0) {
    return null
  }

  return (
    <nav className="breadcrumbs" aria-label="Хлебные крошки">
      <ol className="breadcrumbs__list">
        {items.map((item, i) => (
          <li key={`${i}-${item.label}-${item.to ?? 'here'}`} className="breadcrumbs__item">
            {i > 0 ? (
              <span className="breadcrumbs__sep" aria-hidden>
                {'\u00A0/ \u00A0'}
              </span>
            ) : null}
            {item.to != null ? (
              <Link className="breadcrumbs__link" to={item.to}>
                {item.label}
              </Link>
            ) : (
              <span className="breadcrumbs__current" aria-current="page">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}
