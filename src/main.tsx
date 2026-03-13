import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/globals.css'

// ─── Browser fallback ─────────────────────────────────────────────────────────
// ProxyGate requires the Tauri native window for IPC, SQLite, and proxy control.
// If someone opens localhost:1420 in a regular browser tab, show a helpful page.

function BrowserFallback() {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg0)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'Inter, system-ui, sans-serif',
      padding: '24px',
    }}>
      <div style={{ maxWidth: '480px', textAlign: 'center' }}>
        {/* Logo */}
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: '10px',
          marginBottom: '32px',
        }}>
          <div style={{
            width: '36px', height: '36px', borderRadius: '8px',
            background: 'var(--accent)', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            fontSize: '18px', fontWeight: 800, color: '#000',
          }}>PG</div>
          <span style={{ fontSize: '22px', fontWeight: 700, color: 'var(--text1)' }}>
            PROXY<span style={{ color: 'var(--accent)' }}>GATE</span>
          </span>
        </div>

        <h1 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text1)', marginBottom: '12px' }}>
          Open in the ProxyGate desktop app
        </h1>
        <p style={{ fontSize: '13px', color: 'var(--text2)', lineHeight: 1.65, marginBottom: '28px' }}>
          ProxyGate is a native desktop application and cannot run inside a browser tab.
          It uses Tauri to access the system network stack, SQLite for persistence, and
          a Rust HTTP proxy engine — none of which are available in a browser.
        </p>

        <div style={{
          background: 'var(--bg1)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)', padding: '20px', marginBottom: '24px',
          textAlign: 'left',
        }}>
          <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text3)', marginBottom: '12px' }}>
            How to open ProxyGate
          </div>
          {[
            { step: '1', text: 'Download the latest .msi installer from GitHub Releases' },
            { step: '2', text: 'Run the installer — ProxyGate appears in your Start Menu' },
            { step: '3', text: 'Launch ProxyGate from the Start Menu or desktop shortcut' },
          ].map(({ step, text }) => (
            <div key={step} style={{ display: 'flex', gap: '12px', marginBottom: '10px', alignItems: 'flex-start' }}>
              <div style={{
                width: '20px', height: '20px', borderRadius: '50%',
                background: 'var(--accent)', color: '#000',
                fontSize: '10px', fontWeight: 800, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{step}</div>
              <span style={{ fontSize: '12.5px', color: 'var(--text2)', lineHeight: 1.5 }}>{text}</span>
            </div>
          ))}
        </div>

        <a
          href="https://github.com/loguefx/ProxyGate/releases/latest"
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '8px',
            background: 'var(--accent)', color: '#000',
            padding: '10px 22px', borderRadius: 'var(--radius)',
            fontWeight: 700, fontSize: '13px', textDecoration: 'none',
            transition: 'opacity 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
          onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
        >
          ↓ Download latest release
        </a>

        <p style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '20px' }}>
          For developers: run{' '}
          <code style={{ background: 'var(--bg2)', padding: '2px 6px', borderRadius: '4px', fontFamily: 'monospace' }}>
            npm run tauri dev
          </code>{' '}
          — the native window opens automatically.
        </p>
      </div>
    </div>
  )
}

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {isTauri ? <App /> : <BrowserFallback />}
  </React.StrictMode>,
)
