import { useParams } from 'react-router-dom'
import { SwitchSession } from '../../../../components/SwitchSession'

export default function SwitchPage() {
  const { sessionId = '' } = useParams()
  return <SwitchSession sessionId={sessionId} />
}
