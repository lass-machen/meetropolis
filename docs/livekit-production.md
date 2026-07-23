# LiveKit self-host production hardening

The OSS `compose.yaml` ships LiveKit with `--dev` so the very first `docker compose up -d`
just works. That is fine for a local smoke test and nothing else. Once you open the stack
to teammates, customers or the public internet, you have to swap the dev defaults for a
real config, rotate the demo credentials and decide how WebRTC traffic actually leaves the
box.

This guide walks through that swap end to end. Audience: a competent Linux self-hoster
who is comfortable with Docker, DNS and `iptables`/`ufw` but does not necessarily know the
internals of WebRTC.

> **Warning: `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` in `.env` do nothing until you
> complete this guide.** As shipped, `compose.yaml` starts LiveKit with `--dev`, which
> ignores those two variables entirely and hardcodes the key pair `devkey` / `secret`
> instead. If you rotate `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` in `.env` as a hardening
> step without also replacing `--dev` with a real `livekit.yaml` (section 3), the
> application server starts signing tokens with a secret LiveKit never sees, and LiveKit
> rejects every join. There is no clear error surfaced to the user — audio/video simply
> never connects. Do not change those two variables without also applying section 2 and
> section 3 below.

> Companion file: [`docs/livekit.yaml.example`](./livekit.yaml.example) is the config
> template referenced throughout. Copy it to `./livekit.yaml` at the repo root, then
> follow along.

## 1. Why the dev-mode default is not production-ready

Starting LiveKit with `--dev` does three things you do not want on a public host:

1. **Hardcoded demo credentials.** Dev mode loads the key pair `devkey` / `secret` into an
   in-memory store. Those values are documented in LiveKit's own quickstart, so anyone who
   port-scans your host and finds `:7880` open can mint valid access tokens for your SFU.
   They cannot read your Postgres or your application data, but they can absolutely use
   the relay as free bandwidth for unrelated traffic and they can join rooms that the
   application server never authorised. Treat an exposed dev-mode LiveKit as
   credential-leak class severity.

2. **No TURN, no config file, no fallback path.** Dev mode skips the `turn:` block and
   relies entirely on ICE host candidates plus a public STUN server. In practice that
   covers roughly 80 to 90 percent of home-internet users, but corporate networks with
   symmetric NAT or strict outbound UDP filtering routinely fail to negotiate. Reports of
   "audio sometimes works, sometimes does not, looks healthy in the logs" almost always
   trace back to this. The 10 to 20 percent miss rate climbs fast when you start onboarding
   teams on VPN, mobile hotspots or restricted office Wi-Fi.

3. **Single-process, no clustering.** Dev mode is not built to talk to redis, so you
   cannot horizontally scale. The OSS instance caps you at 25 concurrent users
   (compile-time constant in `packages/shared/src/tenancy.ts`), but even within that cap
   you are running on one process, one node, with no shared room state.

The compose default also runs LiveKit on `:7880` unencrypted plus an unauthenticated
Prometheus metrics endpoint on `:9090`. Both should sit behind your reverse proxy with TLS
and an allow-list before the host is reachable from the public internet.

## 2. Generate your own API key and secret

LiveKit access tokens are JWTs signed with HS256 using the shared secret. The Meetropolis
application server signs tokens in `apps/server/src/livekit.ts` and LiveKit verifies them
with the same key pair. If either side is wrong, every join fails with `401`.

Pick one of the two options below. The result is the same: an opaque key identifier and a
high-entropy secret.

### Option A: `openssl` (always available)

```bash
KEY=$(tr -dc 'a-z0-9' </dev/urandom | head -c 12)
SECRET=$(openssl rand -base64 32)
printf 'LIVEKIT_API_KEY=%s\nLIVEKIT_API_SECRET=%s\n' "$KEY" "$SECRET"
```

The key id is for human bookkeeping (you can rotate by adding a second key pair before
removing the first); the secret needs to stay random and 32+ bytes.

### Option B: `livekit-server generate-keys`

If you have a `livekit-server` binary or the `livekit/livekit-server` Docker image on the
host, you can use its built-in generator:

```bash
docker run --rm livekit/livekit-server generate-keys
```

It prints a key/secret pair you can paste straight into `.env`. The `livekit-cli` tool
exposes the same generator via `livekit-cli create-token --print-keys`, but installing
`livekit-cli` purely to generate keys is overkill when `openssl` is already on the host.

### Put the values in `.env`

```env
LIVEKIT_API_KEY=meetropolis
LIVEKIT_API_SECRET=qV2c3...your-base64-secret...==
LIVEKIT_URL=wss://livekit.example.com
LIVEKIT_EXTERNAL_URL=wss://livekit.example.com
VITE_LIVEKIT_URL=wss://livekit.example.com
```

`LIVEKIT_URL` is what the application server resolves to internally; on a single host that
is typically the docker network address (`ws://livekit:7880`) and stays plain `ws://`
because the traffic never leaves the host. `LIVEKIT_EXTERNAL_URL` and `VITE_LIVEKIT_URL`
are what the browser connects to and must be `wss://` behind your TLS terminator.

The same key id and secret have to appear in two places: the `.env` file (which the
application server reads) and the `livekit.yaml` (which the LiveKit container reads). The
next section covers the config file.

Rotation: changing either value requires restarting both the `server` and the `livekit`
containers. Tokens minted with the old secret stay valid until they expire (10 minutes by
default), so plan a short maintenance window or pre-stage two key pairs in `livekit.yaml`
before flipping the application server.

## 3. The `livekit.yaml` config file

[`docs/livekit.yaml.example`](./livekit.yaml.example) ships a complete production-ready
template. Copy it to the repo root and edit:

```bash
cp docs/livekit.yaml.example livekit.yaml
$EDITOR livekit.yaml
```

Replace the placeholder under `keys:` with the same value pair you put in `.env`. LiveKit
does not expand `${LIVEKIT_API_SECRET}` from the surrounding environment; the YAML
contains literal values. That is a known constraint, not a bug. If you would rather not
have the secret on disk in clear, the alternative is to drop the `keys:` block from
`livekit.yaml` entirely and pass the pair via the upstream-supported environment variables
(`LIVEKIT_KEYS=<key>:<secret>`), which LiveKit reads on startup. Either approach is
acceptable; pick the one your secrets workflow can audit.

Beyond the keys, the template sets:

- `port: 7880` plus `bind_addresses: ['']` so the container listens on every interface and
  your reverse proxy decides what is exposed to the world.
- `rtc.tcp_port: 7881` and `rtc.udp_port: 7882` matching the compose port mappings.
- `rtc.use_external_ip: true` so LiveKit autodetects the public IPv4 to advertise in ICE
  candidates. Override with `rtc.external_ip: <addr>` when you run on a multi-homed host
  or behind a NAT that the autodetect cannot see through.
- `room.empty_timeout: 300` and `room.max_participants: 100` as conservative caps.
- `logging.level: info` (drop to `warn` once stable, see section 6).
- `prometheus.port: 9090` so metrics land on a known port for your scraper.
- A complete but disabled `turn:` block. Section 4 covers when to enable it.

### Wire `livekit.yaml` into the stack

Do not edit the shipped `compose.yaml` in place. Add a `compose.override.yaml` next to it
(it is `.gitignore`d and Docker Compose merges it automatically):

```yaml
# compose.override.yaml — production hardening for LiveKit.
services:
  livekit:
    command:
      - --config
      - /etc/livekit.yaml
      - --bind
      - 0.0.0.0
      - --node-ip
      - ${HOST_IP:-127.0.0.1}
    volumes:
      - ./livekit.yaml:/etc/livekit.yaml:ro
    ports:
      # Add Prometheus on top of the OSS defaults.
      - '127.0.0.1:9090:9090'
```

Notes on the snippet:

- The `--dev` flag is gone. LiveKit now reads everything (keys, ports, TURN, metrics) from
  the mounted config.
- `--bind 0.0.0.0` and `--node-ip` are preserved because the upstream image still respects
  those CLI flags for the listener and ICE-candidate IP.
- The Prometheus port is bound to `127.0.0.1` so only a local scraper or an
  ssh-tunnelled Grafana can reach it. Open it up only after you front the `:9090` endpoint
  with an allow-list.

Bring the stack up:

```bash
docker compose up -d --force-recreate livekit
docker compose logs --tail=50 livekit
```

The first line of the log must read `starting LiveKit server` without `in development
mode` next to it. If you still see `development mode`, the override did not merge; check
your file name (`compose.override.yaml`, not `docker-compose.override.yml`) and the
working directory.

## 4. ICE and NAT configuration

WebRTC connectivity is the part most self-hosters underestimate. Three deployment shapes
cover most installations.

### Shape A: single VM with a public IP, Docker on the host

The simplest layout. The host has one public IPv4, Docker listens on it directly, no
reverse proxy in front of LiveKit's UDP port.

```env
HOST_IP=203.0.113.42
# LK_NAT_1_TO_1_IPS=203.0.113.42/10.0.0.5    # only if Docker assigns a private NIC IP
```

In this shape `rtc.use_external_ip: true` (the template default) is enough. LiveKit
detects the public IPv4 via STUN and advertises it. `LK_NAT_1_TO_1_IPS` is only needed
when the container binds to a private address (for example on a cloud VM where the NIC
sees `10.0.0.5` and the public address sits on the cloud provider's load balancer); the
syntax is `<public-ip>/<private-ip>`.

Open the host firewall:

```bash
# ufw (Ubuntu / Debian)
sudo ufw allow 7880/tcp comment 'LiveKit signal'
sudo ufw allow 7881/tcp comment 'LiveKit RTC TCP fallback'
sudo ufw allow 7882/udp comment 'LiveKit RTC UDP'

# iptables (raw)
sudo iptables -A INPUT -p tcp --dport 7880 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 7881 -j ACCEPT
sudo iptables -A INPUT -p udp --dport 7882 -j ACCEPT
```

Production: put a TLS-terminating reverse proxy (Caddy, Traefik, nginx) in front of
`:7880` so the browser speaks `wss://`. The proxy listens on `:443`, forwards to the
LiveKit container, and you can drop the host firewall rule for `:7880` once the proxy is
the only entry point.

### Shape B: behind a load balancer that supports UDP

When LiveKit sits behind a load balancer (AWS NLB, GCP TCP/UDP LB, HAProxy with `mode
tcp`, nginx with `stream`), the LB must forward both TCP `:443` (or `:7880`) and UDP
`:7882` to the LiveKit container.

```yaml
# Caddyfile excerpt
livekit.example.com {
reverse_proxy livekit:7880
}
```

UDP forwarding is the part most teams forget. Caddy's HTTP server does not relay UDP;
either run a separate `layer4` plugin or pin the UDP forward directly on the LB. For
nginx, the relevant block lives in `stream { ... }`, not `http { ... }`:

```nginx
stream {
    server {
        listen 7882 udp reuseport;
        proxy_pass livekit_backend:7882;
    }
}
```

Set `rtc.use_external_ip: true` (default) and verify with the test in section 5 that
LiveKit advertises the LB's public IP, not the container IP.

### Shape C: behind CGNAT or a firewall that blocks inbound UDP

Some hosting environments give you no usable public UDP path at all (CGNAT on residential
gigabit, certain colo providers, K3s clusters without a UDP-capable ingress). The only
fix is TURN-over-TLS on `:5349/tcp`, which tunnels all media inside a TLS connection.

Enable LiveKit's built-in TURN by editing `livekit.yaml`:

```yaml
turn:
  enabled: true
  domain: turn.example.com
  tls_port: 5349
  udp_port: 3478
  external_tls: true # your reverse proxy terminates TLS; LiveKit speaks plain TCP behind it
```

Point a DNS A record `turn.example.com` at the host, terminate TLS for that hostname at
your reverse proxy (TCP passthrough on `:5349` with SNI = `turn.example.com`, or terminate
the certificate at the proxy and forward plain TCP to the LiveKit container), and open
ports:

```bash
sudo ufw allow 5349/tcp comment 'TURN over TLS'
sudo ufw allow 3478/tcp comment 'TURN over TCP'
sudo ufw allow 3478/udp comment 'STUN/TURN over UDP'
```

If you already operate a `coturn` install for other services, point LiveKit at it instead
of running both: leave `turn.enabled: false` in `livekit.yaml` and configure the external
TURN URL on the client. That path is out of scope for this guide; the upstream LiveKit
docs cover it.

## 5. Verification

After a `docker compose up -d --force-recreate livekit`, run the three checks below
before declaring the install ready.

### 5.1 The log line

```bash
docker compose logs livekit | grep 'starting LiveKit server'
```

Expected: a single line that does **not** contain `in development mode`. If it does, the
override did not apply; recheck section 3.

### 5.2 The HTTP smoke

```bash
curl -fsS http://localhost:7880
```

LiveKit responds with a short status string (typically `OK` or a JSON node-info blob,
depending on the version). The point is non-empty and HTTP 200. If you get connection
refused, the container is not listening; if you get HTTP 500, the config file is
malformed and the logs will say which line.

### 5.3 The end-to-end walk

Open two browser tabs (or two devices) in the seeded Meetropolis instance:

1. Log in as two different admin users.
2. Walk both avatars next to each other in the office map.
3. Confirm bidirectional audio.

If audio cuts out one-way only, the asymmetry usually traces to an ICE issue on the
direction that has the more restrictive NAT. Run `livekit-cli` against the room to see
ICE candidates for both peers:

```bash
docker run --rm -it --network host livekit/livekit-cli \
  room participants list \
  --url ws://localhost:7880 \
  --api-key "$LIVEKIT_API_KEY" \
  --api-secret "$LIVEKIT_API_SECRET" \
  --room office
```

The Inspect panel that the LiveKit React client renders in dev builds shows the same
information from the browser side. Look for `srflx` (server-reflexive, STUN worked) or
`relay` (TURN was needed) candidates on at least one side; `host`-only on both sides means
LiveKit thinks the peers are on the same LAN, which they usually are not in production.

## 6. Operational notes

### Key rotation

```bash
docker compose stop server livekit
# 1. Edit .env: new LIVEKIT_API_KEY and LIVEKIT_API_SECRET.
# 2. Edit livekit.yaml: add the new pair under `keys:` (leave the old pair for now).
docker compose up -d livekit
docker compose up -d server
# After the maintenance window, remove the old pair from livekit.yaml and reload.
docker compose restart livekit
```

Staging both pairs side by side means existing sessions with old tokens do not drop the
instant you flip the application server. Tokens default to a 10 minute lifetime, so 15
minutes overlap is plenty.

### Log levels

The template sets `logging.level: info`, which logs room create/join/leave plus warnings.
Once the install has been stable for a week, drop to `warn`:

```yaml
logging:
  level: warn
```

`debug` is useful when chasing a specific issue but produces enough volume to fill the
container's stdout buffer fast. Pair it with a log driver (`json-file` size limits, or
ship to your aggregation pipeline).

### Prometheus metrics

LiveKit exposes Prometheus metrics on `:9090/metrics` when the `prometheus.port` setting
is present. Useful series to alert on:

- `livekit_room_participants` — current concurrent participants per room. Sustained climb
  toward `room.max_participants` is the canary for capacity issues.
- `livekit_rooms` — current room count. Spikes after a deploy can indicate stuck rooms not
  hitting `empty_timeout`.
- `livekit_egress_*` — recording / RTMP egress counters. Only relevant if you use those
  features; otherwise expect zero traffic here.
- `livekit_packet_loss_*` — receive/send packet loss. Persistent loss on the send side
  points at upstream bandwidth, on the receive side at the participant's network.

Pull the metrics behind an allow-list (the `compose.override.yaml` above binds them to
`127.0.0.1`); the endpoint is unauthenticated.

### Clustering above one node

LiveKit supports a redis-backed multi-node deployment for scaling past one process. The
OSS Meetropolis instance caps at 25 concurrent users globally and a single LiveKit node
sits comfortably under that ceiling, so most self-hosters never need this. If you do scale
past a single node, the upstream docs at
<https://docs.livekit.io/home/self-hosting/distributed/> cover the redis topology, node
discovery and shared room state.

## 7. Where to go from here

- Upstream LiveKit self-hosting checklist:
  <https://docs.livekit.io/home/self-hosting/deployment/>
- LiveKit GitHub repository for upstream bugs (firewall traversal, codec issues, server
  crashes): <https://github.com/livekit/livekit>
- Meetropolis-side LiveKit integration code, in case you need to confirm how the
  application server signs tokens: [`apps/server/src/livekit.ts`](../apps/server/src/livekit.ts).

Issues that are clearly upstream LiveKit problems go to the LiveKit repo. Issues that are
about how the Meetropolis server, web client or compose stack wire LiveKit together go to
the Meetropolis tracker.
