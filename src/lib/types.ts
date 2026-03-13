export interface Route {
  id: string
  matchType: 'subdomain' | 'path'
  hostname: string
  pathPrefix?: string
  stripPathPrefix: boolean
  serviceGroupId: string
  tls: 'acme' | 'manual' | 'none' | 'redirect'
  middleware: string[]
  enabled: boolean
  createdAt: string
}

export type PresetId = 'generic' | 'jellyfin' | 'plex' | 'api' | 'static'

export interface ServiceGroup {
  id: string
  name: string
  colour: string
  preset: PresetId
  loadBalancer: 'round-robin' | 'least-conn' | 'ip-hash' | 'weighted'
  healthCheckPath: string
  healthCheckInterval: string
  healthCheckTimeout: string
  passiveHealthCheck: boolean
  upstreams: Upstream[]
  createdAt: string
}

export interface Upstream {
  id: string
  serviceGroupId: string
  address: string
  weight: number
  status: 'up' | 'down' | 'unknown'
  latencyMs?: number
  lastChecked?: string
  createdAt: string
}

export interface MiddlewareConfig {
  id: string
  enabled: boolean
  config: Record<string, unknown>
}

export interface TLSConfig {
  mode: 'acme' | 'manual'
  acmeEmail?: string
  acmeChallengeType?: 'HTTP-01' | 'DNS-01' | 'TLS-ALPN-01'
  certs: CertEntry[]
}

export interface CertEntry {
  id: string
  domain: string
  certPath: string
  keyPath: string
  issuer: string
  expiresAt: string
  status: 'valid' | 'expiring' | 'expired'
}

export interface AppSettings {
  publicIp: string
  httpPort: number
  httpsPort: number
  adminPort: number
  logLevel: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
  configOutputPath: string
  cloudflareProxyEnabled: boolean
  haEnabled: boolean
  haRole: 'primary' | 'secondary'
  haVip: string
  haPeerIp: string
  haInterface: string
}
