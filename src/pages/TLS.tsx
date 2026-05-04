import { useState, useEffect } from 'react'
import { listen } from '@tauri-apps/api/event'
import { useTLSStore } from '../store/useTLSStore'
import { CertEntry } from '../lib/types'
import {
  writeManualCert,
  provisionAcmeCert,
  getCertInfo,
  getCertDir,
  CertInfo,
} from '../lib/tauri'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'

const INPUT_STYLE: React.CSSProperties = {
  width: '100%', background: 'var(--bg2)', border: '1px solid var(--border2)',
  borderRadius: 'var(--radius)', padding: '8px 12px',
  fontSize: '12.5px', color: 'var(--text1)', outline: 'none',
}

const LABEL_STYLE: React.CSSProperties = {
  display: 'block', fontSize: '11px', fontWeight: 600,
  color: 'var(--text3)', marginBottom: '5px',
  textTransform: 'uppercase', letterSpacing: '0.04em',
}

// ACME progress event payload
interface AcmeProgressEvent {
  domain: string
  step: string
  message: string
}

function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000)
}

export default function TLS() {
  const config = useTLSStore(s => s.config)
  const saveConfig = useTLSStore(s => s.save)
  const addCert = useTLSStore(s => s.addCert)
  const removeCert = useTLSStore(s => s.removeCert)

  const [certDir, setCertDir] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [certForm, setCertForm] = useState({ domain: '', certPem: '', keyPem: '', issuer: '' })
  const [certErrors, setCertErrors] = useState<Record<string, string>>({})
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')

  const [acmeOpen, setAcmeOpen] = useState(false)
  const [acmeDomain, setAcmeDomain] = useState('')
  const [acmeLog, setAcmeLog] = useState<string[]>([])
  const [acmeRunning, setAcmeRunning] = useState(false)
  const [acmeError, setAcmeError] = useState('')

  // Load cert dir path and refresh real cert info for existing certs
  useEffect(() => {
    getCertDir().then(setCertDir).catch(() => {})
  }, [])

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
    setUploading(true)
    setUploadError('')
    try {
      const domain = certForm.domain.trim()

      // Write PEM files to disk via Rust and load into SNI resolver
      const [certPath, keyPath] = await writeManualCert(domain, certForm.certPem, certForm.keyPem)

      // Fetch real cert info (expiry, issuer) from the loaded cert
      const info: CertInfo | null = await getCertInfo(domain)

      const cert: Omit<CertEntry, 'id'> = {
        domain,
        certPath,
        keyPath,
        issuer: info?.issuer ?? certForm.issuer.trim() || 'Manual',
        expiresAt: info?.expiresAt ?? new Date(Date.now() + 365 * 86_400_000).toISOString(),
        status: (info?.status as CertEntry['status']) ?? 'valid',
      }
      await addCert(cert)
      setUploadOpen(false)
      setCertForm({ domain: '', certPem: '', keyPem: '', issuer: '' })
    } catch (err) {
      setUploadError(String(err))
    } finally {
      setUploading(false)
    }
  }

  async function handleProvisionAcme() {
    const domain = acmeDomain.trim()
    if (!domain) return
    const email = config.acmeEmail?.trim()
    if (!email) {
      setAcmeError('Set your email address in ACME settings first.')
      return
    }

    setAcmeRunning(true)
    setAcmeError('')
    setAcmeLog([])

    // Listen for progress events from Rust
    const unlisten = await listen<AcmeProgressEvent>('acme-progress', event => {
      if (event.payload.domain === domain) {
        setAcmeLog(prev => [...prev, event.payload.message])
      }
    })

    try {
      const info = await provisionAcmeCert(domain, email)

      // Persist the cert entry in the DB
      await addCert({
        domain: info.domain,
        certPath: `${certDir}/${domain.replace(/\*/g, 'wildcard')}.crt`,
        keyPath: `${certDir}/${domain.replace(/\*/g, 'wildcard')}.key`,
        issuer: info.issuer,
        expiresAt: info.expiresAt,
        status: info.status as CertEntry['status'],
      })

      setAcmeLog(prev => [...prev, `✓ Certificate for ${domain} is active!`])
    } catch (err) {
      setAcmeError(String(err))
    } finally {
      unlisten()
      setAcmeRunning(false)
    }
  }

  async function handleRefreshCert(cert: CertEntry) {
    try {
      const info = await getCertInfo(cert.domain)
      if (info) {
        // Update the cert entry with fresh real expiry / status
        await removeCert(cert.id)
        await addCert({
          domain: cert.domain,
          certPath: cert.certPath,
          keyPath: cert.keyPath,
          issuer: info.issuer,
          expiresAt: info.expiresAt,
          status: info.status as CertEntry['status'],
        })
      }
    } catch {
      // Non-fatal — cert might not be loaded yet
    }
  }

  return (
    <div style={{ animation: 'fade-in 0.2s ease' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text1)' }}>TLS / SSL</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '3px' }}>
            Certificate management and TLS termination — no Traefik required
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button variant="ghost" size="md" onClick={() => { setAcmeDomain(''); setAcmeLog([]); setAcmeError(''); setAcmeOpen(true) }}>
            ⚡ Let's Encrypt
          </Button>
          <Button variant="ghost" size="md" onClick={() => setUploadOpen(true)}>+ Upload cert</Button>
        </div>
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
                  ? "Auto-issue and renew via Let's Encrypt. Requires port 80 reachable from internet."
                  : 'Upload your own PEM certificate and key per domain.'}
              </div>
            </div>
          )
        })}
      </div>

      {/* ACME settings */}
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
              <label style={LABEL_STYLE}>Email address</label>
              <input
                style={INPUT_STYLE}
                type="email"
                placeholder="admin@example.com"
                value={config.acmeEmail ?? ''}
                onChange={e => saveConfig({ acmeEmail: e.target.value })}
              />
            </div>
            <div>
              <label style={LABEL_STYLE}>Challenge type</label>
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
          {certDir && (
            <div style={{ marginTop: '12px', fontSize: '11px', color: 'var(--text3)' }}>
              Cert storage: <code style={{ color: 'var(--text2)' }}>{certDir}</code>
            </div>
          )}
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
                    ? 'Click "Let\'s Encrypt" to provision a certificate for any of your domains.'
                    : 'No certificates uploaded yet. Click "+ Upload cert".'}
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
                    <td style={{ padding: '10px 14px', color: 'var(--text1)', fontSize: '12px', fontWeight: 500 }}>{cert.domain}</td>
                    <td style={{ padding: '10px 14px', color: 'var(--text2)', fontSize: '12px' }}>{cert.issuer}</td>
                    <td style={{ padding: '10px 14px', color: 'var(--text2)', fontSize: '12px' }}>
                      {new Date(cert.expiresAt).toLocaleDateString()}
                    </td>
                    <td style={{ padding: '10px 14px', color: 'var(--text2)', fontSize: '12px' }}>{days}d</td>
                    <td style={{ padding: '10px 14px' }}>
                      <Badge variant={statusVariant}>{statusLabel}</Badge>
                    </td>
                    <td style={{ padding: '10px 14px', display: 'flex', gap: '6px' }}>
                      <Button size="sm" variant="ghost" onClick={() => handleRefreshCert(cert)}>Refresh</Button>
                      <Button size="sm" variant="danger" onClick={() => removeCert(cert.id)}>Remove</Button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Upload manual cert modal */}
      <Modal
        open={uploadOpen}
        onClose={() => { setUploadOpen(false); setUploadError('') }}
        title="Upload certificate"
        width={520}
        footer={
          <>
            <Button variant="ghost" size="md" onClick={() => { setUploadOpen(false); setUploadError('') }}>Cancel</Button>
            <Button variant="primary" size="md" onClick={handleUpload} disabled={uploading}>
              {uploading ? 'Uploading…' : 'Upload'}
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {uploadError && (
            <div style={{ background: 'var(--red-dim, #2d1010)', border: '1px solid var(--red)', borderRadius: 'var(--radius)', padding: '10px 12px', fontSize: '12px', color: 'var(--red)' }}>
              {uploadError}
            </div>
          )}
          <div>
            <label style={LABEL_STYLE}>Domain</label>
            <input
              style={INPUT_STYLE}
              placeholder="example.com"
              value={certForm.domain}
              onChange={e => setCertForm(f => ({ ...f, domain: e.target.value }))}
            />
            {certErrors.domain && <div style={{ fontSize: '11px', color: 'var(--red)', marginTop: '3px' }}>{certErrors.domain}</div>}
          </div>
          <div>
            <label style={LABEL_STYLE}>Certificate PEM</label>
            <textarea
              style={{ ...INPUT_STYLE, height: '100px', resize: 'vertical', display: 'block' }}
              placeholder={'-----BEGIN CERTIFICATE-----\n...'}
              value={certForm.certPem}
              onChange={e => setCertForm(f => ({ ...f, certPem: e.target.value }))}
            />
            {certErrors.certPem && <div style={{ fontSize: '11px', color: 'var(--red)', marginTop: '3px' }}>{certErrors.certPem}</div>}
          </div>
          <div>
            <label style={LABEL_STYLE}>Private key PEM</label>
            <textarea
              style={{ ...INPUT_STYLE, height: '100px', resize: 'vertical', display: 'block' }}
              placeholder={'-----BEGIN PRIVATE KEY-----\n...'}
              value={certForm.keyPem}
              onChange={e => setCertForm(f => ({ ...f, keyPem: e.target.value }))}
            />
            {certErrors.keyPem && <div style={{ fontSize: '11px', color: 'var(--red)', marginTop: '3px' }}>{certErrors.keyPem}</div>}
          </div>
        </div>
      </Modal>

      {/* ACME provisioning modal */}
      <Modal
        open={acmeOpen}
        onClose={() => { if (!acmeRunning) { setAcmeOpen(false); setAcmeError('') } }}
        title="Provision Let's Encrypt certificate"
        width={500}
        footer={
          <>
            <Button variant="ghost" size="md" onClick={() => { setAcmeOpen(false); setAcmeError('') }} disabled={acmeRunning}>
              {acmeRunning ? 'Running…' : 'Close'}
            </Button>
            {!acmeRunning && acmeLog.length === 0 && (
              <Button variant="primary" size="md" onClick={handleProvisionAcme}>
                Provision
              </Button>
            )}
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={LABEL_STYLE}>Domain to provision</label>
            <input
              style={INPUT_STYLE}
              placeholder="example.com"
              value={acmeDomain}
              onChange={e => setAcmeDomain(e.target.value)}
              disabled={acmeRunning}
            />
            <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '5px' }}>
              Port 80 must be publicly reachable from the internet for HTTP-01 validation.
            </div>
          </div>

          {acmeError && (
            <div style={{ background: 'var(--red-dim, #2d1010)', border: '1px solid var(--red)', borderRadius: 'var(--radius)', padding: '10px 12px', fontSize: '12px', color: 'var(--red)' }}>
              {acmeError}
            </div>
          )}

          {acmeLog.length > 0 && (
            <div style={{
              background: 'var(--bg2)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', padding: '12px',
              fontFamily: 'monospace', fontSize: '11.5px',
              maxHeight: '180px', overflowY: 'auto',
              display: 'flex', flexDirection: 'column', gap: '4px',
            }}>
              {acmeLog.map((line, i) => (
                <div key={i} style={{ color: line.startsWith('✓') ? 'var(--green, #3dd68c)' : 'var(--text2)' }}>
                  {line}
                </div>
              ))}
              {acmeRunning && (
                <div style={{ color: 'var(--accent, #818cf8)' }}>…</div>
              )}
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}
