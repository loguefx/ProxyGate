import { useState } from 'react'
import { useSettingsStore } from '../store/useSettingsStore'
import { AppSettings } from '../lib/types'
import Toggle from '../components/ui/Toggle'
import Button from '../components/ui/Button'

const INPUT_STYLE: React.CSSProperties = {
  width: '100%', background: 'var(--bg2)', border: '1px solid var(--border2)',
  borderRadius: 'var(--radius)', padding: '8px 12px',
  fontSize: '12.5px', color: 'var(--text1)', outline: 'none',
}

function SectionCard({ title, children, collapsible = false }: {
  title: string; children: React.ReactNode; collapsible?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{
      background: 'var(--bg1)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: '14px',
    }}>
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', borderBottom: (!collapsible || open) ? '1px solid var(--border)' : 'none',
          cursor: collapsible ? 'pointer' : 'default',
        }}
        onClick={() => collapsible && setOpen(o => !o)}
      >
        <span style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text1)' }}>{title}</span>
        {collapsible && (
          <span style={{ color: 'var(--text3)', fontSize: '12px' }}>{open ? '▼' : '▶'}</span>
        )}
      </div>
      {(!collapsible || open) && (
        <div style={{ padding: '16px' }}>{children}</div>
      )}
    </div>
  )
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text3)', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </label>
      {children}
    </div>
  )
}

export default function Settings() {
  const settings = useSettingsStore(s => s.settings)
  const saveSettings = useSettingsStore(s => s.save)

  const [draft, setDraft] = useState<Partial<AppSettings>>({})

  const val = <K extends keyof AppSettings>(key: K): AppSettings[K] =>
    (draft[key] !== undefined ? draft[key] : settings[key]) as AppSettings[K]

  function patch<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setDraft(d => ({ ...d, [key]: value }))
  }

  async function handleSave() {
    await saveSettings(draft)
    setDraft({})
  }

  return (
    <div style={{ animation: 'fade-in 0.2s ease', maxWidth: '720px' }}>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text1)' }}>Settings</h1>
        <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '3px' }}>
          ProxyGate application configuration
        </p>
      </div>

      {/* Network card */}
      <SectionCard title="Network">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <FormRow label="HTTP port">
            <input
              className="mono" style={INPUT_STYLE} type="number"
              value={val('httpPort')}
              onChange={e => patch('httpPort', parseInt(e.target.value, 10))}
            />
          </FormRow>
          <FormRow label="HTTPS port">
            <input
              className="mono" style={INPUT_STYLE} type="number"
              value={val('httpsPort')}
              onChange={e => patch('httpsPort', parseInt(e.target.value, 10))}
            />
          </FormRow>
          <FormRow label="Admin API port">
            <input
              className="mono" style={INPUT_STYLE} type="number"
              value={val('adminPort')}
              onChange={e => patch('adminPort', parseInt(e.target.value, 10))}
            />
          </FormRow>
          <FormRow label="Log level">
            <select
              style={INPUT_STYLE}
              value={val('logLevel')}
              onChange={e => patch('logLevel', e.target.value as AppSettings['logLevel'])}
            >
              {(['DEBUG', 'INFO', 'WARN', 'ERROR'] as const).map(l => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </FormRow>
        </div>
      </SectionCard>

      {/* Public IP card */}
      <SectionCard title="Public IP">
        <FormRow label="ProxyGate public IP">
          <input
            className="mono" style={INPUT_STYLE}
            placeholder="203.0.113.10"
            value={val('publicIp')}
            onChange={e => patch('publicIp', e.target.value)}
          />
        </FormRow>
        <p style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '6px' }}>
          This is the IP address you put in all DNS records. ProxyGate routes traffic by Host header.
        </p>
      </SectionCard>

      {/* Config export card */}
      <SectionCard title="Config export">
        <FormRow label="Generated config path">
          <input
            className="mono"
            style={{ ...INPUT_STYLE, color: 'var(--text3)', cursor: 'not-allowed' }}
            value={settings.configOutputPath}
            readOnly
          />
        </FormRow>
        <p style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '6px', marginBottom: '14px' }}>
          Auto-generated by ProxyGate — do not edit manually
        </p>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button variant="primary" size="md" onClick={handleSave}>
            Save changes
          </Button>
          <Button variant="ghost" size="md">
            Export config
          </Button>
          <Button variant="ghost" size="md">
            Restart proxy
          </Button>
        </div>
      </SectionCard>

      {/* High availability card */}
      <SectionCard title="High availability" collapsible>
        <div style={{ marginBottom: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <span style={{ fontSize: '13px', color: 'var(--text1)' }}>Enable HA mode</span>
            <Toggle
              checked={val('haEnabled')}
              onChange={v => patch('haEnabled', v)}
            />
          </div>

          {val('haEnabled') && (
            <div style={{ animation: 'fade-in 0.15s ease' }}>
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text3)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  This node
                </label>
                <div style={{ display: 'flex', gap: '2px', background: 'var(--bg2)', padding: '3px', borderRadius: 'var(--radius)', width: 'fit-content' }}>
                  {(['primary', 'secondary'] as const).map(role => (
                    <button
                      key={role}
                      onClick={() => patch('haRole', role)}
                      style={{
                        padding: '5px 16px', border: 'none', borderRadius: '6px', cursor: 'pointer',
                        fontSize: '12px', fontWeight: 500,
                        background: val('haRole') === role ? 'var(--accent)' : 'transparent',
                        color: val('haRole') === role ? '#0d1a12' : 'var(--text3)',
                        transition: 'all 0.15s',
                      }}
                    >
                      {role.charAt(0).toUpperCase() + role.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
                <FormRow label="Floating VIP">
                  <input
                    className="mono" style={INPUT_STYLE}
                    placeholder="203.0.113.10"
                    value={val('haVip')}
                    onChange={e => patch('haVip', e.target.value)}
                  />
                </FormRow>
                <FormRow label="Peer node IP">
                  <input
                    className="mono" style={INPUT_STYLE}
                    placeholder="192.168.1.2"
                    value={val('haPeerIp')}
                    onChange={e => patch('haPeerIp', e.target.value)}
                  />
                </FormRow>
                <FormRow label="Network interface">
                  <input
                    className="mono" style={INPUT_STYLE}
                    placeholder="eth0"
                    value={val('haInterface')}
                    onChange={e => patch('haInterface', e.target.value)}
                  />
                </FormRow>
              </div>

              <div style={{
                background: 'var(--blue-dim)', border: '1px solid rgba(77,158,255,0.2)',
                borderRadius: 'var(--radius)', padding: '12px 14px',
              }}>
                <p style={{ fontSize: '12px', color: 'var(--text2)', lineHeight: 1.5 }}>
                  Run two ProxyGate instances. keepalived assigns the Floating VIP to whichever
                  node is healthy. Your domain always points to the VIP — it never changes even
                  if one ProxyGate node goes down. Both nodes must run identical configs.
                </p>
              </div>
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  )
}
