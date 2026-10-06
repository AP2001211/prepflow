import type { ButtonHTMLAttributes } from 'react'
import { Link } from 'react-router-dom'

export function PlanBuildLink({ to, children }: { to: string; children: React.ReactNode }) {
  return <Link to={to} className="build-action">{children}</Link>
}
export function PlanBuildButton({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className="build-action">{children}</button>
}
