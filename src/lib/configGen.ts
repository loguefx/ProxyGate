import { reloadProxy, writeConfig, ProxyConfigPayload } from './tauri'
import { useRouteStore } from '../store/useRouteStore'
import { useServiceGroupStore } from '../store/useServiceGroupStore'
import { useMiddlewareStore } from '../store/useMiddlewareStore'
import { useTLSStore } from '../store/useTLSStore'
import { useSettingsStore } from '../store/useSettingsStore'
import { CLOUDFLARE_IP_RANGES } from './cloudflareIPs'
import { Route, ServiceGroup, MiddlewareConfig, TLSConfig, AppSettings } from './types'

/**
 * Push the current store state into the ProxyGate proxy engine.
 * This is called on every mutation — always non-fatal so DB writes are
 * never rolled back due to a proxy reload failure.
 */
export async function regenerateConfig(): Promise<void> {
  try {
    const routes   = useRouteStore.getState().routes
    const groups   = useServiceGroupStore.getState().groups
    const settings = useSettingsStore.getState().settings

    const payload: ProxyConfigPayload = {
      httpPort: settings.httpPort,
      routes: routes
        .filter(r => r.enabled)
        .map(r => ({
          id: r.id,
          hostname: r.hostname,
          serviceGroupId: r.serviceGroupId,
          enabled: r.enabled,
          matchType: r.matchType,
          pathPrefix: r.pathPrefix,
          stripPathPrefix: r.stripPathPrefix,
        })),
      serviceGroups: groups.map(g => ({
        id: g.id,
        loadBalancer: g.loadBalancer,
        preset: g.preset,
        upstreams: g.upstreams.map(u => ({
          id: u.id,
          address: u.address,
          weight: u.weight,
          status: u.status,
        })),
      })),
    }

    await reloadProxy(payload)
  } catch (err) {
    console.error('Config regeneration failed (non-fatal):', err)
  }
}

/**
 * Export the current config as Traefik v3 YAML and write it to disk.
 * This is for users who want to run a separate Traefik instance.
 */
export async function exportTraefikConfig(): Promise<void> {
  try {
    const routes   = useRouteStore.getState().routes.filter(r => r.enabled)
    const groups   = useServiceGroupStore.getState().groups
    const mw       = useMiddlewareStore.getState().configs
    const tls      = useTLSStore.getState().config
    const settings = useSettingsStore.getState().settings
    const yaml     = buildTraefikV3YAML({ routes, groups, mw, tls, settings })
    await writeConfig(yaml, settings.configOutputPath)
  } catch (err) {
    console.error('Traefik config export failed:', err)
  }
}

interface BuildArgs {
  routes: Route[]
  groups: ServiceGroup[]
  mw: MiddlewareConfig[]
  tls: TLSConfig
  settings: AppSettings
}

function indent(str: string, spaces: number): string {
  const pad = ' '.repeat(spaces)
  return str.split('\n').map(line => (line ? pad + line : line)).join('\n')
}

function yamlStr(v: string): string {
  if (v.includes(':') || v.includes('#') || v.includes("'") || v.includes('"')) {
    return `"${v.replace(/"/g, '\\"')}"`
  }
  return v
}

export function buildTraefikV3YAML({ routes, groups, mw, tls, settings }: BuildArgs): string {
  const lines: string[] = []

  // ── Static config ──────────────────────────────────────────────────────────
  lines.push('# ProxyGate — Auto-generated Traefik v3 config')
  lines.push('# DO NOT EDIT — regenerated on every ProxyGate mutation')
  lines.push('')
  lines.push('entryPoints:')
  lines.push('  web:')
  lines.push(`    address: ":${settings.httpPort}"`)
  lines.push('  websecure:')
  lines.push(`    address: ":${settings.httpsPort}"`)
  lines.push('')

  if (settings.adminPort) {
    lines.push('api:')
    lines.push('  insecure: true')
    lines.push(`  # admin UI on port ${settings.adminPort}`)
    lines.push('')
  }

  if (tls.mode === 'acme' && tls.acmeEmail) {
    lines.push('certificatesResolvers:')
    lines.push('  letsencrypt:')
    lines.push('    acme:')
    lines.push(`      email: ${yamlStr(tls.acmeEmail)}`)
    lines.push('      storage: /etc/proxygate/acme.json')
    if (tls.acmeChallengeType === 'DNS-01') {
      lines.push('      dnsChallenge: {}')
    } else if (tls.acmeChallengeType === 'TLS-ALPN-01') {
      lines.push('      tlsChallenge: {}')
    } else {
      lines.push('      httpChallenge:')
      lines.push('        entryPoint: web')
    }
    lines.push('')
  }

  if (settings.cloudflareProxyEnabled) {
    lines.push('forwardedHeaders:')
    lines.push('  insecure: false')
    lines.push('  trustedIPs:')
    for (const ip of CLOUDFLARE_IP_RANGES) {
      lines.push(`    - "${ip}"`)
    }
    lines.push('')
  }

  lines.push(`log:`)
  lines.push(`  level: ${settings.logLevel}`)
  lines.push('')

  lines.push('providers:')
  lines.push('  file:')
  lines.push('    filename: /etc/proxygate/dynamic.yml')
  lines.push('    watch: true')
  lines.push('')

  // ── Dynamic config ─────────────────────────────────────────────────────────
  const dynLines: string[] = []
  dynLines.push('# ProxyGate — Dynamic config')
  dynLines.push('# DO NOT EDIT — auto-generated')
  dynLines.push('')
  dynLines.push('http:')

  // Routers
  dynLines.push('  routers:')
  for (const route of routes) {
    const routerId = `route-${route.id.slice(0, 8)}`
    let rule: string
    if (route.matchType === 'subdomain') {
      rule = `Host(\`${route.hostname}\`)`
    } else {
      const prefix = route.pathPrefix ?? '/'
      rule = `Host(\`${route.hostname}\`) && PathPrefix(\`${prefix}\`)`
    }

    const routerMw: string[] = [...route.middleware]
    if (route.matchType === 'path' && route.stripPathPrefix && route.pathPrefix) {
      routerMw.push(`strip-${routerId}`)
    }
    const httpsRedirect = mw.find(m => m.id === 'https-redirect')?.enabled
    if (httpsRedirect && route.tls !== 'none') {
      routerMw.push('https-redirect')
    }

    dynLines.push(`    ${routerId}:`)
    dynLines.push(`      rule: "${rule}"`)
    dynLines.push(`      service: svc-${route.serviceGroupId.slice(0, 8)}`)
    dynLines.push(`      entryPoints:`)
    if (route.tls !== 'none') {
      dynLines.push(`        - websecure`)
    } else {
      dynLines.push(`        - web`)
    }
    if (routerMw.length > 0) {
      dynLines.push(`      middlewares:`)
      for (const m of routerMw) {
        dynLines.push(`        - ${m}`)
      }
    }
    if (route.tls === 'acme') {
      dynLines.push(`      tls:`)
      dynLines.push(`        certResolver: letsencrypt`)
    } else if (route.tls === 'manual') {
      dynLines.push(`      tls: {}`)
    }
  }

  // HTTP redirect router
  const hasHttpsRedirect = mw.find(m => m.id === 'https-redirect')?.enabled
  if (hasHttpsRedirect) {
    dynLines.push(`    http-to-https:`)
    dynLines.push(`      rule: "HostRegexp(\`{host:.+}\`)"`)
    dynLines.push(`      entryPoints:`)
    dynLines.push(`        - web`)
    dynLines.push(`      middlewares:`)
    dynLines.push(`        - https-redirect`)
    dynLines.push(`      service: noop@internal`)
  }

  // Services
  dynLines.push('')
  dynLines.push('  services:')
  for (const group of groups) {
    const svcId = `svc-${group.id.slice(0, 8)}`
    const healthyUpstreams = group.upstreams.filter(u => u.status !== 'down')
    dynLines.push(`    ${svcId}:`)
    dynLines.push(`      loadBalancer:`)
    if (group.loadBalancer === 'weighted') {
      dynLines.push(`        weighted:`)
      dynLines.push(`          services:`)
      for (const u of healthyUpstreams) {
        dynLines.push(`            - name: svc-up-${u.id.slice(0, 8)}`)
        dynLines.push(`              weight: ${u.weight}`)
      }
    } else {
      dynLines.push(`        servers:`)
      for (const u of healthyUpstreams) {
        dynLines.push(`          - url: "http://${u.address}"`)
      }
    }
    dynLines.push(`        healthCheck:`)
    dynLines.push(`          path: ${group.healthCheckPath}`)
    dynLines.push(`          interval: ${group.healthCheckInterval}`)
    dynLines.push(`          timeout: ${group.healthCheckTimeout}`)
    if (group.passiveHealthCheck) {
      dynLines.push(`        passiveHealthCheck:`)
      dynLines.push(`          maxConnectionAttempts: 3`)
    }
  }

  // Middlewares
  const enabledMw = mw.filter(m => m.enabled)
  if (enabledMw.length > 0) {
    dynLines.push('')
    dynLines.push('  middlewares:')

    for (const m of enabledMw) {
      switch (m.id) {
        case 'https-redirect':
          dynLines.push(`    https-redirect:`)
          dynLines.push(`      redirectScheme:`)
          dynLines.push(`        scheme: https`)
          dynLines.push(`        permanent: true`)
          break
        case 'gzip':
          dynLines.push(`    gzip:`)
          dynLines.push(`      compress: {}`)
          break
        case 'rate-limit': {
          const cfg = m.config as { ratePerSecond?: number }
          dynLines.push(`    rate-limit:`)
          dynLines.push(`      rateLimit:`)
          dynLines.push(`        average: ${cfg.ratePerSecond ?? 100}`)
          dynLines.push(`        burst: ${(cfg.ratePerSecond ?? 100) * 2}`)
          break
        }
        case 'basic-auth': {
          const cfg = m.config as { users?: string[] }
          dynLines.push(`    basic-auth:`)
          dynLines.push(`      basicAuth:`)
          dynLines.push(`        users:`)
          for (const u of (cfg.users ?? [])) {
            dynLines.push(`          - "${u}"`)
          }
          break
        }
        case 'cors': {
          const cfg = m.config as { allowOrigins?: string[] }
          dynLines.push(`    cors:`)
          dynLines.push(`      headers:`)
          dynLines.push(`        accessControlAllowMethods:`)
          dynLines.push(`          - GET`)
          dynLines.push(`          - POST`)
          dynLines.push(`          - PUT`)
          dynLines.push(`          - DELETE`)
          dynLines.push(`          - OPTIONS`)
          dynLines.push(`        accessControlAllowOriginList:`)
          for (const o of (cfg.allowOrigins ?? ['*'])) {
            dynLines.push(`          - "${o}"`)
          }
          break
        }
        case 'ip-whitelist': {
          const cfg = m.config as { cidrs?: string[] }
          dynLines.push(`    ip-whitelist:`)
          dynLines.push(`      ipWhiteList:`)
          dynLines.push(`        sourceRange:`)
          for (const cidr of (cfg.cidrs ?? [])) {
            dynLines.push(`          - "${cidr}"`)
          }
          break
        }
        case 'custom-headers': {
          const cfg = m.config as { set?: Record<string, string>; remove?: string[] }
          dynLines.push(`    custom-headers:`)
          dynLines.push(`      headers:`)
          if (cfg.set && Object.keys(cfg.set).length > 0) {
            dynLines.push(`        customRequestHeaders:`)
            for (const [k, v] of Object.entries(cfg.set)) {
              dynLines.push(`          ${k}: "${v}"`)
            }
          }
          break
        }
      }
    }

    // Strip prefix middlewares for path routes
    for (const route of routes) {
      if (route.matchType === 'path' && route.stripPathPrefix && route.pathPrefix) {
        const routerId = `route-${route.id.slice(0, 8)}`
        dynLines.push(`    strip-${routerId}:`)
        dynLines.push(`      stripPrefix:`)
        dynLines.push(`        prefixes:`)
        dynLines.push(`          - "${route.pathPrefix}"`)
      }
    }
  }

  // TLS manual certs
  if (tls.mode === 'manual' && tls.certs.length > 0) {
    dynLines.push('')
    dynLines.push('tls:')
    dynLines.push('  certificates:')
    for (const cert of tls.certs) {
      dynLines.push(`    - certFile: ${cert.certPath}`)
      dynLines.push(`      keyFile: ${cert.keyPath}`)
    }
  }

  // Combine static + dynamic into a single output
  // (In production these would be two separate files; here we mark the split)
  const separator = '\n\n# ═══════════════ DYNAMIC CONFIG ═══════════════\n\n'
  return lines.join('\n') + separator + dynLines.join('\n') + '\n'
}

// Suppress unused warning — indent is available for future use
void indent
void yamlStr
