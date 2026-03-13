type HealthStatus = 'up' | 'down' | 'unknown'

interface HealthDotProps {
  status: HealthStatus
}

export default function HealthDot({ status }: HealthDotProps) {
  const color =
    status === 'up'      ? '#3dd68c' :
    status === 'down'    ? '#f05252' :
    'var(--text3)'

  return (
    <span style={{
      display: 'inline-block',
      width: '7px',
      height: '7px',
      borderRadius: '50%',
      background: color,
      flexShrink: 0,
      animation: status === 'up' ? 'pulse-dot 2s ease-in-out infinite' : 'none',
    }} />
  )
}
