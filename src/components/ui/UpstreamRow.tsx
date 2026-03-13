import { Upstream } from '../../lib/types'
import HealthDot from './HealthDot'
import Badge from './Badge'
import Button from './Button'

interface UpstreamRowProps {
  upstream: Upstream
  onEdit?: () => void
  onRemove: () => void
}

function healthBarWidth(latencyMs?: number): number {
  if (latencyMs === undefined) return 0
  if (latencyMs <= 0) return 100
  if (latencyMs < 50) return 100
  if (latencyMs > 500) return 10
  return Math.max(10, 100 - ((latencyMs - 50) / 450) * 90)
}

export default function UpstreamRow({ upstream, onEdit, onRemove }: UpstreamRowProps) {
  const barWidth = healthBarWidth(upstream.latencyMs)

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      padding: '7px 0',
    }}>
      <HealthDot status={upstream.status} />

      <span className="mono" style={{ flex: 1, color: 'var(--text1)', minWidth: 0 }}>
        {upstream.address}
      </span>

      <span style={{ fontSize: '11px', color: 'var(--text3)', whiteSpace: 'nowrap' }}>
        w:{upstream.weight}
      </span>

      <div style={{
        width: '60px',
        height: '4px',
        background: 'var(--bg3)',
        borderRadius: '2px',
        overflow: 'hidden',
        flexShrink: 0,
      }}>
        <div style={{
          width: `${barWidth}%`,
          height: '100%',
          background: 'var(--accent)',
          borderRadius: '2px',
          transition: 'width 0.5s ease',
        }} />
      </div>

      {upstream.latencyMs !== undefined ? (
        <span style={{ fontSize: '11px', color: 'var(--text3)', width: '44px', textAlign: 'right' }}>
          {upstream.latencyMs}ms
        </span>
      ) : (
        <span style={{ fontSize: '11px', color: 'var(--text3)', width: '44px', textAlign: 'right' }}>
          —
        </span>
      )}

      <Badge
        variant={upstream.status === 'up' ? 'green' : upstream.status === 'down' ? 'red' : 'gray'}
      >
        {upstream.status.toUpperCase()}
      </Badge>

      {onEdit && (
        <Button size="sm" variant="ghost" onClick={onEdit}>
          Edit
        </Button>
      )}
      <Button size="sm" variant="danger" onClick={onRemove}>
        ✕
      </Button>
    </div>
  )
}
