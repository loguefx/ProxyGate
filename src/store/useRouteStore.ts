import { create } from 'zustand'
import { db } from '../lib/db'
import { Route } from '../lib/types'

interface RouteStore {
  routes: Route[]
  loading: boolean
  load: () => Promise<void>
  add: (route: Omit<Route, 'id' | 'createdAt'>) => Promise<void>
  update: (id: string, patch: Partial<Omit<Route, 'id' | 'createdAt'>>) => Promise<void>
  remove: (id: string) => Promise<void>
  toggle: (id: string) => Promise<void>
}

function genId(): string {
  return crypto.randomUUID()
}

export const useRouteStore = create<RouteStore>((set, get) => ({
  routes: [],
  loading: false,

  async load() {
    set({ loading: true })
    try {
      const rows = await db.query<{
        id: string; match_type: string; hostname: string; path_prefix: string | null;
        strip_path: number; service_group_id: string; tls: string;
        middleware: string; enabled: number; created_at: string
      }>('SELECT * FROM routes ORDER BY created_at ASC')

      const routes: Route[] = rows.map(r => ({
        id: r.id,
        matchType: r.match_type as Route['matchType'],
        hostname: r.hostname,
        pathPrefix: r.path_prefix ?? undefined,
        stripPathPrefix: r.strip_path === 1,
        serviceGroupId: r.service_group_id,
        tls: r.tls as Route['tls'],
        middleware: JSON.parse(r.middleware) as string[],
        enabled: r.enabled === 1,
        createdAt: r.created_at,
      }))

      set({ routes })
    } finally {
      set({ loading: false })
    }
  },

  async add(route) {
    const id = genId()
    const now = new Date().toISOString()
    const newRoute: Route = { id, createdAt: now, ...route }
    set(s => ({ routes: [...s.routes, newRoute] }))
    try {
      await db.execute(
        `INSERT INTO routes (id,match_type,hostname,path_prefix,strip_path,service_group_id,tls,middleware,enabled,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [id, route.matchType, route.hostname, route.pathPrefix ?? null,
         route.stripPathPrefix ? 1 : 0, route.serviceGroupId, route.tls,
         JSON.stringify(route.middleware), route.enabled ? 1 : 0, now]
      )
      const { regenerateConfig } = await import('../lib/configGen')
      await regenerateConfig()
    } catch (err) {
      set(s => ({ routes: s.routes.filter(r => r.id !== id) }))
      throw err
    }
  },

  async update(id, patch) {
    const prev = get().routes.find(r => r.id === id)
    if (!prev) return
    set(s => ({
      routes: s.routes.map(r => r.id === id ? { ...r, ...patch } : r),
    }))
    try {
      const fields: string[] = []
      const vals: unknown[] = []
      if (patch.matchType !== undefined) { fields.push('match_type = ?'); vals.push(patch.matchType) }
      if (patch.hostname !== undefined) { fields.push('hostname = ?'); vals.push(patch.hostname) }
      if (patch.pathPrefix !== undefined) { fields.push('path_prefix = ?'); vals.push(patch.pathPrefix) }
      if (patch.stripPathPrefix !== undefined) { fields.push('strip_path = ?'); vals.push(patch.stripPathPrefix ? 1 : 0) }
      if (patch.serviceGroupId !== undefined) { fields.push('service_group_id = ?'); vals.push(patch.serviceGroupId) }
      if (patch.tls !== undefined) { fields.push('tls = ?'); vals.push(patch.tls) }
      if (patch.middleware !== undefined) { fields.push('middleware = ?'); vals.push(JSON.stringify(patch.middleware)) }
      if (patch.enabled !== undefined) { fields.push('enabled = ?'); vals.push(patch.enabled ? 1 : 0) }
      if (fields.length > 0) {
        vals.push(id)
        await db.execute(`UPDATE routes SET ${fields.join(', ')} WHERE id = ?`, vals)
      }
      const { regenerateConfig } = await import('../lib/configGen')
      await regenerateConfig()
    } catch (err) {
      set(s => ({ routes: s.routes.map(r => r.id === id ? prev : r) }))
      throw err
    }
  },

  async remove(id) {
    const prev = get().routes
    set(s => ({ routes: s.routes.filter(r => r.id !== id) }))
    try {
      await db.execute('DELETE FROM routes WHERE id = ?', [id])
      const { regenerateConfig } = await import('../lib/configGen')
      await regenerateConfig()
    } catch (err) {
      set({ routes: prev })
      throw err
    }
  },

  async toggle(id) {
    const route = get().routes.find(r => r.id === id)
    if (!route) return
    await get().update(id, { enabled: !route.enabled })
  },
}))
