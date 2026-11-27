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
provide. Configure `rtc.node_ip` explicitly if discovery cannot determine the
public address, then verify the ICE candidates.

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

The subnet `172.20.0.0/16` below is an **example**. Replace it and repeat the
container rules for every actual source subnet. The host-gateway bind address
is the destination; it need not be in the containers' source subnet. Use a
default-deny incoming policy, preserve management access such as SSH, and
remove older public allow rules for `7880/tcp`, `5349/tcp` and optional metrics
before exposing the host:

```bash
sudo ufw allow 443/tcp comment 'TLS proxy for signal and TURN'
sudo ufw allow 7881/tcp comment 'LiveKit RTC TCP fallback'
sudo ufw allow 7882/udp comment 'LiveKit RTC UDP'
# When TURN is enabled with the template range:
sudo ufw allow 3478/udp comment 'TURN UDP'
sudo ufw allow 30000:40000/udp comment 'TURN relay range'
sudo ufw allow from 172.20.0.0/16 to any port 7880 proto tcp comment 'Containers to signal'
sudo ufw allow from 172.20.0.0/16 to any port 5349 proto tcp comment 'Proxy to TURN backend'
```

A host-native signalling proxy can use `127.0.0.1:7880`; a container proxy
uses `host.docker.internal:7880`. Do not publicly allow unencrypted signalling.
For example, with a containerized Caddy:

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
