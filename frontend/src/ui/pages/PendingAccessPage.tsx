import { PendingAccessFeature } from '../features/auth/PendingAccessFeature'

interface PendingAccessPageProps {
  email?: string | null
}

export function PendingAccessPage({ email }: PendingAccessPageProps) {
  return <PendingAccessFeature email={email} />
}
