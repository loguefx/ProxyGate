import { create } from 'zustand'
import { db } from '../lib/db'
import { checkUpstreamHealth } from '../lib/tauri'
import { ServiceGroup, Upstream } from '../lib/types'

interface ServiceGroupStore {
  groups: ServiceGroup[]
  loading: boolean
  load: () => Promise<void>
  add: (group: Omit<ServiceGroup, 'id' | 'createdAt' | 'upstreams'>, upstreams: Omit<Upstream, 'id' | 'serviceGroupId' | 'createdAt'>[]) => Promise<void>
  update: (id: string, patch: Partial<Omit<ServiceGroup, 'id' | 'upstreams' | 'createdAt'>>) => Promise<void>
  remove: (id: string) => Promise<void>
  addUpstream: (groupId: string, upstream: Omit<Upstream, 'id' | 'serviceGroupId' | 'createdAt'>) => Promise<void>
  removeUpstream: (upstreamId: string) => Promise<void>
  refreshHealth: () => Promise<void>
}

function genId(): string {
  return crypto.randomUUID()
}

export const useServiceGroupStore = create<ServiceGroupStore>((set, get) => ({
  groups: [],
  loading: false,

  async load() {
    set({ loading: true })
    try {
      const groupRows = await db.query<{
        id: string; name: string; colour: string; load_balancer: string;
        preset: string | null;
        health_check_path: string; health_check_interval: string;
        health_check_timeout: string; passive_health_check: number; created_at: string
      }>('SELECT * FROM service_groups ORDER BY created_at ASC')

      const upstreamRows = await db.query<{
        id: string; service_group_id: string; address: string; weight: number;
        status: string; latency_ms: number | null; last_checked: string | null; created_at: string
      }>('SELECT * FROM upstreams ORDER BY created_at ASC')

      const groups: ServiceGroup[] = groupRows.map(g => ({
        id: g.id,
        name: g.name,
        colour: g.colour,
        preset: (g.preset ?? 'generic') as ServiceGroup['preset'],
        loadBalancer: g.load_balancer as ServiceGroup['loadBalancer'],
        healthCheckPath: g.health_check_path,
        healthCheckInterval: g.health_check_interval,
        healthCheckTimeout: g.health_check_timeout,
        passiveHealthCheck: g.passive_health_check === 1,
        createdAt: g.created_at,
        upstreams: upstreamRows
          .filter(u => u.service_group_id === g.id)
          .map(u => ({
            id: u.id,
            serviceGroupId: u.service_group_id,
            address: u.address,
            weight: u.weight,
            status: u.status as Upstream['status'],
            latencyMs: u.latency_ms ?? undefined,
            lastChecked: u.last_checked ?? undefined,
            createdAt: u.created_at,
          })),
      }))

      set({ groups })
    } finally {
      set({ loading: false })
    }
  },

  async add(group, upstreams) {
    const id = genId()
    const now = new Date().toISOString()
    const newGroup: ServiceGroup = {
      id, ...group, upstreams: [], createdAt: now,
    }
    set(s => ({ groups: [...s.groups, newGroup] }))
    try {
      await db.execute(
        `INSERT INTO service_groups (id,name,colour,preset,load_balancer,health_check_path,health_check_interval,health_check_timeout,passive_health_check,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [id, group.name, group.colour, group.preset ?? 'generic', group.loadBalancer,
         group.healthCheckPath, group.healthCheckInterval, group.healthCheckTimeout,
         group.passiveHealthCheck ? 1 : 0, now]
      )
      // Inline upstream inserts — avoids calling regenerateConfig N times
      for (const u of upstreams) {
        const uid = genId()
        const newUpstream: Upstream = {
          id: uid, serviceGroupId: id, createdAt: now,
          address: u.address, weight: u.weight,
          status: u.status ?? 'unknown',
        }
        set(s => ({
          groups: s.groups.map(g =>
            g.id === id ? { ...g, upstreams: [...g.upstreams, newUpstream] } : g
          ),
        }))
        await db.execute(
          `INSERT INTO upstreams (id,service_group_id,address,weight,status,created_at) VALUES (?,?,?,?,?,?)`,
          [uid, id, u.address, u.weight, 'unknown', now]
        )
      }
    } catch (err) {
      set(s => ({ groups: s.groups.filter(g => g.id !== id) }))
      throw err
    }
    // Config regeneration is always non-fatal; never rolls back saved data
    const { regenerateConfig } = await import('../lib/configGen')
    await regenerateConfig()
  },

  async update(id, patch) {
    const prev = get().groups.find(g => g.id === id)
    if (!prev) return
    set(s => ({
      groups: s.groups.map(g => g.id === id ? { ...g, ...patch } : g),
    }))
    try {
      const fields: string[] = []
      const vals: unknown[] = []
      if (patch.loadBalancer !== undefined) { fields.push('load_balancer = ?'); vals.push(patch.loadBalancer) }
      if (patch.healthCheckPath !== undefined) { fields.push('health_check_path = ?'); vals.push(patch.healthCheckPath) }
      if (patch.healthCheckInterval !== undefined) { fields.push('health_check_interval = ?'); vals.push(patch.healthCheckInterval) }
      if (patch.healthCheckTimeout !== undefined) { fields.push('health_check_timeout = ?'); vals.push(patch.healthCheckTimeout) }
      if (patch.passiveHealthCheck !== undefined) { fields.push('passive_health_check = ?'); vals.push(patch.passiveHealthCheck ? 1 : 0) }
      if (patch.name !== undefined) { fields.push('name = ?'); vals.push(patch.name) }
      if (patch.colour !== undefined) { fields.push('colour = ?'); vals.push(patch.colour) }
      if (patch.preset !== undefined) { fields.push('preset = ?'); vals.push(patch.preset) }
      if (fields.length > 0) {
        vals.push(id)
        await db.execute(`UPDATE service_groups SET ${fields.join(', ')} WHERE id = ?`, vals)
      }
      const { regenerateConfig } = await import('../lib/configGen')
      await regenerateConfig()
    } catch (err) {
      set(s => ({ groups: s.groups.map(g => g.id === id ? prev : g) }))
      throw err
    }
  },

  async remove(id) {
    const prev = get().groups
    set(s => ({ groups: s.groups.filter(g => g.id !== id) }))
    try {
      await db.execute('DELETE FROM service_groups WHERE id = ?', [id])
      const { regenerateConfig } = await import('../lib/configGen')
      await regenerateConfig()
    } catch (err) {
      set({ groups: prev })
      throw err
    }
  },

  async addUpstream(groupId, upstream) {
    const id = genId()
    const now = new Date().toISOString()
    const newUpstream: Upstream = {
      id,
      serviceGroupId: groupId,
      createdAt: now,
      address: upstream.address,
      weight: upstream.weight,
      status: upstream.status ?? 'unknown',
      latencyMs: upstream.latencyMs,
      lastChecked: upstream.lastChecked,
    }
    set(s => ({
      groups: s.groups.map(g =>
        g.id === groupId ? { ...g, upstreams: [...g.upstreams, newUpstream] } : g
      ),
    }))
    try {
      await db.execute(
        `INSERT INTO upstreams (id,service_group_id,address,weight,status,created_at)
         VALUES (?,?,?,?,?,?)`,
        [id, groupId, upstream.address, upstream.weight, 'unknown', now]
      )
      const { regenerateConfig } = await import('../lib/configGen')
      await regenerateConfig()
    } catch (err) {
      set(s => ({
        groups: s.groups.map(g =>
          g.id === groupId ? { ...g, upstreams: g.upstreams.filter(u => u.id !== id) } : g
        ),
      }))
      throw err
    }
  },

  async removeUpstream(upstreamId) {
    const prev = get().groups
    set(s => ({
      groups: s.groups.map(g => ({
        ...g, upstreams: g.upstreams.filter(u => u.id !== upstreamId),
      })),
    }))
    try {
      await db.execute('DELETE FROM upstreams WHERE id = ?', [upstreamId])
      const { regenerateConfig } = await import('../lib/configGen')
      await regenerateConfig()
    } catch (err) {
      set({ groups: prev })
      throw err
    }
  },

  async refreshHealth() {
    const groups = get().groups
    for (const group of groups) {
      for (const upstream of group.upstreams) {
        try {
          const latencyMs = await checkUpstreamHealth(upstream.address)
          const now = new Date().toISOString()
          set(s => ({
            groups: s.groups.map(g =>
              g.id === group.id
                ? {
                    ...g,
                    upstreams: g.upstreams.map(u =>
                      u.id === upstream.id
                        ? { ...u, status: 'up' as const, latencyMs, lastChecked: now }
                        : u
                    ),
                  }
                : g
            ),
          }))
          await db.execute(
            'UPDATE upstreams SET status = ?, latency_ms = ?, last_checked = ? WHERE id = ?',
            ['up', latencyMs, now, upstream.id]
          )
        } catch {
          const now = new Date().toISOString()
          set(s => ({
            groups: s.groups.map(g =>
              g.id === group.id
                ? {
                    ...g,
                    upstreams: g.upstreams.map(u =>
                      u.id === upstream.id
                        ? { ...u, status: 'down' as const, lastChecked: now }
                        : u
                    ),
                  }
                : g
            ),
          }))
          await db.execute(
            'UPDATE upstreams SET status = ?, last_checked = ? WHERE id = ?',
            ['down', now, upstream.id]
          )
        }
      }
    }
  },
}))

// Health check every 30 seconds
setInterval(() => {
  useServiceGroupStore.getState().refreshHealth()
}, 30_000)
