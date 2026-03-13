# ProxyGate

**A cross-platform desktop reverse-proxy manager built with Tauri (Rust) and React.**

ProxyGate lets you route incoming HTTP traffic by hostname to groups of internal services — with automatic health checking, load balancing, WebSocket support, preset configurations for Jellyfin/Plex/APIs, and a live access log — all from a native GUI with no config files to edit manually.

---

## Table of Contents

1. [Features](#features)
2. [How It Works](#how-it-works)
3. [Installation](#installation)
4. [Development Setup](#development-setup)
5. [Configuration Guide](#configuration-guide)
   - [Service Groups & Presets](#service-groups--presets)
   - [Upstreams](#upstreams)
   - [Routes](#routes)
   - [Middleware](#middleware)
   - [TLS / SSL](#tls--ssl)
   - [Settings](#settings)
6. [Network Setup](#network-setup)
7. [Live Logs](#live-logs)
8. [Building the Installer](#building-the-installer)
9. [Architecture](#architecture)
10. [Troubleshooting](#troubleshooting)

---

## Features

| Feature | Detail |
|---|---|
| **Host-header routing** | One port, unlimited hostnames. Traffic for `jellyfin.yourdomain.com` goes to Jellyfin; `plex.yourdomain.com` goes to Plex — same port 80/443. |
| **App presets** | One-click configurations for Jellyfin, Plex, REST APIs, static file servers, and generic HTTP. Each preset sets appropriate timeouts, health-check paths, and enables/disables WebSocket support automatically. |
| **Real Rust proxy** | Built on Axum + Reqwest. Full response streaming (no buffering), so media starts playing instantly. |
| **WebSocket support** | Full bidirectional WebSocket tunnelling for Jellyfin/Plex real-time dashboards. |
| **Load balancing** | Round-robin, weighted, IP-hash, and least-connections strategies per group. |
| **Health checking** | Active HTTP health checks every 30 s. Passive marking: if an upstream refuses a connection, it is flagged down immediately without waiting for the next check interval. |
| **Live access logs** | Every proxied request — method, host, path, status code, latency — streams live into the built-in log viewer. Filter by route or status class. |
| **X-Forwarded-For** | Real client IPs are forwarded to upstream services. Jellyfin's LAN-detection and access-log features work correctly. |
| **SQLite persistence** | All configuration is stored locally in a SQLite database via `tauri-plugin-sql`. Nothing is stored in the cloud. |
| **Cross-platform** | Windows (MSI + NSIS), macOS (.dmg), Linux (.deb, .rpm, AppImage) from a single codebase. |

---

## How It Works

```
Internet / LAN client
        │
        ▼  HTTP :8080 (or your chosen port)
┌───────────────────┐
│   ProxyGate       │  ← Rust HTTP server (Axum)
│   Proxy Engine    │
│                   │  Reads "Host:" header → looks up matching Route
│  host: jellyfin.  │──────────────────────────────────────┐
│  example.com      │                                      ▼
│                   │                         ┌──────────────────────┐
│  host: plex.      │──────────────────────── │  Service Group        │
│  example.com      │                         │  (pool of upstreams) │
└───────────────────┘                         │  192.168.1.10:8096   │
                                              │  192.168.1.11:8096   │
                                              └──────────────────────┘
```

**Routing logic:**

1. A request arrives at ProxyGate's HTTP port.
2. The `Host` header is compared against all enabled Routes.
3. The matching Route points to a Service Group.
4. ProxyGate picks a healthy upstream from the group using the configured load-balancing strategy.
5. The request (including headers and body) is forwarded to that upstream.
6. The response streams back to the client byte-by-byte — no buffering.
7. A log entry is emitted to the live log viewer.

---

## Installation

### Windows (recommended)

1. Download `ProxyGate_x.x.x_x64_en-US.msi` from [GitHub Releases](https://github.com/loguefx/ProxyGate/releases/latest).
2. Run the installer — no administrator rights required (per-user install).
3. Launch **ProxyGate** from the Start Menu.

> **Note:** On first launch, Windows Firewall may prompt you to allow ProxyGate to listen on the network. Click **Allow** so external traffic can reach the proxy.

### macOS

1. Download `ProxyGate_x.x.x_x64.dmg` from GitHub Releases.
2. Open the `.dmg` and drag ProxyGate to Applications.
3. On first launch, right-click → Open to bypass Gatekeeper if needed.

### Linux

Download the `.deb`, `.rpm`, or `.AppImage` from GitHub Releases and install as usual.

---

## Development Setup

### Prerequisites

| Tool | Version | Install |
|---|---|---|
| Node.js | ≥ 18 | https://nodejs.org |
| Rust | stable | https://rustup.rs |
| Tauri CLI | 2.x | `cargo install tauri-cli` |
| Visual Studio Build Tools | 2022 | Required on Windows for the MSVC linker |

### Running in development

```powershell
# 1. Clone the repository
git clone https://github.com/loguefx/ProxyGate.git
cd ProxyGate

# 2. Install Node dependencies
npm install

# 3. Start the development build (opens the native window automatically)
npm run tauri dev
```

> The Vite dev server starts at `http://localhost:1420` but the app only works in the **native Tauri window** — Tauri's IPC bridge is not available in a regular browser tab. Opening `localhost:1420` in a browser will show a download page.

---

## Configuration Guide

### Service Groups & Presets

A **Service Group** is a named pool of backend upstream servers. All traffic routed to the group is distributed across healthy upstreams using the chosen load-balancing strategy.

When creating a group, pick an **App Type** preset:

| Preset | Timeout | WebSocket | Health path | Best for |
|---|---|---|---|---|
| **Generic** | 5 min | ✅ | `/health` | Any standard HTTP service |
| **Jellyfin** | 6 hours | ✅ | `/health/alive` | Jellyfin Media Server |
| **Plex** | 6 hours | ✅ | `/identity` | Plex Media Server |
| **API** | 30 s | ✅ | `/health` | REST APIs, webhooks, microservices |
| **Static / CDN** | 5 min | ✅ | `/` | Static file servers, image hosts |

> **Why does Jellyfin need 6 hours?** A 2-hour movie is a 2-hour open HTTP connection. Default 30-second timeouts kill the stream mid-playback. The Jellyfin preset sets a 6-hour limit so a full movie night never gets interrupted.

**Selecting Jellyfin preset automatically:**
- Sets the health-check path to `/health/alive` (Jellyfin's native health endpoint)
- Sets the health-check interval to 60 s (less aggressive for a media server)
- Enables WebSocket tunnelling so the Jellyfin web dashboard gets real-time playback state and library notifications

### Upstreams

Each upstream is an `address:port` of a backend service. Add multiple upstreams to the same group for load balancing or failover.

```
192.168.1.10:8096      ← Jellyfin on LAN IP
192.168.1.10:32400     ← Plex on same host
```

**Weight field:** Only used with the Weighted load balancer. A weight of `3` means this upstream gets 3× as much traffic as one with weight `1`.

**Health status:**
- `✅ up` — health check passed
- `⚠ unknown` — not yet checked (freshly added)
- `❌ down` — health check failed, or passive mark after a connection refusal

### Load Balancers

| Strategy | How it works | Use when |
|---|---|---|
| **Round-robin** | Cycles through upstreams in order | Default, most services |
| **Weighted** | More traffic to higher-weight upstreams | Servers have different capacity |
| **IP hash** | Same client IP → same upstream (sticky sessions) | Stateful apps without shared session storage |
| **Least connections** | Routes to upstream with fewest active requests | Long-lived or slow requests |

### Routes

A **Route** maps an incoming hostname to a Service Group.

| Field | Description |
|---|---|
| **Hostname** | The exact `Host` header to match (e.g. `jellyfin.example.com`) |
| **Service Group** | The upstream pool to forward matching requests to |
| **Enabled** | Toggle to temporarily disable a route without deleting it |
| **Match type** | `subdomain` (exact host match) or `path` (host + path prefix) |
| **Path prefix** | For path-type routes: only match requests whose path starts with this |
| **Strip path prefix** | Remove the path prefix before forwarding (e.g. `/app` → `/`) |

> **Multiple services, one port:** You can have 10 routes all pointing to port 8080. ProxyGate distinguishes them purely by the `Host` header — as long as each service has a different hostname (via DNS or `/etc/hosts`), they never conflict.

### Middleware

Global middleware applied to all proxied requests:

| Middleware | Default | Description |
|---|---|---|
| **Gzip** | On | Compress responses for clients that accept it |
| **HTTPS Redirect** | On | Redirect HTTP → HTTPS (requires TLS to be configured) |
| **Rate Limit** | Off | Limit requests per second per IP |
| **Basic Auth** | Off | Require username/password on all routes |
| **CORS** | Off | Add `Access-Control-Allow-Origin` headers |
| **IP Whitelist** | Off | Only allow requests from specific CIDR ranges |
| **Custom Headers** | Off | Inject or remove arbitrary request headers |

### TLS / SSL

ProxyGate supports two TLS modes:

**ACME (Let's Encrypt)** — automatic certificate issuance and renewal. Requires:
- Your domain's A record pointing to your public IP
- Port 80 open on your router (for HTTP-01 challenge) or DNS API access (DNS-01)

**Manual** — paste in paths to your existing certificate and private key files.

> TLS termination (HTTPS support) is currently in the configuration schema but the Rust proxy engine handles HTTP only in v0.1.0. HTTPS termination is on the roadmap.

### Settings

| Setting | Default | Description |
|---|---|---|
| **HTTP port** | `8080` | The port ProxyGate's proxy engine listens on |
| **Public IP** | — | Your router's public-facing IP (shown in DNS guide) |
| **Log level** | `INFO` | Verbosity of internal Rust logging |
| **Cloudflare proxy** | Off | Enable if using Cloudflare's orange-cloud proxy (adjusts trusted IP headers) |

---

## Network Setup

To make ProxyGate accessible from the internet (e.g. `jellyfin.yourdomain.com`):

### 1. DNS — Add an A record

In your DNS provider (Cloudflare, Namecheap, etc.):

```
Type  Name      Value            TTL
A     jellyfin  <your-public-ip> Auto
```

> Find your public IP at https://whatismyip.com  
> If using Cloudflare, set the cloud icon to **grey (DNS only)** — do not proxy through Cloudflare for media streaming.

### 2. Router — Port forwarding

Log into your router (usually `192.168.1.1` or `192.168.0.1`) and add:

```
Protocol  External port  Internal IP          Internal port
TCP       8080           <your PC's LAN IP>   8080
```

Find your PC's LAN IP by running `ipconfig` and looking for the IPv4 address on your Ethernet or Wi-Fi adapter.

### 3. Firewall — Windows

If Windows Firewall blocks incoming connections on port 8080:

```powershell
netsh advfirewall firewall add rule `
  name="ProxyGate" `
  dir=in action=allow protocol=TCP localport=8080
```

### 4. Verify

```powershell
# Check DNS resolves correctly
nslookup jellyfin.yourdomain.com 1.1.1.1

# Check port is reachable from outside
# Use https://portchecker.co or:
curl http://jellyfin.yourdomain.com:8080
```

---

## Live Logs

The **Live logs** page streams every proxied request in real time:

| Column | Description |
|---|---|
| **Time** | HH:MM:SS of the request |
| **St** | HTTP status code (colour-coded: green 2xx, amber 4xx, red 5xx) |
| **Meth** | HTTP method (GET, POST, etc.) |
| **Path** | `hostname/path` of the request |
| **Lat** | Latency in milliseconds from request received to first response byte |

**Controls:**
- **Filter by route** — only show requests for a specific hostname
- **Filter by status** — show only 2xx, 3xx, 4xx, or 5xx responses
- **Pause / Resume** — freeze the scroll without losing entries
- **Auto-clear** — automatically clear the log every 30 min / 1h / 6h / 24h
- **🗑 Clear** — instantly wipe all current log entries

> Logs are stored **in memory only** and are never written to disk. They are capped at 1000 entries (≈200 KB). Nothing fills up your drive.

---

## Building the Installer

### Windows (MSI + NSIS)

```powershell
npm run tauri build
```

Outputs to `src-tauri/target/release/bundle/`:
- `msi/ProxyGate_0.1.0_x64_en-US.msi` — Windows Installer package
- `nsis/ProxyGate_0.1.0_x64-setup.exe` — NSIS installer

> First build downloads the WiX Toolset automatically (~40 MB). Subsequent builds are fast.

### macOS

```bash
npm run tauri build
# outputs: src-tauri/target/release/bundle/dmg/ProxyGate.dmg
```

### Linux

```bash
npm run tauri build
# outputs: .deb, .rpm, and .AppImage in src-tauri/target/release/bundle/
```

---

## Architecture

```
ProxyGate/
├── src/                         # React + TypeScript frontend
│   ├── pages/
│   │   ├── Dashboard.tsx        # Overview: active routes, upstream health, req/min
│   │   ├── Routes.tsx           # Manage hostname → service group mappings
│   │   ├── ServiceGroups.tsx    # Manage upstream pools with preset picker
│   │   ├── Middleware.tsx       # Global request/response middleware toggles
│   │   ├── TLS.tsx              # Certificate management (ACME / manual)
│   │   ├── Logs.tsx             # Live request log stream
│   │   ├── DNS.tsx              # DNS configuration guide
│   │   └── Settings.tsx         # Port, public IP, log level
│   ├── store/
│   │   ├── useServiceGroupStore.ts  # Zustand store — syncs with SQLite
│   │   ├── useRouteStore.ts
│   │   ├── useSettingsStore.ts
│   │   └── useLogStore.ts       # In-memory circular buffer (1000 entries)
│   └── lib/
│       ├── configGen.ts         # Builds ProxyConfig payload → reloadProxy()
│       ├── tauri.ts             # Typed wrappers around tauri invoke()
│       └── types.ts             # Shared TypeScript interfaces
│
└── src-tauri/                   # Rust backend
    ├── src/
    │   ├── proxy.rs             # Axum HTTP server + reverse proxy logic
    │   │                        #   · Host-header routing
    │   │                        #   · Streaming request + response bodies
    │   │                        #   · Per-preset timeouts (30s/5min/6h)
    │   │                        #   · WebSocket tunnelling (tokio-tungstenite)
    │   │                        #   · X-Forwarded-For / X-Real-IP injection
    │   │                        #   · Passive health marking on connect fail
    │   │                        #   · broadcast::Sender<LogLine> for live logs
    │   ├── commands/
    │   │   ├── proxy.rs         # reload_proxy, get_proxy_status
    │   │   ├── logs.rs          # start_log_tail — subscribes to broadcast channel
    │   │   ├── health.rs        # check_upstream_health (active probe)
    │   │   └── config.rs        # write_config, get_config_path
    │   └── db/migrations/
    │       ├── 001_initial.sql  # Schema: routes, service_groups, upstreams, settings
    │       └── 002_add_preset.sql
    └── Cargo.toml               # axum, reqwest (stream), tokio, tokio-tungstenite,
                                 # tauri-plugin-sql (sqlite), chrono, futures-util
```

### Key design decisions

**Why Rust for the proxy?**  
Rust's `async`/`await` with Tokio gives near-zero-overhead concurrency. Axum handles thousands of simultaneous connections with minimal memory. The proxy shares a single `reqwest::Client` with a connection pool — no TCP handshake overhead on repeat requests to the same upstream.

**Why streaming bodies?**  
The previous approach buffered entire responses in memory before forwarding them. For a 10 GB movie file this meant the whole file had to download to the proxy before the browser received one byte. With `resp.bytes_stream()` → `Body::from_stream()`, bytes flow to the client the instant Jellyfin sends them. Playback starts immediately.

**Why a broadcast channel for logs?**  
Tauri's IPC works by calling Rust commands from the frontend. But logs need to flow the other direction (Rust → frontend) continuously. A `tokio::sync::broadcast::Sender<LogLine>` in the `ProxyManager` lets the proxy handler emit log entries without blocking, and any number of subscribers can receive them. `start_log_tail` creates one subscriber and forwards entries as Tauri events.

**Why SQLite?**  
All configuration persists across restarts without needing a running server process. `tauri-plugin-sql` provides safe, type-checked access to SQLite from both Rust (via migrations) and TypeScript (via the plugin's JS bindings).

---

## Troubleshooting

### Proxy not starting

Check the status chip in the top bar. If it shows an error:

| Error | Fix |
|---|---|
| `Cannot bind port 8080` | Another application is using port 8080. Change the port in Settings. |
| `Cannot bind port 80` | Port 80 requires administrator rights on Windows. Use port 8080 or run as admin. |

### Routes not matching

- Ensure the **hostname** in your Route matches the `Host` header exactly (no `http://` prefix, no trailing slash).
- Check that the Route is **Enabled** (green toggle).
- Verify the Service Group has at least one upstream that is not marked `down`.

### Upstream shows "down" immediately

The health check path (`/health` by default) returned a non-2xx status or timed out. Either:
- Change the health-check path to one that returns 200 on your service.
- Use a Jellyfin/Plex preset which sets the correct path automatically.

### Movies freeze or buffer mid-stream

- Ensure the Service Group is using the **Jellyfin** or **Plex** preset — this sets the 6-hour timeout. The Generic preset's 5-minute timeout will kill a long stream.
- Check that your ISP/router isn't rate-limiting the connection.

### Jellyfin shows wrong client IPs

ProxyGate injects `X-Forwarded-For` and `X-Real-IP` headers automatically. In Jellyfin:
> Dashboard → Networking → Known proxies — add your PC's LAN IP (e.g. `192.168.1.x`).  
> This tells Jellyfin to trust those headers for real-IP detection.

### Browser opens localhost:1420 and shows a download page

That is correct and expected. ProxyGate requires the **native desktop window** — Tauri's IPC bridge is not available in a browser tab. Run `npm run tauri dev` and use the native window that opens automatically.

---

## License

MIT — see [LICENSE](LICENSE) for details.
