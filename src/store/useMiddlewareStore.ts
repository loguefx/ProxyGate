import { create } from 'zustand'
import { db } from '../lib/db'
import { MiddlewareConfig } from '../lib/types'

interface MiddlewareStore {
  configs: MiddlewareConfig[]
  loading: boolean
  load: () => Promise<void>
  toggle: (id: string) => Promise<void>
  updateConfig: (id: string, config: Record<string, unknown>) => Promise<void>
}

export const useMiddlewareStore = create<MiddlewareStore>((set, get) => ({
  configs: [],
  loading: false,

  async load() {
    set({ loading: true })
    try {
      const rows = await db.query<{ id: string; enabled: number; config: string }>(
        'SELECT * FROM middleware_configs'
      )
      const configs: MiddlewareConfig[] = rows.map(r => ({
        id: r.id,
        enabled: r.enabled === 1,
        config: JSON.parse(r.config) as Record<string, unknown>,
      }))
      set({ configs })
    } finally {
      set({ loading: false })
    }
  },

  async toggle(id) {
    const prev = get().configs
    const current = prev.find(c => c.id === id)
    if (!current) return
    const next = !current.enabled
    set(s => ({
      configs: s.configs.map(c => c.id === id ? { ...c, enabled: next } : c),
    }))
    try {
      await db.execute('UPDATE middleware_configs SET enabled = ? WHERE id = ?', [next ? 1 : 0, id])
      const { regenerateConfig } = await import('../lib/configGen')
      await regenerateConfig()
    } catch (err) {
      set({ configs: prev })
      throw err
    }
  },

  async updateConfig(id, config) {
    const prev = get().configs
    set(s => ({
      configs: s.configs.map(c => c.id === id ? { ...c, config } : c),
    }))
    try {
      await db.execute('UPDATE middleware_configs SET config = ? WHERE id = ?', [JSON.stringify(config), id])
      const { regenerateConfig } = await import('../lib/configGen')
      await regenerateConfig()
    } catch (err) {
      set({ configs: prev })
      throw err
    }
  },
}))
