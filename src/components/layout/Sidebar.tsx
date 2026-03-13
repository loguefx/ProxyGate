import { useNavigate, useLocation } from 'react-router-dom'
import { useRouteStore } from '../../store/useRouteStore'
import { useServiceGroupStore } from '../../store/useServiceGroupStore'

interface NavItem {
  icon: string
  label: string
  path: string
  badge?: number
}

interface NavSection {
  title: string
  items: NavItem[]
}

export default function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const routes = useRouteStore(s => s.routes)
  const groups = useServiceGroupStore(s => s.groups)

  const sections: NavSection[] = [
    {
      title: 'MAIN',
      items: [
        { icon: '⊞', label: 'Dashboard', path: '/' },
        { icon: '⇄', label: 'Routes', path: '/routes', badge: routes.length },
        { icon: '◉', label: 'Service groups', path: '/services', badge: groups.length },
      ],
    },
    {
      title: 'CONFIG',
      items: [
        { icon: '⊙', label: 'DNS / Cloudflare', path: '/dns' },
        { icon: '⊕', label: 'Middleware', path: '/middleware' },
        { icon: '🔒', label: 'TLS / SSL', path: '/tls' },
      ],
    },
    {
      title: 'OBSERVE',
      items: [
        { icon: '≡', label: 'Live logs', path: '/logs' },
        { icon: '⚙', label: 'Settings', path: '/settings' },
      ],
    },
  ]

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/'
    return location.pathname.startsWith(path)
  }

  return (
    <nav style={{ padding: '14px 0', overflowY: 'auto', flex: 1 }}>
      {sections.map((section, si) => (
        <div key={section.title}>
          {si > 0 && (
            <div style={{
              height: '1px',
              background: 'var(--border)',
              margin: '8px 14px',
            }} />
          )}
          <div style={{
            fontSize: '10px',
            fontWeight: 600,
            letterSpacing: '0.08em',
            color: 'var(--text3)',
            padding: '6px 18px 4px',
          }}>
            {section.title}
          </div>
          {section.items.map(item => {
            const active = isActive(item.path)
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '9px',
                  padding: '8px 18px',
                  background: active ? 'var(--bg2)' : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: active ? 'var(--text1)' : 'var(--text2)',
                  fontSize: '13px',
                  fontWeight: active ? 500 : 400,
                  textAlign: 'left',
                  position: 'relative',
                  transition: 'background 0.12s, color 0.12s',
                }}
                onMouseEnter={e => {
                  if (!active) {
                    e.currentTarget.style.background = 'var(--bg2)'
                    e.currentTarget.style.color = 'var(--text1)'
                  }
                }}
                onMouseLeave={e => {
                  if (!active) {
                    e.currentTarget.style.background = 'transparent'
                    e.currentTarget.style.color = 'var(--text2)'
                  }
                }}
              >
                {active && (
                  <span style={{
                    position: 'absolute',
                    left: 0,
                    top: '4px',
                    bottom: '4px',
                    width: '3px',
                    background: 'var(--accent)',
                    borderRadius: '0 2px 2px 0',
                  }} />
                )}
                <span style={{ fontSize: '14px', width: '16px', textAlign: 'center', flexShrink: 0 }}>
                  {item.icon}
                </span>
                <span style={{ flex: 1 }}>{item.label}</span>
                {item.badge !== undefined && item.badge > 0 && (
                  <span style={{
                    background: 'var(--bg4)',
                    color: 'var(--text2)',
                    fontSize: '10px',
                    fontWeight: 600,
                    padding: '1px 6px',
                    borderRadius: '10px',
                    marginLeft: 'auto',
                  }}>
                    {item.badge}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      ))}
    </nav>
  )
}
