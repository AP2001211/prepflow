import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AuthOverlay } from 'deepspace'
import { Button } from './ui'

export function SignedOutGateway() {
  const [showAuth, setShowAuth] = useState(false)
  return (
    <section className="signed-out-gateway public-entry">
      <div className="signed-out-gateway-content">
        <p className="public-brand">PrepFlow</p>
        <h1>Keep your interview preparation moving.</h1>
        <p className="public-description">Sign in to return to your plans, focused sessions, and the work you left off.</p>
        <Button className="public-primary" onClick={() => setShowAuth(true)}>Sign in</Button>
        <Link className="public-back" to="/">Back to PrepFlow</Link>
      </div>
      {showAuth && <AuthOverlay title="Sign in to PrepFlow" description="Continue your interview preparation where you left off." onClose={() => setShowAuth(false)} />}
    </section>
  )
}
