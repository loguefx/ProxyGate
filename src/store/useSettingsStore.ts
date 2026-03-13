import { create } from 'zustand'
import { db } from '../lib/db'
import { AppSettings } from '../lib/types'

interface SettingsStore {
  settings: AppSettings
  loading: boolean
  load: () => Promise<void>
  save: (patch: Partial<AppSettings>) => Promise<void>
}

const DEFAULTS: AppSettings = {
  publicIp: '',
  httpPort: 8080,
  httpsPort: 443,
  adminPort: 8080,
  logLevel: 'INFO',
  configOutputPath: '/etc/proxygate/traefik.yml',
  cloudflareProxyEnabled: false,
  haEnabled: false,
  haRole: 'primary',
  haVip: '',
  haPeerIp: '',
  haInterface: 'eth0',
}

const KEY_MAP: Record<string, keyof AppSettings> = {
  public_ip:   'publicIp',
  http_port:   'httpPort',
  https_port:  'httpsPort',
  admin_port:  'adminPort',
  log_level:   'logLevel',
  config_path: 'configOutputPath',
  cf_proxy:    'cloudflareProxyEnabled',
  ha_enabled:  'haEnabled',
  ha_role:     'haRole',
  ha_vip:      'haVip',
  ha_peer_ip:  'haPeerIp',
  ha_interface:'haInterface',
}

const REVERSE_MAP = Object.fromEntries(
  Object.entries(KEY_MAP).map(([k, v]) => [v, k])
) as Record<keyof AppSettings, string>

function parseValue(key: keyof AppSettings, raw: string): AppSettings[typeof key] {
  if (key === 'httpPort' || key === 'httpsPort' || key === 'adminPort') return parseInt(raw, 10) as AppSettings[typeof key]
  if (key === 'cloudflareProxyEnabled' || key === 'haEnabled') return (raw === 'true') as AppSettings[typeof key]
  return raw as AppSettings[typeof key]
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: { ...DEFAULTS },
  loading: false,

  async load() {
    set({ loading: true })
    try {
      const rows = await db.query<{ key: string; value: string }>(
        'SELECT key, value FROM app_settings'
      )
      const settings = { ...DEFAULTS }
      for (const row of rows) {
        const prop = KEY_MAP[row.key]
        if (prop) {
          (settings as Record<string, unknown>)[prop] = parseValue(prop, row.value)
        }
      }
      set({ settings })
    } finally {
      set({ loading: false })
    }
  },

  async save(patch) {
    const prev = get().settings
    const next = { ...prev, ...patch }
    set({ settings: next })
    try {
      for (const [prop, val] of Object.entries(patch)) {
        const key = REVERSE_MAP[prop as keyof AppSettings]
        if (key) {
          await db.execute(
            'INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)',
            [key, String(val)]
          )
        }
      }
      const { regenerateConfig } = await import('../lib/configGen')
      await regenerateConfig()
    } catch (err) {
      set({ settings: prev })
      throw err
    }
  },
}))
