import { create } from 'zustand'
import { db } from '../lib/db'
import { TLSConfig, CertEntry } from '../lib/types'

interface TLSStore {
  config: TLSConfig
  loading: boolean
  load: () => Promise<void>
  save: (patch: Partial<Omit<TLSConfig, 'certs'>>) => Promise<void>
  addCert: (cert: Omit<CertEntry, 'id'>) => Promise<void>
  removeCert: (id: string) => Promise<void>
}

const DEFAULT_CONFIG: TLSConfig = {
  mode: 'acme',
  acmeEmail: '',
  acmeChallengeType: 'HTTP-01',
  certs: [],
}

export const useTLSStore = create<TLSStore>((set, get) => ({
  config: { ...DEFAULT_CONFIG },
  loading: false,

  async load() {
    set({ loading: true })
    try {
      const rows = await db.query<{
        id: number; mode: string; acme_email: string | null;
        acme_challenge_type: string | null; certs: string
      }>('SELECT * FROM tls_config WHERE id = 1')

      if (rows.length > 0) {
        const r = rows[0]
        set({
          config: {
            mode: r.mode as TLSConfig['mode'],
            acmeEmail: r.acme_email ?? '',
            acmeChallengeType: (r.acme_challenge_type ?? 'HTTP-01') as TLSConfig['acmeChallengeType'],
            certs: JSON.parse(r.certs) as CertEntry[],
          },
        })
      } else {
        await db.execute(
          `INSERT OR IGNORE INTO tls_config (id, mode, acme_challenge_type, certs) VALUES (1, 'acme', 'HTTP-01', '[]')`
        )
      }
    } finally {
      set({ loading: false })
    }
  },

  async save(patch) {
    const prev = get().config
    const next = { ...prev, ...patch }
    set({ config: next })
    try {
      await db.execute(
        'UPDATE tls_config SET mode = ?, acme_email = ?, acme_challenge_type = ? WHERE id = 1',
        [next.mode, next.acmeEmail ?? null, next.acmeChallengeType ?? 'HTTP-01']
      )
      const { regenerateConfig } = await import('../lib/configGen')
      await regenerateConfig()
    } catch (err) {
      set({ config: prev })
      throw err
    }
  },

  async addCert(cert) {
    const id = crypto.randomUUID()
    const newCert: CertEntry = { id, ...cert }
    const prev = get().config
    const next = { ...prev, certs: [...prev.certs, newCert] }
    set({ config: next })
    try {
      await db.execute(
        'UPDATE tls_config SET certs = ? WHERE id = 1',
        [JSON.stringify(next.certs)]
      )
      const { regenerateConfig } = await import('../lib/configGen')
      await regenerateConfig()
    } catch (err) {
      set({ config: prev })
      throw err
    }
  },

  async removeCert(id) {
    const prev = get().config
    const next = { ...prev, certs: prev.certs.filter(c => c.id !== id) }
    set({ config: next })
    try {
      await db.execute('UPDATE tls_config SET certs = ? WHERE id = 1', [JSON.stringify(next.certs)])
      const { regenerateConfig } = await import('../lib/configGen')
      await regenerateConfig()
    } catch (err) {
      set({ config: prev })
      throw err
    }
  },
}))
