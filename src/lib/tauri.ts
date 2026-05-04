import { invoke as tauriInvoke } from '@tauri-apps/api/core'

// ─── Proxy config payload sent to Rust on every config change ─────────────────

export interface ProxyConfigPayload {
  httpPort: number
  httpsPort: number
  tlsEnabled: boolean
  routes: Array<{
    id: string
    hostname: string
    serviceGroupId: string
    enabled: boolean
    matchType: string
    pathPrefix?: string
    stripPathPrefix: boolean
    tls: string
  }>
  serviceGroups: Array<{
    id: string
    loadBalancer: string
    preset: string
    upstreams: Array<{
      id: string
      address: string
      weight: number
      status: string
    }>
  }>
  /** Manual certs to pre-load into the SNI resolver */
  manualCerts: Array<{
    domain: string
    certPath: string
    keyPath: string
  }>
}

export interface ProxyStatus {
  running: boolean
  port: number
  error: string | null
}

export interface LogLine {
  timestamp: string
  status: number
  method: string
  host: string
  path: string
  latencyMs: number
}

export interface CertInfo {
  domain: string
  issuer: string
  expiresAt: string
  daysRemaining: number
  status: 'valid' | 'expiring' | 'expired'
}

export async function reloadProxy(config: ProxyConfigPayload): Promise<void> {
  return tauriInvoke<void>('reload_proxy', { config })
}

export async function getProxyStatus(): Promise<ProxyStatus> {
  return tauriInvoke<ProxyStatus>('get_proxy_status')
}

export async function checkUpstreamHealth(address: string): Promise<number> {
  return tauriInvoke<number>('check_upstream_health', { address })
}

export async function startLogTail(): Promise<void> {
  return tauriInvoke<void>('start_log_tail')
}

export async function getConfigPath(): Promise<string> {
  return tauriInvoke<string>('get_config_path')
}

export async function writeConfig(yaml: string, path: string): Promise<void> {
  return tauriInvoke<void>('write_config', { yaml, path })
}

// ─── TLS / cert commands ──────────────────────────────────────────────────────

export async function writeManualCert(
  domain: string,
  certPem: string,
  keyPem: string,
): Promise<[string, string]> {
  return tauriInvoke<[string, string]>('write_manual_cert', { domain, certPem, keyPem })
}

export async function provisionAcmeCert(
  domain: string,
  email: string,
): Promise<CertInfo> {
  return tauriInvoke<CertInfo>('provision_acme_cert', { domain, email })
}

export async function getCertInfo(domain: string): Promise<CertInfo | null> {
  return tauriInvoke<CertInfo | null>('get_cert_info', { domain })
}

export async function removeCert(domain: string): Promise<void> {
  return tauriInvoke<void>('remove_cert', { domain })
}

export async function reloadTls(): Promise<void> {
  return tauriInvoke<void>('reload_tls')
}

export async function getCertDir(): Promise<string> {
  return tauriInvoke<string>('get_cert_dir')
}

export { tauriInvoke as invoke }
