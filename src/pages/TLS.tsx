import { useState } from 'react'
import { useTLSStore } from '../store/useTLSStore'
import { CertEntry } from '../lib/types'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'

const INPUT_STYLE: React.CSSProperties = {
  width: '100%', background: 'var(--bg2)', border: '1px solid var(--border2)',
  borderRadius: 'var(--radius)', padding: '8px 12px',
  fontSize: '12.5px', color: 'var(--text1)', outline: 'none',
}

function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000)
}

export default function TLS() {
  const config = useTLSStore(s => s.config)
  const saveConfig = useTLSStore(s => s.save)
  const addCert = useTLSStore(s => s.addCert)
  const removeCert = useTLSStore(s => s.removeCert)

  const [uploadOpen, setUploadOpen] = useState(false)
  const [certForm, setCertForm] = useState({ domain: '', certPem: '', keyPem: '', issuer: '' })
  const [certErrors, setCertErrors] = useState<Record<string, string>>({})

  function validateCertForm(): boolean {
    const errs: Record<string, string> = {}
    if (!certForm.domain.trim()) errs.domain = 'Domain is required'
    if (!certForm.certPem.trim()) errs.certPem = 'Certificate PEM is required'
    if (!certForm.keyPem.trim()) errs.keyPem = 'Key PEM is required'
    setCertErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function handleUpload() {
    if (!validateCertForm()) return
    const cert: Omit<CertEntry, 'id'> = {
      domain: certForm.domain.trim(),
      certPath: `/etc/proxygate/certs/${certForm.domain.trim()}.crt`,
      keyPath: `/etc/proxygate/certs/${certForm.domain.trim()}.key`,
      issuer: certForm.issuer.trim() || 'Manual',
      expiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(),
      status: 'valid',
    }
    await addCert(cert)
    setUploadOpen(false)
    setCertForm({ domain: '', certPem: '', keyPem: '', issuer: '' })
  }

  return (
    <div style={{ animation: 'fade-in 0.2s ease' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text1)' }}>TLS / SSL</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '3px' }}>
            Certificate management and TLS termination
          </p>
        </div>
        <Button variant="ghost" size="md" onClick={() => setUploadOpen(true)}>+ Upload cert</Button>
      </div>

      {/* Mode selection cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
        {(['acme', 'manual'] as const).map(mode => {
          const selected = config.mode === mode
          return (
            <div
              key={mode}
              onClick={() => saveConfig({ mode })}
              style={{
                background: selected ? 'var(--accent-dim)' : 'var(--bg1)',
                border: selected ? '2px solid var(--accent)' : '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)',
                padding: '16px',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text1)', marginBottom: '4px' }}>
                {mode === 'acme' ? "Let's Encrypt (ACME)" : 'Custom certificates'}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text3)' }}>
                {mode === 'acme'
                  ? 'Auto-issue and renew via Let\'s Encrypt. Requires ports 80+443.'
                  : 'Upload your own certificate and key PEM files per domain.'}
              </div>
            </div>
          )
        })}
      </div>

      {/* ACME form */}
      {config.mode === 'acme' && (
        <div style={{
          background: 'var(--bg1)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)', padding: '16px', marginBottom: '16px',
        }}>
          <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text1)', marginBottom: '14px' }}>
            ACME settings
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text3)', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Email address
              </label>
              <input
                style={INPUT_STYLE}
                type="email"
                placeholder="admin@example.com"
                value={config.acmeEmail ?? ''}
                onChange={e => saveConfig({ acmeEmail: e.target.value })}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text3)', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Challenge type
              </label>
              <select
                style={INPUT_STYLE}
                value={config.acmeChallengeType ?? 'HTTP-01'}
                onChange={e => saveConfig({ acmeChallengeType: e.target.value as 'HTTP-01' | 'DNS-01' | 'TLS-ALPN-01' })}
              >
                <option value="HTTP-01">HTTP-01 (recommended)</option>
                <option value="DNS-01">DNS-01</option>
                <option value="TLS-ALPN-01">TLS-ALPN-01</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Certificates table */}
      <div style={{
        background: 'var(--bg1)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)', overflow: 'hidden',
      }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: '12.5px', fontWeight: 600, color: 'var(--text1)' }}>
          Active certificates
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Domain', 'Issuer', 'Expires', 'Days left', 'Status', ''].map(h => (
                <th key={h} style={{
                  padding: '8px 14px', fontSize: '10px', fontWeight: 600,
                  textTransform: 'uppercase', letterSpacing: '0.08em',
                  color: 'var(--text3)', textAlign: 'left',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {config.certs.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: '28px', textAlign: 'center', color: 'var(--text3)', fontSize: '12px' }}>
                  {config.mode === 'acme'
                    ? 'Certificates are issued automatically. They will appear here once deployed.'
                    : 'No certificates uploaded yet.'}
                </td>
              </tr>
            ) : (
              config.certs.map(cert => {
                const days = daysUntil(cert.expiresAt)
                const statusVariant = days < 0 ? 'red' : days < 30 ? 'amber' : 'green'
                const statusLabel = days < 0 ? 'Expired' : days < 30 ? 'Expiring' : 'Valid'
                return (
                  <tr
                    key={cert.id}
                    style={{ borderBottom: '1px solid var(--border)' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg2)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td style={{ padding: '10px 14px', color: 'var(--text1)', fontSize: '12px' }}>{cert.domain}</td>
                    <td style={{ padding: '10px 14px', color: 'var(--text2)', fontSize: '12px' }}>{cert.issuer}</td>
                    <td style={{ padding: '10px 14px', color: 'var(--text2)', fontSize: '12px' }}>
                      {new Date(cert.expiresAt).toLocaleDateString()}
                    </td>
                    <td style={{ padding: '10px 14px', color: 'var(--text2)', fontSize: '12px' }}>{days}d</td>
                    <td style={{ padding: '10px 14px' }}>
                      <Badge variant={statusVariant}>{statusLabel}</Badge>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <Button size="sm" variant="danger" onClick={() => removeCert(cert.id)}>Remove</Button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Upload cert modal */}
      <Modal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        title="Upload certificate"
        width={520}
        footer={
          <>
            <Button variant="ghost" size="md" onClick={() => setUploadOpen(false)}>Cancel</Button>
            <Button variant="primary" size="md" onClick={handleUpload}>Upload</Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text3)', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Domain
            </label>
            <input
              style={INPUT_STYLE}
              placeholder="example.com"
              value={certForm.domain}
              onChange={e => setCertForm(f => ({ ...f, domain: e.target.value }))}
            />
            {certErrors.domain && <div style={{ fontSize: '11px', color: 'var(--red)', marginTop: '3px' }}>{certErrors.domain}</div>}
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text3)', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Certificate PEM
            </label>
            <textarea
              style={{ ...INPUT_STYLE, height: '100px', resize: 'vertical', display: 'block' }}
              placeholder="-----BEGIN CERTIFICATE-----&#10;..."
              value={certForm.certPem}
              onChange={e => setCertForm(f => ({ ...f, certPem: e.target.value }))}
            />
            {certErrors.certPem && <div style={{ fontSize: '11px', color: 'var(--red)', marginTop: '3px' }}>{certErrors.certPem}</div>}
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text3)', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Private key PEM
            </label>
            <textarea
              style={{ ...INPUT_STYLE, height: '100px', resize: 'vertical', display: 'block' }}
              placeholder="-----BEGIN PRIVATE KEY-----&#10;..."
              value={certForm.keyPem}
              onChange={e => setCertForm(f => ({ ...f, keyPem: e.target.value }))}
            />
            {certErrors.keyPem && <div style={{ fontSize: '11px', color: 'var(--red)', marginTop: '3px' }}>{certErrors.keyPem}</div>}
          </div>
        </div>
      </Modal>
    </div>
  )
}
