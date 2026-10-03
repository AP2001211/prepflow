import type { ButtonHTMLAttributes } from 'react'
import { Link } from 'react-router-dom'

function Contents({ children }: { children: React.ReactNode }) {
  return <><span className="build-action-inset" aria-hidden="true"><svg viewBox="0 0 28 20" width="28" height="20"><path fill="currentColor" d="M2 2h4v4H2zm4 4h4v4H6zm4 4h4v4h-4zm-4 4h4v4H6zm-4 4h4v2H2zM14 2h4v4h-4zm4 4h4v4h-4zm4 4h4v4h-4zm-4 4h4v4h-4zm-4 4h4v2h-4z" /></svg></span><span className="build-action-label">{children}</span></>
}
export function PlanBuildLink({ to, children }: { to: string; children: React.ReactNode }) {
  return <Link to={to} className="build-action"><Contents>{children}</Contents></Link>
}
export function PlanBuildButton({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className="build-action"><Contents>{children}</Contents></button>
}
