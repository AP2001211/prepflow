import { Link } from 'react-router-dom'
import { CurrentFocus } from '../../../components/CurrentFocus'

export default function FocusPage() {
  return <div className="focus-workspace">
    <Link to="/home" className="quiet-link">← Home</Link>
    <CurrentFocus />
  </div>
}
