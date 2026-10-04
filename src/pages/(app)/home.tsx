import { SignedOutGateway } from '../../components/SignedOutGateway'
import { AuthGate } from 'deepspace'
import { PrepWorkspace } from '../../components/PrepWorkspace'

export default function HomePage() {
  return (
    <AuthGate fallback={<SignedOutGateway />}>
      <PrepWorkspace />
    </AuthGate>
  )
}
