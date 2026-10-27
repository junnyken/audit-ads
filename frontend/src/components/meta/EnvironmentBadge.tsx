import { Badge } from '../primitives/badge'
import { useEnumLabel } from '../../i18n/labels'
import type { Tone } from '../../lib/readiness'

/** Production is `caution`, not a calm colour: it is the one environment that reaches Meta. A fake
 * connection's data is invented locally, so it is named as such wherever it appears. */
const ENVIRONMENT_TONE: Record<string, Tone> = { fake: 'neutral', sandbox: 'info', production: 'caution' }

export function EnvironmentBadge({ environment }: { environment: string }) {
  const label = useEnumLabel()
  return <Badge tone={ENVIRONMENT_TONE[environment] ?? 'neutral'}>{label('connEnv', environment)}</Badge>
}
