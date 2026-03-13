import { useMiddlewareStore } from '../store/useMiddlewareStore'
import Toggle from '../components/ui/Toggle'

const MW_META: Record<string, { icon: string; label: string; description: string; hasConfig: boolean }> = {
  'rate-limit':     { icon: '⚡', label: 'Rate limiting',       description: 'Max requests per IP per second',          hasConfig: true },
  'basic-auth':     { icon: '🔑', label: 'Basic auth',          description: 'Require HTTP basic authentication',       hasConfig: false },
  'cors':           { icon: '🌐', label: 'CORS headers',        description: 'Cross-origin resource sharing',           hasConfig: true },
  'gzip':           { icon: '📦', label: 'Gzip compression',    description: 'Compress responses automatically',        hasConfig: false },
  'ip-whitelist':   { icon: '🛡',  label: 'IP whitelist',       description: 'Allow only specified CIDR ranges',        hasConfig: true },
  'https-redirect': { icon: '↪',  label: 'HTTP → HTTPS',       description: 'Force all plain-HTTP to HTTPS',           hasConfig: false },
  'custom-headers': { icon: '✏',  label: 'Custom headers',     description: 'Inject or strip request/response headers', hasConfig: true },
}

const INPUT_STYLE: React.CSSProperties = {
  background: 'var(--bg2)', border: '1px solid var(--border2)',
  borderRadius: 'var(--radius)', padding: '6px 10px',
  fontSize: '12px', color: 'var(--text1)', outline: 'none',
}

function MiddlewareRow({ id }: { id: string }) {
  const configs = useMiddlewareStore(s => s.configs)
  const toggle = useMiddlewareStore(s => s.toggle)
  const updateConfig = useMiddlewareStore(s => s.updateConfig)

  const config = configs.find(c => c.id === id)
  const meta = MW_META[id]
  if (!config || !meta) return null

  const cfg = config.config

  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: '12px',
          padding: '12px 16px', transition: 'background 0.12s',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg2)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        <div style={{
          width: '30px', height: '30px', background: 'var(--bg3)',
          borderRadius: '7px', display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: '14px', flexShrink: 0,
        }}>
          {meta.icon}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '12.5px', fontWeight: 500, color: 'var(--text1)' }}>{meta.label}</div>
          <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '1px' }}>{meta.description}</div>
        </div>
        <Toggle checked={config.enabled} onChange={() => toggle(id)} />
      </div>

      {/* Sub-config */}
      {config.enabled && meta.hasConfig && (
        <div style={{
          padding: '10px 16px 12px 58px',
          background: 'var(--bg2)',
          animation: 'fade-in 0.15s ease',
        }}>
          {id === 'rate-limit' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12px', color: 'var(--text2)' }}>
              Max requests per second:
              <input
                type="number"
                style={{ ...INPUT_STYLE, width: '80px' }}
                value={(cfg as { ratePerSecond?: number }).ratePerSecond ?? 100}
                onChange={e => updateConfig(id, { ...cfg, ratePerSecond: parseInt(e.target.value, 10) })}
              />
            </label>
          )}
          {id === 'ip-whitelist' && (
            <div>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text3)', marginBottom: '5px' }}>
                Allowed CIDR ranges (one per line):
              </label>
              <textarea
                style={{ ...INPUT_STYLE, width: '300px', height: '80px', resize: 'vertical', display: 'block' }}
                value={((cfg as { cidrs?: string[] }).cidrs ?? []).join('\n')}
                onChange={e => updateConfig(id, { ...cfg, cidrs: e.target.value.split('\n').filter(Boolean) })}
                placeholder="192.168.1.0/24&#10;10.0.0.0/8"
              />
            </div>
          )}
          {id === 'cors' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12px', color: 'var(--text2)' }}>
              Allowed origins:
              <input
                style={{ ...INPUT_STYLE, width: '220px' }}
                value={((cfg as { allowOrigins?: string[] }).allowOrigins ?? ['*']).join(', ')}
                onChange={e => updateConfig(id, { ...cfg, allowOrigins: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                placeholder="* or https://app.example.com"
              />
            </label>
          )}
          {id === 'custom-headers' && (
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text3)', marginBottom: '6px' }}>
                Set header (Key: Value, comma-separated):
              </div>
              <input
                style={{ ...INPUT_STYLE, width: '320px' }}
                value={Object.entries((cfg as { set?: Record<string, string> }).set ?? {}).map(([k, v]) => `${k}: ${v}`).join(', ')}
                onChange={e => {
                  const set: Record<string, string> = {}
                  e.target.value.split(',').forEach(pair => {
                    const [k, ...v] = pair.split(':')
                    if (k && v.length) set[k.trim()] = v.join(':').trim()
                  })
                  updateConfig(id, { ...cfg, set })
                }}
                placeholder="X-Custom: value, X-Other: val"
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function Middleware() {
  const configs = useMiddlewareStore(s => s.configs)

  return (
    <div style={{ animation: 'fade-in 0.2s ease' }}>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text1)' }}>Middleware</h1>
        <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '3px' }}>
          Global middleware plugins applied per-route via checkboxes when creating routes
        </p>
      </div>

      <div style={{
        background: 'var(--bg1)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)', overflow: 'hidden',
      }}>
        {configs.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text3)', fontSize: '12px' }}>
            Loading middleware…
          </div>
        ) : (
          Object.keys(MW_META).map(id => <MiddlewareRow key={id} id={id} />)
        )}
      </div>
    </div>
  )
}
