# LiveKit self-host production hardening

The OSS `compose.yaml` targets **Linux Docker Engine**. LiveKit uses
`network_mode: host`: signalling, RTC, TURN and relay sockets listen directly
on the host. Do not add LiveKit `ports:` or `networks:`. Publishing a large
relay range through Docker creates thousands of forwarding rules and can
delay startup severely.

The getting-started command `--dev --bind 0.0.0.0` exposes unencrypted
signalling on all interfaces and disables TURN. Compose supplies your API key
pair through `LIVEKIT_KEYS`, so development mode uses the configured credentials.
Replace the broad listener and configure TURN before opening the deployment
to public users.

For local **Docker Desktop on macOS/Windows**, use
`docker compose -f compose.yaml -f compose.docker-desktop.yaml up -d`.
The overlay uses bridge networking with three published ports and `NODE_IP`
from `HOST_IP` (default `127.0.0.1`), without requiring Desktop's optional
host-network feature. TURN stays disabled. The production firewall model
below applies to Linux Docker Engine.

## 1. Generate matching credentials

`LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` in `.env` configure the application
server and LiveKit: Compose turns the same pair into `LIVEKIT_KEYS`, including
while `--dev` is active. Both values are required; the startup policy rejects
the public `devkey` / `secret` placeholders. Follow the README Quick Start for
all required credentials, including a non-template Postgres password and its
matching `DATABASE_URL`.

Choose a key identifier and generate a random secret of at least 32 characters:

```bash
openssl rand -base64 32
```

Put that pair in `.env`:

```env
LIVEKIT_API_KEY=meetropolis
LIVEKIT_API_SECRET=REPLACE_WITH_GENERATED_SECRET
LIVEKIT_URL=ws://host.docker.internal:7880
LIVEKIT_EXTERNAL_URL=wss://livekit.example.com
VITE_LIVEKIT_URL=wss://livekit.example.com
```

**Upgrade:** replace `LIVEKIT_URL=ws://livekit:7880` in existing `.env` files.
LiveKit no longer joins the Compose bridge. The shipped server maps
`host.docker.internal` to Docker's host gateway through `extra_hosts`.
Browser-facing `LIVEKIT_EXTERNAL_URL` and `VITE_LIVEKIT_URL` must remain
reachable by clients. Rebuild the web image after changing `VITE_*`.

LiveKit does not expand `${LIVEKIT_API_SECRET}` in a mounted YAML file and
does not read `LK_*` environment variables. Configure RTC/NAT in the file.
`LIVEKIT_KEYS` accepts a YAML mapping of key identifiers to secrets. The shipped
Compose file supplies it from the application's pair. This environment mapping
**replaces** the entire `keys:` map in a mounted file. Use one effective source:
either `LIVEKIT_KEYS` for a single pair or the mounted file for multiple pairs.
Double quotes, backslashes and line breaks are not supported inside the pair
interpolated by Compose; the README's hexadecimal generation avoids them.
Keep secrets out of version control.

## 2. Mount a production config

Copy the companion template and replace the host-gateway placeholder. For the
default environment-based pair, remove its `keys:` block. For a file-based
pair or rotation, replace that block's placeholders and remove `LIVEKIT_KEYS`
from the service as shown below:

```bash
cp docs/livekit.yaml.example livekit.yaml
docker run --rm --network none --add-host lk-hostgw:host-gateway \
  --entrypoint cat postgres:16-alpine /etc/hosts | grep lk-hostgw
```

Put the returned IPv4 address in `bind_addresses` alongside `127.0.0.1`.
This binds **signalling only** to loopback and Docker's host gateway instead
of public interfaces. RTC TCP listens on all interfaces and RTC UDP on local
addresses independently of that setting; configure the host firewall below.

The template sets `rtc.use_external_ip: true` for public-address discovery and
`rtc.require_ipv4: true`. IPv4 STUN is needed on dual-stack hosts: TURN bound
to `0.0.0.0` requires an IPv4 node address, which IPv6-only discovery cannot
provide. If discovery cannot determine a static public address, disable STUN
discovery and set an IPv4 literal together:

```yaml
rtc:
  use_external_ip: false
  node_ip: 203.0.113.42
  require_ipv4: true
```

The address is an example. Validate your configured address as IPv4, for example
with `python3 -c 'import ipaddress,sys; ipaddress.IPv4Address(sys.argv[1])' <address>`,
and verify the resulting ICE candidates. Setting `node_ip` while leaving
`use_external_ip: true` still requires successful STUN discovery.

Create an uncommitted `compose.override.yaml` (automatically loaded by Compose):

```yaml
services:
  livekit:
    command:
      - --config
      - /etc/livekit.yaml
    volumes:
      - ./livekit.yaml:/etc/livekit.yaml:ro
```

The command replaces `--dev` and the broad `--bind` flag. Host networking is
inherited; no port publications are needed, including for relay sockets.
If optional metrics on `9090` are enabled, restrict that host port with the
firewall first; the endpoint is unauthenticated.

Every container that connects to LiveKit needs this mapping. The shipped
server already has it; add it to your proxy and any optional NPC service:

```yaml
services:
  proxy:
    extra_hosts:
      - host.docker.internal:host-gateway
```

With Traefik's Docker provider this mapping must be on the **Traefik container
itself**, including for TURN TCP routing. Otherwise discovery can fall back to
Traefik's own loopback. `traefik.docker.network` has no effect on host-network
containers. See
[`compose.override.traefik.yaml.example`](../compose.override.traefik.yaml.example)
for signalling labels and optional TURN/TLS labels.

## 3. ICE, NAT and host firewall

### Shape A: single Linux host with a public IPv4

LiveKit advertises its public address through `rtc.use_external_ip: true`.
A TLS proxy fronts signalling and TURN/TLS; RTC and TURN UDP use the host
directly. Host-network traffic passes through the host's INPUT firewall,
including ufw. Allow public media **and container-to-host access** to
signalling and the TURN TCP backend.

Find every source subnet used by application and proxy containers:

```bash
docker network ls
docker network inspect <application-network> <proxy-network> \
  --format '{{.Name}} {{range .IPAM.Config}}{{.Subnet}} {{end}}'
```

Identify the public interface and Docker bridge interfaces with `ip -4 -o addr`
and `ip -o link`. Docker bridge names are commonly `br-` plus the first twelve
characters of the network ID; a network can also set an explicit bridge name.
Do not assume a bridge name or address from this guide.

All assignments below are **examples**. Replace the interfaces, source subnets
and destination addresses with actual values; repeat the container rules for
every required source network. The host gateway is the destination and need not
be in the containers' source subnet. Preserve management access such as SSH,
use a default-deny incoming policy, and remove older public allow rules for
`7880/tcp`, `5349/tcp` and optional metrics:

```bash
PUBLIC_IF=eth0
PUBLIC_IP=203.0.113.42
APP_IF=br-app
APP_SUBNET=172.20.0.0/16
PROXY_IF=br-proxy
PROXY_SUBNET=172.21.0.0/16
HOST_GATEWAY=172.17.0.1
sudo ufw allow in on "$PUBLIC_IF" proto tcp from any to "$PUBLIC_IP" port 443 comment 'TLS proxy'
sudo ufw allow in on "$PUBLIC_IF" proto tcp from any to "$PUBLIC_IP" port 7881 comment 'RTC TCP'
sudo ufw allow in on "$PUBLIC_IF" proto udp from any to "$PUBLIC_IP" port 7882 comment 'RTC UDP'
# When TURN is enabled with the template range:
sudo ufw allow in on "$PUBLIC_IF" proto udp from any to "$PUBLIC_IP" port 3478 comment 'TURN UDP'
sudo ufw allow in on "$PUBLIC_IF" proto udp from any to "$PUBLIC_IP" port 30000:40000 comment 'TURN relay'
sudo ufw allow in on "$APP_IF" proto tcp from "$APP_SUBNET" to "$HOST_GATEWAY" port 7880 comment 'App to signal'
sudo ufw allow in on "$PROXY_IF" proto tcp from "$PROXY_SUBNET" to "$HOST_GATEWAY" port 7880 comment 'Proxy to signal'
sudo ufw allow in on "$PROXY_IF" proto tcp from "$PROXY_SUBNET" to "$HOST_GATEWAY" port 5349 comment 'Proxy to TURN'
```

UFW normally permits loopback; preserve that permission for host-native proxies.
If NPC clients publish media from a bridge network, also permit their actual
source subnet/interface to the required host RTC ports. A scraper needs its own
source/interface/destination rule before metrics are enabled.

These INPUT rules cover **host-network LiveKit**, not Docker's published
Postgres, server or web ports. Docker publications can bypass UFW INPUT rules
through forwarding/DNAT. Protect them separately using Docker's supported
firewall integration, or remove/restrict the publications. For example, for a
host-native reverse proxy (Compose 2.24.4+ for `!override`):

```yaml
services:
  db:
    ports: !reset []
  server:
    ports: !override ['127.0.0.1:2567:2567']
  web:
    ports: !override ['127.0.0.1:5173:5173']
```

A container proxy on the app network can instead reset all three publications
and reach server/web on their bridge addresses. Keep its host-gateway mapping
for LiveKit. Verify exposure from outside the host after applying your rules.

A host-native signalling proxy can use `127.0.0.1:7880`; a container proxy
uses `host.docker.internal:7880`. Do not publicly allow unencrypted signalling.
For example, this containerized Caddy block handles **HTTP(S) signalling and
WebSockets only**, not TURN/TLS:

```caddyfile
livekit.example.com {
	reverse_proxy host.docker.internal:7880
}
```

### Shape B: behind a load balancer with UDP support

Forward signalling TCP and RTC TCP/UDP to the corresponding host ports. For
TURN also forward public `443/tcp` to the TLS terminator, `3478/udp` and the
configured relay UDP range. Verify that ICE candidates advertise an address
clients can reach. HTTP proxies do not forward RTC UDP; use the load
balancer's UDP capability or a separate transport proxy.

### Shape C: restrictive client networks or CGNAT

TURN/TLS on public `443/tcp` provides a fallback when client firewalls block
UDP. It still requires a publicly reachable relay host and relay UDP ports;
it cannot make a server behind CGNAT publicly reachable by itself.

Enable TURN in `livekit.yaml`:

```yaml
turn:
  enabled: true
  domain: turn.example.com
  bind_addresses: ['0.0.0.0']
  tls_port: 5349
  udp_port: 3478
  external_tls: true
  relay_range_start: 30000
  relay_range_end: 40000
```

Point the TURN hostname's DNS A record at the public host. LiveKit advertises
`turns:turn.example.com:443?transport=tcp`, regardless of the local `tls_port`.
Terminate TLS at the TCP proxy on **public 443**, route by SNI, and forward
**plain TCP** to host `5349`. Set `external_tls: true` because the proxy holds
the certificate. This requires TLS termination, not passthrough to the backend.
Signalling and TURN/TLS can share public 443 through distinct hostnames.

### Operation without Traefik

An HTTP reverse proxy is sufficient for signalling, but TURN/TLS needs a
TCP/TLS proxy with SNI routing or LiveKit's own TLS terminator on public 443.
A regular Caddy HTTP `reverse_proxy` does not relay TURN. Choose one complete
topology; do not start two listeners on the same public address and port.

For a host-native example, HAProxy can own public 443, terminate TLS for both
hostnames and forward decrypted signalling to a loopback-only Caddy HTTP proxy.
The TURN hostname goes directly to LiveKit's plain TCP backend. Install a PEM
certificate/key for each hostname in the proxy's certificate directory:

```haproxy
defaults
    mode tcp
    timeout connect 5s
    timeout client 1h
    timeout server 1h

frontend livekit_tls
    bind :443 ssl crt /etc/haproxy/certs/
    tcp-request content reject unless { ssl_fc_sni -i livekit.example.com turn.example.com }
    use_backend livekit_turn if { ssl_fc_sni -i turn.example.com }
    default_backend livekit_signal

backend livekit_signal
    server signal 127.0.0.1:18080

backend livekit_turn
    server turn 127.0.0.1:5349
```

The companion Caddy listener is internal plain HTTP, since HAProxy has already
terminated TLS. Caddy forwards WebSockets through `reverse_proxy`:

```caddyfile
http://:18080 {
	bind 127.0.0.1
	reverse_proxy 127.0.0.1:7880
}
```

Use `turn.external_tls: true` and `turn.tls_port: 5349` with that topology.
Point both DNS names at the proxy, permit public 443 plus RTC/TURN UDP and
relay ports, and keep 7880/5349/18080 private. Existing application HTTP(S)
listeners on 443 must also move behind the SNI frontend or use a different
public address. For containerized proxies, replace loopback backends with the
correct service address or `host.docker.internal`, provide the host-gateway
mapping, and apply the container-source firewall rules above.

Alternatively, give TURN its own public address with port 443 available and let
LiveKit terminate TLS there: set `turn.external_tls: false`, `turn.tls_port: 443`,
and mount its `cert_file` and `key_file`. On a shared host set
`turn.bind_addresses` to that dedicated, host-assigned IPv4 address instead
of `0.0.0.0`; alternatively use a separate host. Keep `turn.domain` pointing at
the TURN address. The signalling HTTP proxy must listen on a different address/host;
TURN cannot share that public socket with an unrelated HTTP listener. Permit
public 443 to LiveKit in this topology instead of exposing a plain TCP backend.

`turn.bind_addresses` controls both UDP and the TCP backend. With `0.0.0.0`
and `external_tls: true`, `5349/tcp` is an authenticated but unencrypted
TURN/TCP listener on the host. It uses the same authentication as TURN/UDP,
is not advertised, and must be restricted to proxy sources with the firewall.
Relay sockets open per allocation within the range; allow the full range
rather than publishing it through Docker.

## 4. Verification

```bash
docker compose up -d --force-recreate livekit server
docker compose logs --tail=50 livekit
curl -fsS http://127.0.0.1:7880/
docker compose exec server curl -fsS http://host.docker.internal:7880/
```

Expect LiveKit's start log without development mode and HTTP 200 `OK` from
both HTTP checks. Test public `wss://` and TURN/TLS separately. Log in with two
users, bring their avatars together, and verify bidirectional audio and video.
Inspect selected ICE transports from a restrictive client network to prove
TURN fallback; healthy HTTP alone does not prove WebRTC or TURN connectivity.

On Docker Desktop, use the same `-f` files for every Compose command. If
`7880` is occupied, set `LIVEKIT_SIGNAL_PORT` and match `LIVEKIT_URL` to
`ws://host.docker.internal:<published-port>`; update browser-facing URLs too.
`HOST_IP` controls `NODE_IP` in the overlay. Recreate after environment changes.

## 5. Operations

For key rotation, use the mounted file as the sole key source. Add both old and
new pairs to its `keys:` map and explicitly remove the inherited environment
mapping in `compose.override.yaml` (requires Compose 2.24.0 or newer):

```yaml
services:
  livekit:
    command: ['--config', '/etc/livekit.yaml']
    environment:
      LIVEKIT_KEYS: !reset null
    volumes:
      - ./livekit.yaml:/etc/livekit.yaml:ro
```

Recreate LiveKit with both pairs before changing the application's pair in
`.env` and recreating the server. Use SDK requests signed with each pair to
verify that both are accepted. After all issued tokens have expired, remove
the old pair from the file and recreate LiveKit again. The application token
lifetime defaults to fifteen minutes (`LIVEKIT_TOKEN_TTL_SECONDS` can change
it); account for that configured lifetime. Existing tokens remain valid only
while their signing key remains configured. Do not restore `LIVEKIT_KEYS`
during this process: it would replace the two-key file map.

Use `logging.level: info` for initial verification and `warn` once stable.
Keep the Compose log size limits or ship logs to your logging service. If
metrics are enabled, allow only scraper sources through the host firewall.
Compose port mappings cannot restrict host-network listeners.

For multi-node setups see the upstream
[distributed deployment guide](https://docs.livekit.io/home/self-hosting/distributed/).
The OSS app has a separate 25-user global cap. Review the upstream
[deployment checklist](https://docs.livekit.io/home/self-hosting/deployment/)
and [LiveKit repository](https://github.com/livekit/livekit) for server-specific
operations. Meetropolis signs tokens in
[`apps/server/src/livekit.ts`](../apps/server/src/livekit.ts).
