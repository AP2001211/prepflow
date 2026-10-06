import { Link } from 'react-router-dom'
import { PrepPlanForm } from '../../../../../components/PrepPlanForm'
export default function CreatePrepPlanPage() {
  return <div className="plans-flow prep-plan-page"><Link className="underline" to="/prep">Back to My Prep</Link><h1>Create a prep plan</h1><p className="text-muted-foreground">A little direction for the preparation that matters.</p><PrepPlanForm /></div>
}
