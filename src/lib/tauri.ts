import { invoke as tauriInvoke } from '@tauri-apps/api/core'

// ─── Proxy config payload sent to Rust on every config change ─────────────────

export interface ProxyConfigPayload {
  httpPort: number
  routes: Array<{
    id: string
    hostname: string
    serviceGroupId: string
    enabled: boolean
    matchType: string
    pathPrefix?: string
    stripPathPrefix: boolean
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

export { tauriInvoke as invoke }
