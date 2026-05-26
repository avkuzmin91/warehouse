interface AvatarProps {
  initials: string
  lg?: boolean
}

export function Avatar({ initials, lg = false }: AvatarProps) {
  return (
    <div className={`avatar ${lg ? 'lg' : ''}`}>{initials}</div>
  )
}

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}
