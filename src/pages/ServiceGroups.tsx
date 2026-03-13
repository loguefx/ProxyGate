import { useState, useCallback } from 'react'
import { useServiceGroupStore } from '../store/useServiceGroupStore'
import { ServiceGroup, Upstream, PresetId } from '../lib/types'
import { validate } from '../lib/validation'
import UpstreamRow from '../components/ui/UpstreamRow'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Toggle from '../components/ui/Toggle'
import Modal from '../components/ui/Modal'

const INPUT_STYLE: React.CSSProperties = {
  background: 'var(--bg2)', border: '1px solid var(--border2)',
  borderRadius: 'var(--radius)', padding: '7px 10px',
  fontSize: '12.5px', color: 'var(--text1)', outline: 'none',
}

const COLOURS = ['#3dd68c', '#4d9eff', '#f97066', '#a78bfa', '#f5a623']

const LB_OPTIONS = [
  { value: 'round-robin', label: 'Round robin',       desc: 'Cycles through upstreams equally, one request at a time. Best default for most services.' },
  { value: 'least-conn',  label: 'Least connections', desc: 'Routes each request to the upstream with the fewest active connections. Good for long-lived or slow requests.' },
  { value: 'ip-hash',     label: 'IP hash',           desc: 'The same client IP always goes to the same upstream (sticky sessions). Useful for stateful apps that don\'t share session storage.' },
  { value: 'weighted',    label: 'Weighted',          desc: 'Distributes requests based on the weight set on each upstream. Higher weight = more traffic. Set weights per upstream in the Upstreams section.' },
]

interface PresetOption {
  id: PresetId
  label: string
  icon: string
  desc: string
  healthPath: string
  hcInterval: string
  timeout: string
}

const PRESET_OPTIONS: PresetOption[] = [
  {
    id: 'generic',
    label: 'Generic',
    icon: '⚙️',
    desc: 'Standard HTTP proxy. 5-minute request timeout.',
    healthPath: '/health',
    hcInterval: '30s',
    timeout: '5 min',
  },
  {
    id: 'jellyfin',
    label: 'Jellyfin',
    icon: '🎬',
    desc: 'Media streaming optimised. 6-hour timeout, response streaming, WebSocket support for real-time dashboard.',
    healthPath: '/health/alive',
    hcInterval: '60s',
    timeout: '6 hr',
  },
  {
    id: 'plex',
    label: 'Plex',
    icon: '🎬',
    desc: 'Media streaming optimised. 6-hour timeout, response streaming, WebSocket support.',
    healthPath: '/identity',
    hcInterval: '60s',
    timeout: '6 hr',
  },
  {
    id: 'api',
    label: 'API',
    icon: '⚡',
    desc: 'REST APIs, webhooks, microservices. 30-second timeout — fail fast on stuck requests.',
    healthPath: '/health',
    hcInterval: '30s',
    timeout: '30 s',
  },
  {
    id: 'static',
    label: 'Static / CDN',
    icon: '📁',
    desc: 'Static files, images, assets. 5-minute timeout with response streaming for large files.',
    healthPath: '/',
    hcInterval: '60s',
    timeout: '5 min',
  },
]

const PRESET_BADGE_COLOUR: Record<PresetId, string> = {
  generic: 'gray',
  jellyfin: 'blue',
  plex: 'blue',
  api: 'amber',
  static: 'green',
}

interface UpstreamDraft {
  address: string
  weight: number
}

function debounce<T extends (...args: Parameters<T>) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout>
  return ((...args: Parameters<T>) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }) as T
}

function GroupCard({ group }: { group: ServiceGroup }) {
  const updateGroup = useServiceGroupStore(s => s.update)
  const removeGroup = useServiceGroupStore(s => s.remove)
  const addUpstream = useServiceGroupStore(s => s.addUpstream)
  const removeUpstream = useServiceGroupStore(s => s.removeUpstream)

  const [expanded, setExpanded] = useState(false)
  const [draft, setDraft] = useState<UpstreamDraft>({ address: '', weight: 1 })
  const [draftErr, setDraftErr] = useState<string | null>(null)

  const downCount = group.upstreams.filter(u => u.status === 'down').length
  const upCount = group.upstreams.filter(u => u.status === 'up').length
  const presetBadge = PRESET_BADGE_COLOUR[group.preset] ?? 'gray'

  const debouncedUpdate = useCallback(
    debounce((patch: Partial<Omit<ServiceGroup, 'id' | 'upstreams' | 'createdAt'>>) => {
      updateGroup(group.id, patch)
    }, 500),
    [group.id, updateGroup]
  )

  async function handleAddUpstream() {
    const err = validate.upstreamAddress(draft.address)
    if (err) { setDraftErr(err); return }
    setDraftErr(null)
    const upstreamData: Omit<Upstream, 'id' | 'serviceGroupId' | 'createdAt'> = {
      address: draft.address.trim(),
      weight: draft.weight,
      status: 'unknown',
    }
    await addUpstream(group.id, upstreamData)
    setDraft({ address: '', weight: 1 })
  }

  return (
    <div style={{
      background: 'var(--bg1)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: '10px',
    }}>
      {/* Collapsed header */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '12px 16px', cursor: 'pointer',
          transition: 'background 0.12s',
        }}
        onMouseEnter={e => !expanded && (e.currentTarget.style.background = 'var(--bg2)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: group.colour, flexShrink: 0 }} />
        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text1)', flex: 1 }}>
          {group.name}
        </span>
        <Badge variant={downCount > 0 ? 'amber' : 'green'}>
          {upCount}/{group.upstreams.length} up
        </Badge>
        <Badge variant={presetBadge as 'blue' | 'amber' | 'green' | 'gray'}>
          {PRESET_OPTIONS.find(p => p.id === group.preset)?.icon} {group.preset}
        </Badge>
        <Badge variant="blue">{group.loadBalancer}</Badge>
        <Badge variant="gray">{group.upstreams.length} upstreams</Badge>
        <span style={{ color: 'var(--text3)', fontSize: '12px', marginLeft: '4px' }}>
          {expanded ? '▼' : '▶'}
        </span>
      </div>

      {expanded && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          {/* Upstreams section */}
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text3)', marginBottom: '8px' }}>
              Upstreams
            </div>
            {group.upstreams.length === 0 ? (
              <div style={{ color: 'var(--text3)', fontSize: '12px', padding: '4px 0 8px' }}>No upstreams yet.</div>
            ) : (
              group.upstreams.map(u => (
                <UpstreamRow
                  key={u.id}
                  upstream={u}
                  onRemove={() => removeUpstream(u.id)}
                />
              ))
            )}
            <div style={{ display: 'flex', gap: '8px', marginTop: '10px', alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <input
                  className="mono"
                  style={{ ...INPUT_STYLE, width: '100%' }}
                  placeholder="192.168.1.10:8096"
                  value={draft.address}
                  onChange={e => { setDraft(d => ({ ...d, address: e.target.value })); setDraftErr(null) }}
                  onKeyDown={e => e.key === 'Enter' && handleAddUpstream()}
                />
                {draftErr && <div style={{ fontSize: '11px', color: 'var(--red)', marginTop: '3px' }}>{draftErr}</div>}
              </div>
              <select
                style={{ ...INPUT_STYLE, width: '80px' }}
                value={draft.weight}
                onChange={e => setDraft(d => ({ ...d, weight: parseInt(e.target.value, 10) }))}
              >
                {[1,2,3,4,5,6,7,8,9,10].map(w => <option key={w} value={w}>{w}</option>)}
              </select>
              <Button size="sm" variant="ghost" onClick={handleAddUpstream}>+ Add upstream</Button>
            </div>
          </div>

          {/* Settings section */}
          <div style={{ padding: '12px 16px' }}>
            <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text3)', marginBottom: '10px' }}>
              Settings
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '10px', color: 'var(--text3)', marginBottom: '4px' }}>Preset</label>
                <select
                  style={{ ...INPUT_STYLE, width: '140px' }}
                  defaultValue={group.preset}
                  onChange={e => debouncedUpdate({ preset: e.target.value as PresetId })}
                >
                  {PRESET_OPTIONS.map(o => (
                    <option key={o.id} value={o.id}>{o.icon} {o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '10px', color: 'var(--text3)', marginBottom: '4px' }}>Load balancer</label>
                <select
                  style={{ ...INPUT_STYLE, width: '160px' }}
                  defaultValue={group.loadBalancer}
                  onChange={e => debouncedUpdate({ loadBalancer: e.target.value as ServiceGroup['loadBalancer'] })}
                >
                  {LB_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '4px', maxWidth: '200px', lineHeight: 1.3 }}>
                  {LB_OPTIONS.find(o => o.value === group.loadBalancer)?.desc}
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '10px', color: 'var(--text3)', marginBottom: '4px' }}>Health check path</label>
                <input
                  className="mono"
                  style={{ ...INPUT_STYLE, width: '140px' }}
                  defaultValue={group.healthCheckPath}
                  onChange={e => debouncedUpdate({ healthCheckPath: e.target.value })}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '10px', color: 'var(--text3)', marginBottom: '4px' }}>Interval</label>
                <input
                  className="mono"
                  style={{ ...INPUT_STYLE, width: '80px' }}
                  defaultValue={group.healthCheckInterval}
                  onChange={e => debouncedUpdate({ healthCheckInterval: e.target.value })}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '10px', color: 'var(--text3)', marginBottom: '4px' }}>Timeout</label>
                <input
                  className="mono"
                  style={{ ...INPUT_STYLE, width: '80px' }}
                  defaultValue={group.healthCheckTimeout}
                  onChange={e => debouncedUpdate({ healthCheckTimeout: e.target.value })}
                />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text2)' }}>Passive health check</span>
              <Toggle
                checked={group.passiveHealthCheck}
                onChange={v => updateGroup(group.id, { passiveHealthCheck: v })}
              />
            </div>
          </div>

          {/* Delete group */}
          <div style={{ padding: '8px 16px 12px', display: 'flex', justifyContent: 'flex-end' }}>
            <Button size="sm" variant="danger" onClick={() => removeGroup(group.id)}>
              Delete group
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

interface NewGroupForm {
  name: string
  preset: PresetId
  loadBalancer: ServiceGroup['loadBalancer']
  colour: string
  healthCheckPath: string
  healthCheckInterval: string
  upstreams: UpstreamDraft[]
}

export default function ServiceGroups() {
  const groups = useServiceGroupStore(s => s.groups)
  const addGroup = useServiceGroupStore(s => s.add)

  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<NewGroupForm>({
    name: '',
    preset: 'generic',
    loadBalancer: 'round-robin',
    colour: COLOURS[0],
    healthCheckPath: '/health',
    healthCheckInterval: '30s',
    upstreams: [{ address: '', weight: 1 }],
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function applyPreset(id: PresetId) {
    const p = PRESET_OPTIONS.find(o => o.id === id)
    if (!p) return
    setForm(f => ({
      ...f,
      preset: id,
      healthCheckPath: p.healthPath,
      healthCheckInterval: p.hcInterval,
    }))
  }

  function validate_form(): boolean {
    const errs: Record<string, string> = {}
    if (!form.name.trim()) errs.name = 'Name is required'
    else if (!/^[a-zA-Z0-9-]+$/.test(form.name.trim())) errs.name = 'Only letters, numbers, hyphens'
    else if (groups.some(g => g.name === form.name.trim())) errs.name = 'Name already taken'
    form.upstreams.forEach((u, i) => {
      if (!u.address.trim()) return
      const e = validate.upstreamAddress(u.address)
      if (e) errs[`upstream_${i}`] = e
    })
    const filledUpstreams = form.upstreams.filter(u => u.address.trim())
    if (filledUpstreams.length === 0) errs['upstream_0'] = 'At least one upstream address is required'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function handleCreate() {
    setSubmitError(null)
    if (!validate_form()) return
    setSubmitting(true)
    try {
      await addGroup(
        {
          name: form.name.trim(),
          preset: form.preset,
          colour: form.colour,
          loadBalancer: form.loadBalancer,
          healthCheckPath: form.healthCheckPath,
          healthCheckInterval: form.healthCheckInterval,
          healthCheckTimeout: '5s',
          passiveHealthCheck: true,
        },
        form.upstreams
          .filter(u => u.address.trim())
          .map(u => ({ address: u.address.trim(), weight: u.weight, status: 'unknown' as const }))
      )
      setModalOpen(false)
      setForm({
        name: '', preset: 'generic', loadBalancer: 'round-robin', colour: COLOURS[0],
        healthCheckPath: '/health', healthCheckInterval: '30s',
        upstreams: [{ address: '', weight: 1 }],
      })
      setErrors({})
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const selectedPreset = PRESET_OPTIONS.find(p => p.id === form.preset)

  return (
    <div style={{ animation: 'fade-in 0.2s ease' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text1)' }}>Service groups</h1>
          <p style={{ fontSize: '12px', color: 'var(--text3)', marginTop: '3px' }}>
            Named pools of backend upstreams with automatic health checking
          </p>
        </div>
        <Button variant="primary" size="md" onClick={() => setModalOpen(true)}>+ New service group</Button>
      </div>

      {groups.length === 0 ? (
        <div style={{
          background: 'var(--bg1)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)', padding: '40px',
          textAlign: 'center', color: 'var(--text3)', fontSize: '13px',
        }}>
          No service groups yet. Create one to start routing traffic.
        </div>
      ) : (
        groups.map(group => <GroupCard key={group.id} group={group} />)
      )}

      {/* New group modal */}
      <Modal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setSubmitError(null); setErrors({}) }}
        title="New service group"
        width={560}
        footer={
          <>
            <Button variant="ghost" size="md" onClick={() => setModalOpen(false)} disabled={submitting}>Cancel</Button>
            <Button variant="primary" size="md" onClick={handleCreate} disabled={submitting}>
              {submitting ? 'Creating…' : 'Create group'}
            </Button>
          </>
        }
      >
        {submitError && (
          <div style={{
            background: 'var(--red-dim)', border: '1px solid rgba(240,82,82,0.2)',
            borderRadius: 'var(--radius)', padding: '10px 12px',
            fontSize: '12px', color: 'var(--red)', marginBottom: '14px',
          }}>
            {submitError}
          </div>
        )}

        {/* Preset picker */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text3)', marginBottom: '8px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            App type
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '6px' }}>
            {PRESET_OPTIONS.map(p => (
              <button
                key={p.id}
                onClick={() => applyPreset(p.id)}
                style={{
                  padding: '8px 4px',
                  background: form.preset === p.id ? 'var(--accent-dim, rgba(77,158,255,0.12))' : 'var(--bg2)',
                  border: form.preset === p.id ? '1.5px solid var(--accent)' : '1.5px solid var(--border2)',
                  borderRadius: 'var(--radius)',
                  cursor: 'pointer',
                  textAlign: 'center',
                  transition: 'border-color 0.12s, background 0.12s',
                }}
              >
                <div style={{ fontSize: '18px', lineHeight: 1 }}>{p.icon}</div>
                <div style={{ fontSize: '10px', fontWeight: 600, color: form.preset === p.id ? 'var(--accent)' : 'var(--text2)', marginTop: '4px' }}>
                  {p.label}
                </div>
              </button>
            ))}
          </div>
          {selectedPreset && (
            <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '6px', lineHeight: 1.45 }}>
              {selectedPreset.desc}
              {(selectedPreset.id === 'jellyfin' || selectedPreset.id === 'plex') && (
                <span style={{ color: 'var(--accent)', marginLeft: '4px' }}>
                  · WebSocket enabled
                </span>
              )}
            </div>
          )}
        </div>

        <div style={{ marginBottom: '14px' }}>
          <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text3)', marginBottom: '5px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            Group name
          </label>
          <input
            style={{ ...INPUT_STYLE, width: '100%' }}
            placeholder="jellyfin"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          />
          {errors.name && <div style={{ fontSize: '11px', color: 'var(--red)', marginTop: '4px' }}>{errors.name}</div>}
        </div>

        <div style={{ marginBottom: '14px' }}>
          <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text3)', marginBottom: '5px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            Load balancer
          </label>
          <select
            style={{ ...INPUT_STYLE, width: '100%' }}
            value={form.loadBalancer}
            onChange={e => setForm(f => ({ ...f, loadBalancer: e.target.value as ServiceGroup['loadBalancer'] }))}
          >
            {LB_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <div style={{ fontSize: '11px', color: 'var(--text3)', marginTop: '5px', lineHeight: 1.4 }}>
            {LB_OPTIONS.find(o => o.value === form.loadBalancer)?.desc}
          </div>
        </div>

        <div style={{ marginBottom: '14px' }}>
          <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text3)', marginBottom: '8px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            Colour
          </label>
          <div style={{ display: 'flex', gap: '8px' }}>
            {COLOURS.map(c => (
              <button
                key={c}
                onClick={() => setForm(f => ({ ...f, colour: c }))}
                style={{
                  width: '24px', height: '24px', borderRadius: '50%', background: c,
                  border: form.colour === c ? `3px solid var(--text1)` : '3px solid transparent',
                  cursor: 'pointer', padding: 0, transition: 'border-color 0.15s',
                  outline: form.colour === c ? `2px solid ${c}` : 'none',
                }}
              />
            ))}
          </div>
        </div>

        <div style={{ marginBottom: '14px' }}>
          <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text3)', marginBottom: '8px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            Upstreams
          </label>
          {form.upstreams.map((u, i) => (
            <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '6px', alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <input
                  className="mono"
                  style={{ ...INPUT_STYLE, width: '100%' }}
                  placeholder="192.168.1.10:8096"
                  value={u.address}
                  onChange={e => setForm(f => {
                    const upstreams = [...f.upstreams]
                    upstreams[i] = { ...upstreams[i], address: e.target.value }
                    return { ...f, upstreams }
                  })}
                />
                {errors[`upstream_${i}`] && (
                  <div style={{ fontSize: '11px', color: 'var(--red)', marginTop: '3px' }}>{errors[`upstream_${i}`]}</div>
                )}
              </div>
              <select
                style={{ ...INPUT_STYLE, width: '70px' }}
                value={u.weight}
                onChange={e => setForm(f => {
                  const upstreams = [...f.upstreams]
                  upstreams[i] = { ...upstreams[i], weight: parseInt(e.target.value, 10) }
                  return { ...f, upstreams }
                })}
              >
                {[1,2,3,4,5,6,7,8,9,10].map(w => <option key={w} value={w}>{w}</option>)}
              </select>
              {form.upstreams.length > 1 && (
                <Button size="sm" variant="danger" onClick={() => setForm(f => ({ ...f, upstreams: f.upstreams.filter((_, j) => j !== i) }))}>
                  ✕
                </Button>
              )}
            </div>
          ))}
          <button
            onClick={() => setForm(f => ({ ...f, upstreams: [...f.upstreams, { address: '', weight: 1 }] }))}
            style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '12px', padding: '4px 0' }}
          >
            + Add another upstream
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text3)', marginBottom: '5px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              Health check path
            </label>
            <input
              className="mono"
              style={{ ...INPUT_STYLE, width: '100%' }}
              value={form.healthCheckPath}
              onChange={e => setForm(f => ({ ...f, healthCheckPath: e.target.value }))}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text3)', marginBottom: '5px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              Interval
            </label>
            <input
              className="mono"
              style={{ ...INPUT_STYLE, width: '100%' }}
              value={form.healthCheckInterval}
              onChange={e => setForm(f => ({ ...f, healthCheckInterval: e.target.value }))}
            />
          </div>
        </div>
      </Modal>
    </div>
  )
}
