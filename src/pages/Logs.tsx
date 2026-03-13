import { useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { useLogStore } from '../store/useLogStore'
import { useRouteStore } from '../store/useRouteStore'
import { LogLine } from '../lib/tauri'

type StatusFilter = 'all' | '2xx' | '3xx' | '4xx' | '5xx'
type AutoClear = 'never' | '30m' | '1h' | '6h' | '24h'

const AUTO_CLEAR_OPTIONS: { value: AutoClear; label: string; ms: number }[] = [
  { value: 'never', label: 'Manual only', ms: 0 },
  { value: '30m',   label: 'Every 30 min', ms: 30 * 60_000 },
  { value: '1h',    label: 'Every hour',   ms: 60 * 60_000 },
  { value: '6h',    label: 'Every 6 hours', ms: 6 * 60 * 60_000 },
  { value: '24h',   label: 'Every 24 hours', ms: 24 * 60 * 60_000 },
]

export default function Logs() {
  const lines = useLogStore(s => s.lines)
  const append = useLogStore(s => s.append)
  const clear  = useLogStore(s => s.clear)
  const routes = useRouteStore(s => s.routes)

  const [routeFilter, setRouteFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [paused, setPaused] = useState(false)
  const [autoClear, setAutoClear] = useState<AutoClear>('never')

  // Auto-clear timer
  useEffect(() => {
    const opt = AUTO_CLEAR_OPTIONS.find(o => o.value === autoClear)
    if (!opt || opt.ms === 0) return
    const id = setInterval(() => clear(), opt.ms)
    return () => clearInterval(id)
  }, [autoClear, clear])

  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // #region agent log - H-C: setting up log-line listener
    fetch('http://127.0.0.1:7581/ingest/0e536268-4ef3-4f03-9144-c51c9664b047',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'f9f24b'},body:JSON.stringify({sessionId:'f9f24b',location:'Logs.tsx:useEffect',message:'registering log-line listener',data:{},hypothesisId:'H-C',timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    let unlisten: (() => void) | undefined
    listen<LogLine>('log-line', event => {
      // #region agent log - H-C: log-line event received
      fetch('http://127.0.0.1:7581/ingest/0e536268-4ef3-4f03-9144-c51c9664b047',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'f9f24b'},body:JSON.stringify({sessionId:'f9f24b',location:'Logs.tsx:listen-cb',message:'log-line event received',data:{payload:event.payload},hypothesisId:'H-C',timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      append(event.payload)
    }).then(fn => { unlisten = fn })
    return () => { unlisten?.() }
  }, [append])

  useEffect(() => {
    if (!paused && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [lines, paused])

  const filtered = lines.filter(line => {
    if (routeFilter !== 'all' && line.host !== routeFilter) return false
    if (statusFilter !== 'all') {
      const code = line.status
      if (statusFilter === '2xx' && (code < 200 || code >= 300)) return false
      if (statusFilter === '3xx' && (code < 300 || code >= 400)) return false
      if (statusFilter === '4xx' && (code < 400 || code >= 500)) return false
      if (statusFilter === '5xx' && code < 500) return false
    }
    return true
  })

  const SELECT_STYLE: React.CSSProperties = {
    background: 'var(--bg2)', border: '1px solid var(--border2)',
    borderRadius: 'var(--radius)', padding: '6px 10px',
    fontSize: '12px', color: 'var(--text1)', outline: 'none',
    cursor: 'pointer',
  }

  function statusColor(code: number): string {
    if (code >= 500) return 'var(--red)'
    if (code >= 400) return 'var(--amber)'
    if (code >= 300) return 'var(--blue)'
    return 'var(--accent)'
  }

  return (
    <div style={{ animation: 'fade-in 0.2s ease' }}>
      <div style={{ marginBottom: '16px' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text1)' }}>Live logs</h1>
        <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '3px' }}>
          Real-time access log from the ProxyGate proxy engine
        </p>
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          style={SELECT_STYLE}
          value={routeFilter}
          onChange={e => setRouteFilter(e.target.value)}
        >
          <option value="all">All routes</option>
          {routes.map(r => (
            <option key={r.id} value={r.hostname}>{r.hostname}</option>
          ))}
        </select>

        <select
          style={SELECT_STYLE}
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as StatusFilter)}
        >
          <option value="all">All status codes</option>
          <option value="2xx">2xx Success</option>
          <option value="3xx">3xx Redirect</option>
          <option value="4xx">4xx Client error</option>
          <option value="5xx">5xx Server error</option>
        </select>

        <button
          onClick={() => setPaused(p => !p)}
          style={{
            background: 'var(--bg2)', border: '1px solid var(--border2)',
            borderRadius: 'var(--radius)', padding: '6px 12px',
            fontSize: '12px', color: paused ? 'var(--amber)' : 'var(--text2)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px',
          }}
        >
          {paused ? '▶ Resume' : '⏸ Pause'}
        </button>

        {/* Auto-clear schedule */}
        <select
          style={SELECT_STYLE}
          value={autoClear}
          onChange={e => setAutoClear(e.target.value as AutoClear)}
          title="Auto-clear schedule"
        >
          {AUTO_CLEAR_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>⏱ {o.label}</option>
          ))}
        </select>

        {/* Manual clear */}
        <button
          onClick={() => clear()}
          style={{
            background: 'var(--bg2)', border: '1px solid var(--border2)',
            borderRadius: 'var(--radius)', padding: '6px 12px',
            fontSize: '12px', color: 'var(--red)', cursor: 'pointer',
          }}
          title="Clear all log entries"
        >
          🗑 Clear
        </button>

        <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--text3)' }}>
          {filtered.length} / {lines.length} entries
        </span>
      </div>

      {/* Log container */}
      <div
        ref={containerRef}
        style={{
          background: 'var(--bg1)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)', overflow: 'auto',
          maxHeight: '460px',
        }}
      >
        {/* Column headers */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '70px 38px 45px 1fr 60px',
          gap: '0 8px',
          padding: '8px 14px',
          borderBottom: '1px solid var(--border)',
          position: 'sticky', top: 0,
          background: 'var(--bg1)', zIndex: 1,
        }}>
          {['Time', 'St', 'Meth', 'Path', 'Lat'].map(h => (
            <span key={h} style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text3)' }}>
              {h}
            </span>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text3)', fontSize: '12px' }}>
            {lines.length === 0
              ? 'Waiting for requests… Browse through your proxy to see entries here.'
              : 'No entries match the current filters.'}
          </div>
        ) : (
          filtered.map((line, i) => (
            <div
              key={i}
              style={{
                display: 'grid',
                gridTemplateColumns: '70px 38px 45px 1fr 60px',
                gap: '0 8px',
                padding: '4px 14px',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg2)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <span className="mono" style={{ color: 'var(--text3)', overflow: 'hidden' }}>
                {line.timestamp.slice(11, 19)}
              </span>
              <span className="mono" style={{ color: statusColor(line.status) }}>
                {line.status}
              </span>
              <span className="mono" style={{ color: 'var(--text3)' }}>
                {line.method}
              </span>
              <span className="mono" style={{
                color: 'var(--text2)', overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {line.host}{line.path}
              </span>
              <span className="mono" style={{ color: 'var(--text3)', textAlign: 'right' }}>
                {line.latencyMs}ms
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
