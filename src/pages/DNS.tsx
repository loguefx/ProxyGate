import { useState } from 'react'
import { useSettingsStore } from '../store/useSettingsStore'
import Toggle from '../components/ui/Toggle'
import Button from '../components/ui/Button'

export default function DNS() {
  const settings = useSettingsStore(s => s.settings)
  const saveSettings = useSettingsStore(s => s.save)

  const [ipInput, setIpInput] = useState(settings.publicIp)

  const ip = settings.publicIp || '203.0.113.10'
  const baseDomain = ip ? 'example.com' : 'example.com'

  return (
    <div style={{ animation: 'fade-in 0.2s ease', maxWidth: '760px' }}>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text1)' }}>DNS / Cloudflare</h1>
        <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '3px' }}>
          Configure how your domains point to ProxyGate
        </p>
      </div>

      {/* Section 1: Public IP */}
      <Card title="ProxyGate public IP" style={{ marginBottom: '14px' }}>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <input
              className="mono"
              style={{
                width: '100%', background: 'var(--bg2)', border: '1px solid var(--border2)',
                borderRadius: 'var(--radius)', padding: '8px 12px',
                fontSize: '13px', color: 'var(--text1)', outline: 'none',
              }}
              placeholder="203.0.113.10"
              value={ipInput}
              onChange={e => setIpInput(e.target.value)}
            />
            <p style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '6px' }}>
              This is the only IP address you put in all your DNS records.
            </p>
          </div>
          <Button
            variant="primary"
            size="md"
            onClick={() => saveSettings({ publicIp: ipInput.trim() })}
          >
            Save
          </Button>
        </div>
      </Card>

      {/* Section 2: How it works */}
      <Card style={{ marginBottom: '14px' }}>
        <p style={{ fontSize: '13px', color: 'var(--text2)', lineHeight: 1.6 }}>
          All your domains point to this one IP. When a request arrives, ProxyGate reads the
          Host header — for example{' '}
          <span className="mono" style={{ color: 'var(--text1)' }}>Host: jellyfin.example.com</span>
          {' '}— and routes it to the correct service group. Multiple completely different services
          can share the same IP because they are separated by hostname, not by IP address.
          Cloudflare only ever sees one IP.
        </p>
      </Card>

      {/* Section 3: DNS records table */}
      <Card title="Recommended Cloudflare DNS records" style={{ marginBottom: '14px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Type', 'Name', 'Value', 'Purpose'].map(h => (
                <th key={h} style={{
                  padding: '7px 10px', textAlign: 'left',
                  fontSize: '10px', fontWeight: 600, textTransform: 'uppercase',
                  letterSpacing: '0.08em', color: 'var(--text3)',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              { type: 'A', name: baseDomain, value: ip, purpose: 'Root domain' },
              { type: 'A', name: `*.${baseDomain}`, value: ip, purpose: 'All subdomains (wildcard)' },
              { type: 'A', name: `jellyfin.${baseDomain}`, value: ip, purpose: 'Specific subdomain example' },
            ].map((row, i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '8px 10px' }}>
                  <span className="mono" style={{ color: 'var(--text1)' }}>{row.type}</span>
                </td>
                <td style={{ padding: '8px 10px', color: 'var(--text2)' }}>{row.name}</td>
                <td style={{ padding: '8px 10px' }}>
                  <span className="mono" style={{ color: 'var(--accent)' }}>{row.value}</span>
                </td>
                <td style={{ padding: '8px 10px', color: 'var(--text3)', fontSize: '11px' }}>{row.purpose}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '10px', lineHeight: 1.5 }}>
          The wildcard record <span className="mono">*.{baseDomain}</span> means any subdomain you configure
          in ProxyGate will work automatically — no new DNS record needed per service.
        </p>
      </Card>

      {/* Section 4: CF proxy mode */}
      <Card title="Cloudflare proxy mode" style={{ marginBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <div>
            <div style={{ fontSize: '13px', color: 'var(--text1)', fontWeight: 500 }}>
              Using Cloudflare orange-cloud proxy mode
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '2px' }}>
              Cloudflare routes traffic through their CDN
            </div>
          </div>
          <Toggle
            checked={settings.cloudflareProxyEnabled}
            onChange={v => saveSettings({ cloudflareProxyEnabled: v })}
          />
        </div>
        {settings.cloudflareProxyEnabled && (
          <div style={{
            background: 'var(--blue-dim)', border: '1px solid rgba(77,158,255,0.2)',
            borderRadius: 'var(--radius)', padding: '12px 14px',
          }}>
            <p style={{ fontSize: '12px', color: 'var(--text2)', marginBottom: '10px', lineHeight: 1.5 }}>
              Cloudflare puts its servers in front of yours. Without trusted header config,
              ProxyGate sees Cloudflare's IP instead of your real visitor IPs — affecting
              rate limiting, logs, and IP whitelist rules.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '12px', color: 'var(--accent)' }}>
                <span>✓</span>
                <span>CF-Connecting-IP trusted header — auto-configured in generated Traefik config</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '12px', color: 'var(--accent)' }}>
                <span>✓</span>
                <span>Cloudflare IP ranges — written to forwardedHeaders.trustedIPs</span>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Section 5: Firewall warning */}
      <div style={{
        background: 'var(--amber-dim)', border: '1px solid rgba(245,166,35,0.2)',
        borderRadius: 'var(--radius)', padding: '12px 14px',
        display: 'flex', gap: '10px', alignItems: 'flex-start',
      }}>
        <span style={{ fontSize: '14px', flexShrink: 0 }}>⚠</span>
        <p style={{ fontSize: '12px', color: 'var(--amber)', lineHeight: 1.5 }}>
          Your backend servers should only accept connections from ProxyGate's internal IP.
          Block all backend ports from external internet access. Only ProxyGate's public IP
          (port 80 and 443) needs to be open.
        </p>
      </div>
    </div>
  )
}

function Card({ title, children, style }: { title?: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: 'var(--bg1)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)', overflow: 'hidden', ...style,
    }}>
      {title && (
        <div style={{
          padding: '12px 16px', borderBottom: '1px solid var(--border)',
          fontSize: '12.5px', fontWeight: 600, color: 'var(--text1)',
        }}>
          {title}
        </div>
      )}
      <div style={{ padding: '16px' }}>{children}</div>
    </div>
  )
}
