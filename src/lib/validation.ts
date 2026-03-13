const HOSTNAME_RE = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/
const WILDCARD_HOSTNAME_RE = /^(\*\.)?(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/
const UPSTREAM_RE = /^(\d{1,3}\.){3}\d{1,3}:\d{1,5}$|^[a-zA-Z0-9.-]+:\d{1,5}$/
const CIDR_RE = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/
const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/
const INTERVAL_RE = /^\d+[smh]$/

export const validate = {
  hostname(v: string): string | null {
    if (!v.trim()) return 'Hostname is required'
    if (!HOSTNAME_RE.test(v.trim())) return 'Invalid hostname (e.g. jellyfin.example.com)'
    return null
  },

  wildcardHostname(v: string): string | null {
    if (!v.trim()) return 'Hostname is required'
    if (!WILDCARD_HOSTNAME_RE.test(v.trim())) return 'Invalid hostname'
    return null
  },

  upstreamAddress(v: string): string | null {
    if (!v.trim()) return 'Address is required'
    if (!UPSTREAM_RE.test(v.trim())) return 'Format: 192.168.1.10:8096'
    const parts = v.split(':')
    const port = parseInt(parts[parts.length - 1], 10)
    if (port < 1 || port > 65535) return 'Port must be 1–65535'
    return null
  },

  port(v: string | number): string | null {
    const n = typeof v === 'string' ? parseInt(v, 10) : v
    if (isNaN(n) || n < 1 || n > 65535) return 'Port must be 1–65535'
    return null
  },

  pathPrefix(v: string): string | null {
    if (!v.trim()) return 'Path prefix is required'
    if (!v.startsWith('/')) return 'Path prefix must start with /'
    if (v.includes('*')) return 'Path prefix cannot contain wildcards'
    return null
  },

  cidr(v: string): string | null {
    if (!CIDR_RE.test(v.trim())) return 'Format: 192.168.1.0/24'
    const [ip, bits] = v.split('/')
    const octets = ip.split('.').map(Number)
    if (octets.some(o => o > 255)) return 'Invalid IP address'
    if (parseInt(bits, 10) > 32) return 'Prefix length must be 0–32'
    return null
  },

  ipv4(v: string): string | null {
    if (!IPV4_RE.test(v.trim())) return 'Invalid IPv4 address'
    const octets = v.split('.').map(Number)
    if (octets.some(o => o > 255)) return 'All octets must be 0–255'
    return null
  },

  email(v: string): string | null {
    if (!v.trim()) return 'Email is required'
    if (!v.includes('@') || !v.includes('.')) return 'Invalid email address'
    return null
  },

  interval(v: string): string | null {
    if (!INTERVAL_RE.test(v.trim())) return 'Format: 30s, 5m, or 1h'
    return null
  },
}
