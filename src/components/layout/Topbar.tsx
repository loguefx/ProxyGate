import { useState, useEffect, useCallback } from 'react'
import { useRouteStore } from '../../store/useRouteStore'
import { useServiceGroupStore } from '../../store/useServiceGroupStore'
import { getProxyStatus } from '../../lib/tauri'
import { regenerateConfig } from '../../lib/configGen'

export default function Topbar() {
  const routes = useRouteStore(s => s.routes)
  const groups = useServiceGroupStore(s => s.groups)

  const activeRoutes = routes.filter(r => r.enabled).length
  const totalUpstreams = groups.reduce((acc, g) => acc + g.upstreams.length, 0)

  const [proxyRunning, setProxyRunning] = useState<boolean | null>(null)
  const [proxyPort, setProxyPort] = useState<number | null>(null)
  const [proxyError, setProxyError] = useState<string | null>(null)
  const [restarting, setRestarting] = useState(false)

  const refreshStatus = useCallback(async () => {
    try {
      const s = await getProxyStatus()
      setProxyRunning(s.running)
      setProxyPort(s.port || null)
      setProxyError(s.error)
    } catch {
      setProxyRunning(false)
    }
  }, [])

  // Poll proxy status every 5 seconds
  useEffect(() => {
    refreshStatus()
    const id = setInterval(refreshStatus, 5000)
    return () => clearInterval(id)
  }, [refreshStatus])

  async function handleRestart() {
    setRestarting(true)
    try {
      await regenerateConfig()
      await refreshStatus()
    } finally {
      setRestarting(false)
    }
  }

  // Status chip colors
  const isRunning = proxyRunning === true
  const statusColor = isRunning ? 'var(--accent)' : proxyError ? 'var(--red)' : 'var(--text3)'
  const statusBg   = isRunning ? 'var(--accent-dim)' : proxyError ? 'var(--red-dim)' : 'var(--bg3)'
  const statusBorder = isRunning
    ? '1px solid rgba(61,214,140,0.2)'
    : proxyError
    ? '1px solid rgba(240,82,82,0.2)'
    : '1px solid var(--border2)'

  return (
    <div style={{
      height: '52px',
      background: 'var(--bg1)',
      borderBottom: '1px solid var(--border)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 18px',
      flexShrink: 0,
    }}>
      {/* Left: Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
          <rect width="22" height="22" rx="6" fill="var(--accent)" />
          <path d="M11 5v12M5 11h12" stroke="#0d1a12" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
        <span style={{ fontSize: '14px', fontWeight: 700, letterSpacing: '0.06em' }}>
          <span style={{ color: 'var(--text1)' }}>PROXY</span>
          <span style={{ color: 'var(--accent)' }}>GATE</span>
        </span>
        <span style={{
          fontSize: '10px',
          fontWeight: 500,
          color: 'var(--text3)',
          background: 'var(--bg3)',
          padding: '2px 7px',
          borderRadius: '4px',
          letterSpacing: '0.02em',
        }}>v0.1.0</span>
      </div>

      {/* Right: Status + Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>

        {/* Proxy port/error indicator */}
        {proxyError && (
          <div title={proxyError} style={{
            fontSize: '11px',
            color: 'var(--red)',
            background: 'var(--red-dim)',
            border: '1px solid rgba(240,82,82,0.2)',
            borderRadius: '20px',
            padding: '4px 10px',
            maxWidth: '260px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            ⚠ {proxyError}
          </div>
        )}

        {/* Routes + proxy status chip */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '7px',
          background: statusBg,
          border: statusBorder,
          borderRadius: '20px',
          padding: '5px 12px',
          fontSize: '11.5px',
          color: statusColor,
          fontWeight: 500,
        }}>
          <span style={{
            width: '7px',
            height: '7px',
            borderRadius: '50%',
            background: statusColor,
            flexShrink: 0,
            animation: isRunning ? 'pulse-dot 2s ease-in-out infinite' : 'none',
          }} />
          {isRunning
            ? `${activeRoutes} routes active · ${totalUpstreams} upstreams · :${proxyPort}`
            : proxyRunning === null
            ? 'checking proxy…'
            : `proxy offline · ${activeRoutes} routes · ${totalUpstreams} upstreams`
          }
        </div>

        {/* Restart / reload button */}
        <button
          title="Reload proxy config"
          disabled={restarting}
          onClick={handleRestart}
          style={{
            width: '30px',
            height: '30px',
            border: '1px solid var(--border2)',
            borderRadius: 'var(--radius)',
            background: 'var(--bg3)',
            color: 'var(--text2)',
            cursor: restarting ? 'wait' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '15px',
            transition: 'background 0.15s',
            opacity: restarting ? 0.5 : 1,
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg4)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'var(--bg3)')}
        >
          {restarting ? '…' : '↻'}
        </button>

        <button
          title="Notifications"
          style={{
            width: '30px',
            height: '30px',
            border: '1px solid var(--border2)',
            borderRadius: 'var(--radius)',
            background: 'var(--bg3)',
            color: 'var(--text2)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '15px',
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg4)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'var(--bg3)')}
        >
          🔔
        </button>
      </div>
    </div>
  )
}
