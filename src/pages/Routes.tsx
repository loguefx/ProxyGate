import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRouteStore } from '../store/useRouteStore'
import { useServiceGroupStore } from '../store/useServiceGroupStore'
import { useMiddlewareStore } from '../store/useMiddlewareStore'
import { useSettingsStore } from '../store/useSettingsStore'
import { Route } from '../lib/types'
import { validate } from '../lib/validation'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import Toggle from '../components/ui/Toggle'

type TabType = 'subdomain' | 'path'

interface RouteForm {
  tab: TabType
  hostname: string
  pathPrefix: string
  stripPathPrefix: boolean
  serviceGroupId: string
  tls: Route['tls']
  middleware: string[]
}

const EMPTY_FORM: RouteForm = {
  tab: 'subdomain',
  hostname: '',
  pathPrefix: '',
  stripPathPrefix: false,
  serviceGroupId: '',
  tls: 'acme',
  middleware: [],
}

function FormField({ label, error, children }: { label: string; error?: string | null; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '14px' }}>
      <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text3)', marginBottom: '5px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        {label}
      </label>
      {children}
      {error && <div style={{ fontSize: '11px', color: 'var(--red)', marginTop: '4px' }}>{error}</div>}
    </div>
  )
}

const INPUT_STYLE: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg2)',
  border: '1px solid var(--border2)',
  borderRadius: 'var(--radius)',
  padding: '8px 12px',
  fontSize: '12.5px',
  color: 'var(--text1)',
  outline: 'none',
}

const SELECT_STYLE: React.CSSProperties = { ...INPUT_STYLE }

export default function Routes() {
  const navigate = useNavigate()
  const routes = useRouteStore(s => s.routes)
  const addRoute = useRouteStore(s => s.add)
  const updateRoute = useRouteStore(s => s.update)
  const removeRoute = useRouteStore(s => s.remove)
  const toggleRoute = useRouteStore(s => s.toggle)
  const groups = useServiceGroupStore(s => s.groups)
  const middlewares = useMiddlewareStore(s => s.configs)
  const publicIp = useSettingsStore(s => s.settings.publicIp)

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<RouteForm>(EMPTY_FORM)
  const [errors, setErrors] = useState<Partial<Record<keyof RouteForm, string>>>({})

  function openAdd() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setErrors({})
    setModalOpen(true)
  }

  function openEdit(route: Route) {
    setEditingId(route.id)
    setForm({
      tab: route.matchType,
      hostname: route.hostname,
      pathPrefix: route.pathPrefix ?? '',
      stripPathPrefix: route.stripPathPrefix,
      serviceGroupId: route.serviceGroupId,
      tls: route.tls,
      middleware: route.middleware,
    })
    setErrors({})
    setModalOpen(true)
  }

  function validate_form(): boolean {
    const errs: Partial<Record<keyof RouteForm, string>> = {}
    if (form.tab === 'subdomain') {
      const he = validate.hostname(form.hostname)
      if (he) errs.hostname = he
    } else {
      const he = validate.hostname(form.hostname)
      if (he) errs.hostname = he
      const pe = validate.pathPrefix(form.pathPrefix)
      if (pe) errs.pathPrefix = pe
    }
    if (!form.serviceGroupId) errs.serviceGroupId = 'Service group is required'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function handleSubmit() {
    if (!validate_form()) return
    const routeData: Omit<Route, 'id' | 'createdAt'> = {
      matchType: form.tab,
      hostname: form.hostname.trim(),
      pathPrefix: form.tab === 'path' ? form.pathPrefix.trim() : undefined,
      stripPathPrefix: form.tab === 'path' ? form.stripPathPrefix : false,
      serviceGroupId: form.serviceGroupId,
      tls: form.tls,
      middleware: form.middleware,
      enabled: true,
    }
    if (editingId) {
      await updateRoute(editingId, routeData)
    } else {
      await addRoute(routeData)
    }
    setModalOpen(false)
  }

  function handleNewGroup() {
    setModalOpen(false)
    navigate('/services')
  }

  const stripPreview = form.tab === 'path' && form.stripPathPrefix && form.hostname && form.pathPrefix
    ? `${form.hostname}${form.pathPrefix}/example → backend receives GET /example`
    : null

  return (
    <div style={{ animation: 'fade-in 0.2s ease' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text1)' }}>Routes</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '3px' }}>
            Map hostnames &amp; paths → service groups
          </p>
        </div>
        <Button variant="primary" size="md" onClick={openAdd}>+ Add route</Button>
      </div>

      {/* Info banner */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '10px',
        background: 'var(--bg2)', border: '1px solid var(--border2)',
        borderRadius: 'var(--radius)', padding: '10px 14px', marginBottom: '16px',
      }}>
        <span style={{ color: 'var(--accent)', fontSize: '16px' }}>ⓘ</span>
        <span style={{ fontSize: '12px', color: 'var(--text2)', flex: 1 }}>
          Point all your domains to{' '}
          <span className="mono" style={{ color: 'var(--text1)' }}>{publicIp || '0.0.0.0'}</span>
          {' '}in Cloudflare DNS. ProxyGate routes by Host header — not by IP.
        </span>
        <Button size="sm" variant="ghost" onClick={() => navigate('/dns')}>DNS setup →</Button>
      </div>

      {/* Table */}
      <div style={{ background: 'var(--bg1)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Match', 'Type', '→ Service group', 'TLS', 'Middleware', 'Strip', 'Status', 'Actions'].map(h => (
                <th key={h} style={{
                  padding: '10px 14px', fontSize: '10px', fontWeight: 600,
                  textTransform: 'uppercase', letterSpacing: '0.08em',
                  color: 'var(--text3)', textAlign: 'left',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {routes.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: '32px', textAlign: 'center', color: 'var(--text3)', fontSize: '12px' }}>
                  No routes yet. Add your first route above.
                </td>
              </tr>
            ) : (
              routes.map(route => {
                const group = groups.find(g => g.id === route.serviceGroupId)
                return (
                  <tr
                    key={route.id}
                    style={{ borderBottom: '1px solid var(--border)', cursor: 'default' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg2)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td style={{ padding: '10px 14px' }}>
                      <span className="mono" style={{ color: 'var(--text1)' }}>
                        {route.hostname}{route.pathPrefix ?? ''}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <Badge variant={route.matchType === 'path' ? 'blue' : 'purple'}>
                        {route.matchType.toUpperCase()}
                      </Badge>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      {group ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: group.colour, flexShrink: 0 }} />
                          <span className="mono" style={{ color: 'var(--text2)' }}>{group.name}</span>
                        </div>
                      ) : (
                        <span style={{ color: 'var(--red)', fontSize: '11px' }}>deleted</span>
                      )}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      {route.tls === 'acme' && <Badge variant="green">HTTPS</Badge>}
                      {route.tls === 'none' && <Badge variant="amber">HTTP</Badge>}
                      {route.tls === 'redirect' && <Badge variant="blue">REDIRECT</Badge>}
                      {route.tls === 'manual' && <Badge variant="purple">MANUAL</Badge>}
                    </td>
                    <td style={{ padding: '10px 14px', color: 'var(--text3)', fontSize: '11px' }}>
                      {route.middleware.join(', ') || '—'}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <Badge variant={route.stripPathPrefix ? 'green' : 'gray'}>
                        {route.stripPathPrefix ? 'YES' : 'NO'}
                      </Badge>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <button
                        onClick={() => toggleRoute(route.id)}
                        title="Toggle route"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                      >
                        <Badge variant={route.enabled ? 'green' : 'gray'}>
                          {route.enabled ? 'ON' : 'OFF'}
                        </Badge>
                      </button>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <Button size="sm" variant="ghost" onClick={() => openEdit(route)}>Edit</Button>
                        <Button size="sm" variant="danger" onClick={() => removeRoute(route.id)}>Delete</Button>
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Add/Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? 'Edit route' : 'Add route'}
        width={520}
        footer={
          <>
            <Button variant="ghost" size="md" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button variant="primary" size="md" onClick={handleSubmit}>
              {editingId ? 'Save changes' : 'Create route'}
            </Button>
          </>
        }
      >
        {/* Tabs */}
        <div style={{ display: 'flex', gap: '2px', marginBottom: '18px', background: 'var(--bg2)', padding: '3px', borderRadius: 'var(--radius)' }}>
          {(['subdomain', 'path'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setForm(f => ({ ...f, tab }))}
              style={{
                flex: 1, padding: '6px', borderRadius: '6px', border: 'none',
                cursor: 'pointer', fontSize: '12px', fontWeight: 500,
                background: form.tab === tab ? 'var(--bg3)' : 'transparent',
                color: form.tab === tab ? 'var(--text1)' : 'var(--text3)',
                transition: 'all 0.15s',
              }}
            >
              {tab === 'subdomain' ? 'Subdomain' : 'Path prefix'}
            </button>
          ))}
        </div>

        <FormField label="Hostname" error={errors.hostname}>
          <input
            className="mono"
            style={INPUT_STYLE}
            placeholder={form.tab === 'subdomain' ? 'jellyfin.example.com' : 'example.com'}
            value={form.hostname}
            onChange={e => setForm(f => ({ ...f, hostname: e.target.value }))}
          />
        </FormField>

        {form.tab === 'path' && (
          <>
            <FormField label="Path prefix" error={errors.pathPrefix}>
              <input
                className="mono"
                style={INPUT_STYLE}
                placeholder="/api"
                value={form.pathPrefix}
                onChange={e => setForm(f => ({ ...f, pathPrefix: e.target.value }))}
              />
            </FormField>

            <div style={{ marginBottom: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text3)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                  Strip path prefix
                </label>
                <Toggle
                  checked={form.stripPathPrefix}
                  onChange={v => setForm(f => ({ ...f, stripPathPrefix: v }))}
                />
              </div>
              {stripPreview && (
                <div style={{
                  marginTop: '8px', background: 'var(--bg2)', border: '1px solid var(--border2)',
                  borderRadius: 'var(--radius)', padding: '8px 12px', fontSize: '12px',
                  color: 'var(--text2)', fontFamily: 'monospace',
                }}>
                  {stripPreview}
                </div>
              )}
            </div>
          </>
        )}

        <FormField label="Service group" error={errors.serviceGroupId}>
          <select
            style={SELECT_STYLE}
            value={form.serviceGroupId}
            onChange={e => {
              if (e.target.value === '__new__') {
                handleNewGroup()
              } else {
                setForm(f => ({ ...f, serviceGroupId: e.target.value }))
              }
            }}
          >
            <option value="">Select a service group…</option>
            {groups.map(g => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
            <option value="__new__">+ New group…</option>
          </select>
        </FormField>

        <FormField label="TLS mode">
          <select
            style={SELECT_STYLE}
            value={form.tls}
            onChange={e => setForm(f => ({ ...f, tls: e.target.value as Route['tls'] }))}
          >
            <option value="acme">HTTPS — Let's Encrypt (ACME)</option>
            <option value="manual">HTTPS — Manual certificate</option>
            <option value="redirect">HTTP → HTTPS redirect</option>
            <option value="none">HTTP only</option>
          </select>
        </FormField>

        {middlewares.length > 0 && (
          <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text3)', marginBottom: '8px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              Middleware
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {middlewares.map(mw => (
                <label key={mw.id} style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={form.middleware.includes(mw.id)}
                    onChange={e => {
                      setForm(f => ({
                        ...f,
                        middleware: e.target.checked
                          ? [...f.middleware, mw.id]
                          : f.middleware.filter(m => m !== mw.id),
                      }))
                    }}
                  />
                  <span style={{ fontSize: '12px', color: 'var(--text2)' }}>{mw.id}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
