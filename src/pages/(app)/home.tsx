import { AuthGate } from 'deepspace'
import { PrepWorkspace } from '../../components/PrepWorkspace'

export default function HomePage() {
  return (
    <AuthGate fallback={<div className="mx-auto max-w-xl px-6 py-20 text-center"><h1 className="text-2xl font-semibold">PrepFlow</h1><p className="mt-3 text-muted-foreground">Sign in using the navigation above to open your private preparation workspace. No upcoming interview required.</p></div>}>
      <PrepWorkspace />
    </AuthGate>
  )
}
