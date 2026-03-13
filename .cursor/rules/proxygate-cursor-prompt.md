# ProxyGate — Cursor Scaffold Prompt

Copy this entire prompt into Cursor's composer after creating a new Tauri + React project.
The .mdc file (proxygate.mdc) should already be placed in .cursor/rules/ before you start.

---

## CONTEXT — Read this first

You are building ProxyGate: a cross-platform desktop reverse-proxy manager for Windows and Linux.
It looks and feels like a professional dark-mode network tool — think Portainer or Nginx Proxy Manager
but cleaner and desktop-native.

### The core concept you must understand before writing any code

ProxyGate has ONE public IP (e.g. 203.0.113.10). Every domain the user wants to proxy points
to this single IP in Cloudflare DNS. ProxyGate reads the Host header on every incoming request
and routes it to the correct service group. This means:

- jellyfin.example.com A record → 203.0.113.10
- plex.example.com     A record → 203.0.113.10

Both point to the SAME IP. No conflict. When a request arrives, ProxyGate reads:
  Host: jellyfin.example.com  →  routes to jellyfin service group (192.168.1.10:8096, 192.168.1.11:8096)
  Host: plex.example.com      →  routes to plex service group    (192.168.2.10:32400, 192.168.2.11:32400)

A "service group" is a named pool of backend IP:port pairs. The group has NO public IP.
It lives entirely on private/internal addresses. ProxyGate health-checks every upstream in the
group every 30 seconds. If one goes down, traffic automatically shifts to the remaining
healthy upstreams — the domain stays up.

The user never sees a config file. Every form they fill in gets translated to Traefik v3 YAML
automatically. The YAML path is shown read-only in Settings as a reference, never for editing.

---

## STEP 1 — Bootstrap the project

```bash
npm create tauri-app@latest proxygate -- --template react-ts
cd proxygate
npm install zustand @tauri-apps/plugin-sql react-router-dom
cargo add tauri-plugin-sql --features sqlite
```

Update src-tauri/tauri.conf.json window settings:
```json
{
  "app": {
    "windows": [{
      "title": "ProxyGate",
      "width": 1140,
      "height": 740,
      "minWidth": 960,
      "minHeight": 640,
      "resizable": true,
      "center": true
    }]
  }
}
```

---

## STEP 2 — CSS custom properties (src/styles/globals.css)

Create this file exactly. All component colours derive from these variables.

```css
:root {
  --bg0: #0d0f12;
  --bg1: #13161b;
  --bg2: #1a1e25;
  --bg3: #22272f;
  --bg4: #2a3040;
  --border:  #2a3040;
  --border2: #333c4a;
  --text1: #e8eaf0;
  --text2: #8b93a8;
  --text3: #555e70;
  --accent:      #3dd68c;
  --accent-dim:  #1f4a35;
  --accent-glow: rgba(61, 214, 140, 0.15);
  --blue:        #4d9eff;  --blue-dim:   #1a3a5c;
  --purple:      #a78bfa;  --purple-dim: #2e1f5e;
  --amber:       #f5a623;  --amber-dim:  #3d2a0a;
  --red:         #f05252;  --red-dim:    #3d1010;
  --coral:       #f97066;  --coral-dim:  #3d1810;
  --radius:    8px;
  --radius-lg: 12px;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body, #root { height: 100%; }
body {
  font-family: -apple-system, 'SF Pro Display', 'Segoe UI', sans-serif;
  background: var(--bg0);
  color: var(--text1);
  overflow: hidden;
}
.mono {
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 12px;
}
::-webkit-scrollbar { width: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 4px; }
```

---

## STEP 3 — SQLite schema (src-tauri/src/db/schema.sql)

```sql
CREATE TABLE IF NOT EXISTS routes (
  id               TEXT PRIMARY KEY,
  match_type       TEXT NOT NULL DEFAULT 'subdomain',
  hostname         TEXT NOT NULL,
  path_prefix      TEXT,
  strip_path       INTEGER NOT NULL DEFAULT 0,
  service_group_id TEXT NOT NULL,
  tls              TEXT NOT NULL DEFAULT 'acme',
  middleware       TEXT NOT NULL DEFAULT '[]',
  enabled          INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS service_groups (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL UNIQUE,
  colour                TEXT NOT NULL DEFAULT '#3dd68c',
  load_balancer         TEXT NOT NULL DEFAULT 'round-robin',
  health_check_path     TEXT NOT NULL DEFAULT '/health',
  health_check_interval TEXT NOT NULL DEFAULT '30s',
  health_check_timeout  TEXT NOT NULL DEFAULT '5s',
  passive_health_check  INTEGER NOT NULL DEFAULT 1,
  created_at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS upstreams (
  id               TEXT PRIMARY KEY,
  service_group_id TEXT NOT NULL REFERENCES service_groups(id) ON DELETE CASCADE,
  address          TEXT NOT NULL,
  weight           INTEGER NOT NULL DEFAULT 1,
  status           TEXT NOT NULL DEFAULT 'unknown',
  latency_ms       INTEGER,
  last_checked     TEXT,
  created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS middleware_configs (
  id      TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  config  TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS tls_config (
  id                  INTEGER PRIMARY KEY DEFAULT 1,
  mode                TEXT NOT NULL DEFAULT 'acme',
  acme_email          TEXT,
  acme_challenge_type TEXT DEFAULT 'HTTP-01',
  certs               TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO app_settings VALUES
  ('public_ip',''),('http_port','80'),('https_port','443'),
  ('admin_port','8080'),('log_level','INFO'),
  ('config_path','/etc/proxygate/traefik.yml'),
  ('cf_proxy','false'),('ha_enabled','false'),
  ('ha_role','primary'),('ha_vip',''),
  ('ha_peer_ip',''),('ha_interface','eth0');

INSERT OR IGNORE INTO middleware_configs VALUES
  ('rate-limit',    0, '{"ratePerSecond":100}'),
  ('basic-auth',    0, '{"users":[]}'),
  ('cors',          0, '{"allowOrigins":["*"]}'),
  ('gzip',          1, '{}'),
  ('ip-whitelist',  0, '{"cidrs":[]}'),
  ('https-redirect',1, '{}'),
  ('custom-headers',0, '{"set":{},"remove":[]}');
```

---

## STEP 4 — Layout shell

### src/components/layout/AppShell.tsx
CSS grid: 220px sidebar | 1fr main, 52px topbar spanning both columns.
- Topbar: bg1, 1px bottom border
- Sidebar: bg1, 1px right border, flex column, padding 14px 0
- Main: bg0, overflow-y auto, padding 24px

### src/components/layout/Topbar.tsx
```
Left:   SVG icon (22x22 green rect rx=6 with + cross in accent)
        + wordmark "PROXY" (text1) + "GATE" (accent colour)
        + version pill (bg3 text3 "v0.1.0")

Right:  Status chip — green pill:
          pulsing dot (7px circle, #3dd68c, CSS animation opacity 1→0.4→1 2s)
          text: "{routeCount} routes active · {upstreamCount} upstreams"
          bg accent-dim, border rgba(accent 0.2)
        Restart button (↻, 30x30, bg bg3 border border2, hover bg bg4)
        Notifications button (same style)
```

Status chip data comes from useRouteStore + useServiceGroupStore.

### src/components/layout/Sidebar.tsx
Nav items with onclick handler to switch active page.
Active item: bg bg2 + text1 + ::before pseudo with 3px left accent bar.
Nav badges (route count, group count): bg bg4 text text2, 10px, margin-left auto.

Nav structure:
```
MAIN section label
  ⊞  Dashboard
  ⇄  Routes          [badge]
  ◉  Service groups  [badge]
  divider
CONFIG section label
  ⊙  DNS / Cloudflare
  ⊕  Middleware
  🔒  TLS / SSL
  divider
OBSERVE section label
  ≡  Live logs
  ⚙  Settings
```

---

## STEP 5 — Reusable UI components

### src/components/ui/Badge.tsx
Props: variant ('green'|'blue'|'amber'|'red'|'purple'|'gray') + children
Renders: 10px 600 weight pill with ramp bg/text/border from design system.

### src/components/ui/Button.tsx
Props: variant ('primary'|'ghost'|'danger') + size ('sm'|'md') + onClick + children
Renders styled button with hover states from design system.

### src/components/ui/Toggle.tsx
Pill switch. Props: checked, onChange.
Off: track bg4, knob text3. On: track accent-dim, knob accent. Transition 0.2s.

### src/components/ui/Modal.tsx
Props: open, onClose, title, children, footer.
Overlay: rgba(0,0,0,0.7) + backdrop-filter blur(2px).
Modal box: bg1, border border2, border-radius radius-lg, padding 22px.
Focus trap on open. ESC key closes. Clicking overlay closes.

### src/components/ui/HealthDot.tsx
Props: status ('up'|'down'|'unknown')
7px circle. UP: #3dd68c + pulse animation. DOWN: #f05252. UNKNOWN: text3.

### src/components/ui/UpstreamRow.tsx
Props: upstream (Upstream), onEdit, onRemove
Renders one row:
  [HealthDot] [address .mono] [weight text] [health bar 60px] [latency text3] [badge] [Edit btn] [Remove btn]

Health bar: 4px tall, bg3 track, accent fill, width% based on latency (100% if <50ms, scales down).

---

## STEP 6 — Zustand stores

### Pattern for every store:
```typescript
import { create } from 'zustand'
import { db } from '../lib/db'
import { regenerateConfig } from '../lib/configGen'

// load() runs on app mount via App.tsx useEffect
// Every mutation calls regenerateConfig() after the db write
// Optimistic: update state immediately, await db/config, rollback on error
```

### useSettingsStore.ts
Manages AppSettings. load() reads all keys from app_settings table.
save(patch) writes changed keys + calls regenerateConfig().
Exposes: settings, loading, load(), save()

### useServiceGroupStore.ts
Manages ServiceGroup[] with nested Upstream[].
Methods: load, add, update, remove, addUpstream, removeUpstream, refreshHealth.
refreshHealth() calls invoke('check_upstream_health', { address }) for every upstream,
  writes result back to upstreams table, reloads state.
Module-level: setInterval(() => useServiceGroupStore.getState().refreshHealth(), 30_000)

### useRouteStore.ts
Manages Route[]. Methods: load, add, update, remove, toggle (toggles enabled).
toggle(id) updates enabled in db + calls regenerateConfig() — no modal needed.

### useMiddlewareStore.ts
Manages MiddlewareConfig[]. Methods: load, toggle(id), updateConfig(id, config).

### useTLSStore.ts
Manages TLSConfig. Methods: load, save, addCert, removeCert.

---

## STEP 7 — Pages

### Dashboard (src/pages/Dashboard.tsx)
Stats row: 4 cards in a CSS grid (repeat(4,1fr) gap 10px)
  - Card: bg bg1 border radius-lg padding 14px 16px
  - Value: 26px font-weight 700 letter-spacing -0.02em
  - Label: 11px text3 font-weight 500 uppercase letter-spacing 0.04em
  - Change line: 10px below value

Two-column grid below (1fr 1fr gap 12px):
  Left card "Recent requests":
    List items: flex row, health dot (coloured by status code), mono path, time ago right
    "View all →" ghost button sm → navigate to logs

  Right card "Service health":
    List items: health dot + group name + upstream fraction + badge
    If ANY upstream in group is DOWN: show amber badge "X down" instead of green

### Routes (src/pages/Routes.tsx)
Info banner:
  Flex row, bg bg2, border border2, radius radius, padding 10px 14px
  Icon (ⓘ in accent), text in text2, IP in .mono text1, "DNS setup →" ghost button sm

Table inside card:
  th: 10px uppercase letter-spacing 0.08em text3
  td first-child: text1. td rest: text2
  Row hover: bg bg2
  Status column: clicking the ON/OFF badge calls routeStore.toggle(route.id) immediately

Add/Edit Route Modal:
  Two tab buttons at top (Path prefix / Subdomain) — clicking swaps the form fields shown
  Both tabs share: service group dropdown, TLS select, middleware checkboxes

  Path prefix tab unique fields:
    Domain input + Path prefix input (both .mono)
    Strip path prefix Toggle
    When strip is ON, show preview box:
      bg bg2 border border2 radius padding 8px 12px font-size 12px
      "example.com/api/users → backend receives GET /users"
      (interpolated from the domain + prefix + a sample path)

  Subdomain tab unique field:
    Hostname input (.mono) — e.g. jellyfin.example.com

  Service group dropdown: lists all groups with their colour dot.
    Last option: "+ New group…" — closes this modal, opens NewServiceGroupModal

### Service Groups (src/pages/ServiceGroups.tsx)
Each ServiceGroup renders as an expandable card.

Collapsed header (clickable, hover bg bg2):
  flex row: colour dot (10px circle) + name (13px 600) + badges + chevron (▼/▶)
  Badges: [X/Y up green/amber] [LB method blue] [N upstreams gray]

Expanded body (two sections separated by border):

  Section "Upstreams" (padding 12px 16px):
    Section label: 10px uppercase text3 margin-bottom 8px
    List of UpstreamRow components
    Below list — add inline form:
      flex row: IP:port .mono input (flex 1) + Weight select + "Add upstream" ghost button sm
      On submit: validate address, call serviceGroupStore.addUpstream()

  Section "Settings" (padding 12px 16px):
    Flex row wrap gap 12px of form groups:
      Load balancer select (160px wide)
      Health check path .mono input (140px wide)
      Interval input (80px wide)
      Timeout input (80px wide)
    Passive health check Toggle at bottom
    Auto-save: onChange on any field calls serviceGroupStore.update() debounced 500ms

New Service Group Modal:
  Name input (validate: alphanumeric + hyphens, unique)
  Load balancer select
  Upstream list section:
    Start with one row: IP:port input + weight select + remove button
    "+ Add another upstream" text button adds a row
    Minimum 1 upstream required
  Health check path + interval inputs
  Colour picker: row of 5 swatches (teal #3dd68c, blue #4d9eff, coral #f97066, purple #a78bfa, amber #f5a623)
    Clicking a swatch selects it (shows ring border)
  On create: validate all fields, call serviceGroupStore.add()

### DNS / Cloudflare (src/pages/DNS.tsx)

Section 1 — Public IP:
  Card with label "ProxyGate public IP"
  Editable input (.mono) bound to settingsStore.settings.publicIp
  Caption: "This is the only IP address you put in all your DNS records."
  Save button — calls settingsStore.save({ publicIp })

Section 2 — How it works:
  Card with explanation text (no heading):
  "All your domains point to this one IP. When a request arrives, ProxyGate reads the
  Host header — for example Host: jellyfin.example.com — and routes it to the correct
  service group. Multiple completely different services can share the same IP because
  they are separated by hostname, not by IP address. Cloudflare only ever sees one IP."

Section 3 — DNS records table:
  Card with heading "Recommended Cloudflare DNS records"
  Read-only table:
    Type  | Name              | Value              | Purpose
    A     | example.com       | {publicIp}         | Root domain
    A     | *.example.com     | {publicIp}         | All subdomains (wildcard)
    A     | jellyfin.example  | {publicIp}         | Specific subdomain example
  Values interpolate from settingsStore. Table cells use .mono on Type and Value columns.
  Note below table: "The wildcard record *.example.com means any subdomain you configure
  in ProxyGate will work automatically — no new DNS record needed per service."

Section 4 — Cloudflare proxy mode:
  Card with Toggle: "Using Cloudflare orange-cloud proxy mode"
  When OFF: nothing extra shown
  When ON: info box (bg blue-dim border rgba(blue 0.2)) explaining:
    "Cloudflare puts its servers in front of yours. Without trusted header config,
    ProxyGate sees Cloudflare's IP instead of your real visitor IPs — affecting
    rate limiting, logs, and IP whitelist rules."
    Status line: "✓ CF-Connecting-IP trusted header — auto-configured in generated Traefik config"
    Status line: "✓ Cloudflare IP ranges — written to forwardedHeaders.trustedIPs"
    Both lines green. No user action needed — ProxyGate handles it.

Section 5 — Firewall warning:
  Amber banner (bg amber-dim border rgba(amber 0.2) radius padding 12px 14px):
  "⚠ Your backend servers should only accept connections from ProxyGate's internal IP.
  Block all backend ports from external internet access. Only ProxyGate's public IP
  (port 80 and 443) needs to be open."

### Middleware (src/pages/Middleware.tsx)
List inside a card. Each toggle row:
  flex row: icon well (30px sq bg bg3 radius 7px center emoji) + info col (flex 1) + Toggle
  Info col: name (12.5px 500 text1) + description (11px text3 margin-top 1px)
  Hover row: bg bg2

Middlewares with sub-config — when toggled ON, animate open an inline config row below:
  Rate limiting: "Max requests per second" number input
  IP whitelist:  textarea for CIDR list (one per line)
  Custom headers: two columns "Set header" key/value pairs + "Remove header" list
  CORS: "Allowed origins" input

### TLS (src/pages/TLS.tsx)
Two option cards side by side (1fr 1fr grid):
  AUTO card and MANUAL card
  Selected card: border 2px accent bg accent-dim slightly
  Unselected: normal border bg bg1
  Clicking a card selects it + saves mode to tlsStore

ACME form (shown when AUTO selected, bg bg1 border radius-lg padding 16px):
  Email input + Challenge type select in a 2-col grid

Certs table (card):
  Domain | Issuer | Expires | Days left | Status
  Days left calculated from expiresAt. If < 30 days: amber badge "Expiring". If expired: red.

"+ Upload cert" modal: domain input + cert PEM textarea + key PEM textarea

### Live Logs (src/pages/Logs.tsx)
Filter bar: flex row gap 8px
  Route select (dropdown of all route hostnames + "All routes")
  Status select (All / 2xx / 3xx / 4xx / 5xx)
  Pause/Resume toggle button (ghost, shows ⏸ / ▶)

Log container: card with overflow-y auto max-height 460px
Each log entry: grid 5 columns (time 70px / status 38px / method 45px / path 1fr / latency 60px)
  All mono font 11.5px
  time: text3, status: coloured by code, method: text3, path: text2, latency: text3 right-align
  Row hover: bg bg2

Implementation:
  useEffect on mount: const unlisten = await listen('log-line', (event) => { ... })
  Append to logStore. Filter in JS before rendering. Cap array at 200 entries.
  Auto-scroll: useRef on container, scrollTop = scrollHeight after each append unless paused.
  Return unlisten on unmount.

### Settings (src/pages/Settings.tsx)
Four cards stacked:

Card "Network":
  2-col form grid: HTTP port | HTTPS port | Admin API port | Log level select

Card "Public IP":
  Single full-width input (.mono) for publicIp
  Caption explaining this is what goes in DNS

Card "Config export":
  Read-only .mono input showing config path
  Small text: "Auto-generated by ProxyGate — do not edit manually"
  Row of buttons: Save changes (primary) · Export config (ghost) · Restart proxy (ghost)

Card "High availability" (collapsible — chevron button toggles open/close):
  When closed: just header row
  When open:
    Enable HA Toggle
    When HA enabled, show:
      This node: PRIMARY / SECONDARY button group (two buttons, selected = accent bg)
      Floating VIP input (.mono) — the shared IP for keepalived
      Peer node IP input (.mono)
      Network interface input — e.g. eth0
      Info box (bg blue-dim):
        "Run two ProxyGate instances. keepalived assigns the Floating VIP to whichever
        node is healthy. Your domain always points to the VIP — it never changes even
        if one ProxyGate node goes down. Both nodes must run identical configs."

---

## STEP 8 — Config generation (src/lib/configGen.ts)

```typescript
import { invoke } from './tauri'
import { useRouteStore } from '../store/useRouteStore'
import { useServiceGroupStore } from '../store/useServiceGroupStore'
import { useMiddlewareStore } from '../store/useMiddlewareStore'
import { useTLSStore } from '../store/useTLSStore'
import { useSettingsStore } from '../store/useSettingsStore'
import { CLOUDFLARE_IP_RANGES } from './cloudflareIPs'

export async function regenerateConfig(): Promise<void> {
  const routes   = useRouteStore.getState().routes.filter(r => r.enabled)
  const groups   = useServiceGroupStore.getState().groups
  const mw       = useMiddlewareStore.getState().configs
  const tls      = useTLSStore.getState().config
  const settings = useSettingsStore.getState().settings

  const yaml = buildTraefikV3YAML({ routes, groups, mw, tls, settings })

  try {
    await invoke('write_config', { yaml, path: settings.configOutputPath })
    await invoke('reload_proxy')
  } catch (err) {
    console.error('Config regeneration failed:', err)
    throw err
  }
}

function buildTraefikV3YAML({ routes, groups, mw, tls, settings }): string {
  // Build valid Traefik v3 static + dynamic YAML
  // Key sections:
  //
  // entryPoints:
  //   web:       address: ":80"
  //   websecure: address: ":443"
  //
  // certificatesResolvers: (if tls.mode === 'acme')
  //   letsencrypt:
  //     acme:
  //       email: tls.acmeEmail
  //       storage: /etc/proxygate/acme.json
  //       httpChallenge / dnsChallenge based on challenge type
  //
  // forwardedHeaders: (if settings.cloudflareProxyEnabled)
  //   trustedIPs: [...CLOUDFLARE_IP_RANGES]
  //
  // http.routers (one per enabled route):
  //   rule: Host(`hostname`) or Host(`domain`) && PathPrefix(`/prefix`)
  //   service: group.id
  //   middlewares: route.middleware[]
  //   tls.certResolver: 'letsencrypt' if acme
  //
  // http.services (one per group):
  //   loadBalancer:
  //     servers: group.upstreams.filter(u => u.status !== 'down').map(u => url: http://u.address)
  //     healthCheck: { path, interval, timeout }
  //
  // http.middlewares (one per enabled middleware with its config)
  //
  // For path routes with stripPathPrefix: true, add a stripPrefix middleware entry
  //
  // Return as YAML string using a simple JS YAML serialiser or template literal
}
```

---

## STEP 9 — Tauri Rust commands (src-tauri/src/commands/)

### proxy.rs
```rust
#[tauri::command]
pub async fn reload_proxy(app: tauri::AppHandle) -> Result<(), String> {
    // On Linux: find traefik process, send SIGHUP
    // On Windows: call Traefik HTTP API POST /api/providers/file (if API enabled)
    // Return Ok(()) on success, Err(message) on failure
}

#[tauri::command]
pub async fn get_proxy_status() -> Result<serde_json::Value, String> {
    // Check if traefik process is running
    // Return { running: bool, routeCount: u32 }
}
```

### health.rs
```rust
#[tauri::command]
pub async fn check_upstream_health(address: String) -> Result<u64, String> {
    // Parse address as "ip:port"
    // Build URL: http://{address}/  (health check path comes from calling code)
    // HTTP HEAD request with 5s timeout using reqwest
    // Return latency in ms as u64, or Err("Connection refused") etc
}
```

### logs.rs
```rust
#[tauri::command]
pub async fn start_log_tail(app: tauri::AppHandle) -> Result<(), String> {
    // Spawn a thread that tails Traefik's access log file
    // For each new line, parse it and emit:
    // app.emit_all("log-line", LogLine {
    //   timestamp, status_code, method, host, path, latency_ms
    // })
}

#[derive(serde::Serialize, Clone)]
pub struct LogLine {
    pub timestamp: String,
    pub status: u16,
    pub method: String,
    pub host: String,
    pub path: String,
    pub latency_ms: u64,
}
```

---

## STEP 10 — App.tsx wiring

```typescript
// src/App.tsx
import { useEffect } from 'react'
import { RouterProvider } from 'react-router-dom'
import { router } from './router'
import { useRouteStore } from './store/useRouteStore'
import { useServiceGroupStore } from './store/useServiceGroupStore'
import { useMiddlewareStore } from './store/useMiddlewareStore'
import { useTLSStore } from './store/useTLSStore'
import { useSettingsStore } from './store/useSettingsStore'
import { invoke } from './lib/tauri'

export default function App() {
  useEffect(() => {
    // Load all stores on mount
    Promise.all([
      useRouteStore.getState().load(),
      useServiceGroupStore.getState().load(),
      useMiddlewareStore.getState().load(),
      useTLSStore.getState().load(),
      useSettingsStore.getState().load(),
    ])
    // Start log tail
    invoke('start_log_tail')
    // Health check runs via setInterval in useServiceGroupStore module
  }, [])

  return <RouterProvider router={router} />
}
```

---

## STEP 11 — Router (src/router.tsx)

```typescript
import { createHashRouter } from 'react-router-dom'
import AppShell from './components/layout/AppShell'
import Dashboard from './pages/Dashboard'
import Routes from './pages/Routes'
import ServiceGroups from './pages/ServiceGroups'
import Middleware from './pages/Middleware'
import TLS from './pages/TLS'
import Logs from './pages/Logs'
import DNS from './pages/DNS'
import Settings from './pages/Settings'

export const router = createHashRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true,           element: <Dashboard /> },
      { path: 'routes',        element: <Routes /> },
      { path: 'services',      element: <ServiceGroups /> },
      { path: 'middleware',    element: <Middleware /> },
      { path: 'tls',           element: <TLS /> },
      { path: 'logs',          element: <Logs /> },
      { path: 'dns',           element: <DNS /> },
      { path: 'settings',      element: <Settings /> },
    ]
  }
])
// Use hash router because Tauri serves from file:// — no server-side routing
```

---

## STEP 12 — Build order

Build in this order. Each step should compile and render before moving to the next.

1.  globals.css + AppShell layout grid renders correctly
2.  Topbar with logo and static status chip
3.  Sidebar with all nav items, active state working
4.  Router wired up, clicking nav navigates between empty page shells
5.  SQLite schema migrated, db.ts wrapper works (test with a console.log on load)
6.  useSettingsStore loads from DB, public IP shows in topbar
7.  useServiceGroupStore loads groups + upstreams, Dashboard service health card works
8.  useRouteStore loads routes, Dashboard recent requests card works
9.  Routes page table renders from store data
10. Add Route modal — subdomain tab works end to end (create → appears in table)
11. Add Route modal — path prefix tab + strip preview works
12. Service Groups page — expandable cards, add upstream inline form works
13. New Service Group modal — full flow including colour picker
14. Middleware toggle page + inline sub-config expansion
15. TLS page — ACME form + cert table
16. DNS page — all 5 sections with live public IP interpolation
17. Settings page — all 4 cards including HA section
18. Logs page — Tauri event listener wired up, live stream rendering
19. configGen.ts — regenerateConfig() called after mutations, inspect output in Settings
20. Tauri Rust commands — proxy start/stop/reload, health check, log tail

---

## Key constraints (never violate these)

- Config file path is ALWAYS read-only in the UI. Never let users edit the YAML directly.
- regenerateConfig() is called after EVERY store mutation. No manual "apply" button anywhere.
- All IP addresses, ports, paths, and hostnames use the .mono CSS class without exception.
- The service group's public IP is ProxyGate's IP. Never show backend IPs as "the IP to use in DNS".
- Validation errors appear inline below the field, never as a toast or alert dialog.
- The status ON/OFF toggle in the routes table triggers immediately without opening a modal.
- TypeScript strict mode. Zero `any` types. All Tauri invoke() calls are typed.
- Health checks run on a 30-second interval. Never on every render or user action.
- Log streaming uses Tauri listen(), never setInterval + fetch.
