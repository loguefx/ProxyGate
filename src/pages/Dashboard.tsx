import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRouteStore } from '../store/useRouteStore'
import { useServiceGroupStore } from '../store/useServiceGroupStore'
import { useTLSStore } from '../store/useTLSStore'
import { useLogStore } from '../store/useLogStore'
import HealthDot from '../components/ui/HealthDot'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'

function StatCard({
  label, value, valueColor = 'var(--text1)', sub,
}: {
  label: string
  value: string | number
  valueColor?: string
  sub?: string
}) {
  return (
    <div style={{
      background: 'var(--bg1)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      padding: '14px 16px',
    }}>
      <div style={{
        fontSize: '26px',
        fontWeight: 700,
        letterSpacing: '-0.02em',
        color: valueColor,
        lineHeight: 1.1,
      }}>
        {value}
      </div>
      <div style={{
        fontSize: '11px',
        color: 'var(--text3)',
        fontWeight: 500,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        marginTop: '6px',
      }}>
        {label}
      </div>
      {sub && (
        <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '2px' }}>
          {sub}
        </div>
      )}
    </div>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()
  const routes = useRouteStore(s => s.routes)
  const groups = useServiceGroupStore(s => s.groups)
  const tls = useTLSStore(s => s.config)
  const logLines = useLogStore(s => s.lines)

  const activeRoutes = routes.filter(r => r.enabled).length
  const certCount = tls.certs.length

  const nextExpiry = tls.certs.reduce<number | null>((min, c) => {
    const days = Math.ceil((new Date(c.expiresAt).getTime() - Date.now()) / 86_400_000)
    return min === null ? days : Math.min(min, days)
  }, null)

  const totalUpstreams = groups.reduce((a, g) => a + g.upstreams.length, 0)
  const downUpstreams = groups.reduce(
    (a, g) => a + g.upstreams.filter(u => u.status === 'down').length, 0
  )
  const upUpstreams = totalUpstreams - downUpstreams
  const uptimePct = totalUpstreams > 0
    ? Math.round((upUpstreams / totalUpstreams) * 100)
    : 100

  const recentLogs = [...logLines].reverse().slice(0, 5)

  // Count requests in the last 60 seconds
  const reqPerMin = useMemo(() => {
    const cutoff = Date.now() - 60_000
    return logLines.filter(l => new Date(l.timestamp).getTime() > cutoff).length
  }, [logLines])

  return (
    <div style={{ animation: 'fade-in 0.2s ease' }}>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text1)' }}>Dashboard</h1>
        <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '3px' }}>
          System overview
        </p>
      </div>

      {/* Stat cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '10px',
        marginBottom: '16px',
      }}>
        <StatCard label="Active routes" value={activeRoutes} valueColor="var(--accent)" />
        <StatCard label="Service groups" value={groups.length} valueColor="var(--blue)" />
        <StatCard
          label="Uptime"
          value={`${uptimePct}%`}
          sub="upstream health"
        />
        <StatCard
          label="Requests / min"
          value={reqPerMin}
          valueColor="var(--text1)"
          sub="last 60 seconds"
        />
      </div>

      {/* Two column grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        {/* Recent requests */}
        <div style={{
          background: 'var(--bg1)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <span style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text1)' }}>
              Recent requests
            </span>
            <Button size="sm" variant="ghost" onClick={() => navigate('/logs')}>
              View all →
            </Button>
          </div>
          <div style={{ padding: '8px 0' }}>
            {recentLogs.length === 0 ? (
              <div style={{ padding: '20px 16px', color: 'var(--text3)', fontSize: '12px', textAlign: 'center' }}>
                No log entries yet
              </div>
            ) : (
              recentLogs.map((line, i) => {
                const statusColor =
                  line.status >= 500 ? 'var(--red)' :
                  line.status >= 400 ? 'var(--amber)' :
                  line.status >= 300 ? 'var(--blue)' :
                  'var(--accent)'
                return (
                  <div key={i} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '5px 16px',
                  }}>
                    <span style={{
                      width: '7px', height: '7px', borderRadius: '50%',
                      background: statusColor, flexShrink: 0,
                    }} />
                    <span className="mono" style={{
                      flex: 1, color: 'var(--text2)', overflow: 'hidden',
                      textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {line.path}
                    </span>
                    <span style={{ fontSize: '10px', color: 'var(--text3)', whiteSpace: 'nowrap' }}>
                      {line.latencyMs}ms
                    </span>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Service health */}
        <div style={{
          background: 'var(--bg1)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--border)',
          }}>
            <span style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text1)' }}>
              Service health
            </span>
          </div>
          <div style={{ padding: '8px 0' }}>
            {groups.length === 0 ? (
              <div style={{ padding: '20px 16px', color: 'var(--text3)', fontSize: '12px', textAlign: 'center' }}>
                No service groups yet
              </div>
            ) : (
              groups.map(group => {
                const down = group.upstreams.filter(u => u.status === 'down').length
                const up = group.upstreams.filter(u => u.status === 'up').length
                const total = group.upstreams.length
                const allHealthy = down === 0
                return (
                  <div key={group.id} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '9px',
                    padding: '6px 16px',
                  }}>
                    <HealthDot status={allHealthy ? 'up' : 'down'} />
                    <span style={{
                      width: '10px', height: '10px', borderRadius: '50%',
                      background: group.colour, flexShrink: 0,
                    }} />
                    <span style={{ flex: 1, fontSize: '12.5px', color: 'var(--text1)', fontWeight: 500 }}>
                      {group.name}
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--text3)' }}>
                      {up}/{total} up
                    </span>
                    {down > 0 ? (
                      <Badge variant="amber">{down} down</Badge>
                    ) : (
                      <Badge variant="green">healthy</Badge>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
