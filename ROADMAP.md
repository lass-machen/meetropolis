# Meetropolis Roadmap

This is a snapshot of where the project is heading. It is not a contract —
priorities shift as we learn more from real-world deployments and from the
community. The authoritative ticket-level view lives in the [GitHub
Projects board](https://github.com/lass-machen/meetropolis/projects).

If a feature you care about is not on this list, open a
[Discussion](https://github.com/lass-machen/meetropolis/discussions). We
read every one.

## Now — v0.1 (initial open-source release, 2026 Q2)

The "ship it and start learning" milestone. Everything in this list is
implemented and in the codebase; this section is mainly here so newcomers
can see what they get when they clone `main`.

- Spatial-audio virtual office with proximity-based conversations
  (LiveKit + Colyseus).
- 2D top-down game world rendered with Phaser 4, including a built-in
  map editor with autotile support.
- Multi-character avatars with directional walk animations.
- Zone-based audio privacy and capacity limits.
- Scripted NPC subsystem (audio playback + scripted movement) via a
  separate `npc-service` microservice.
- Single-tenant deployment via `docker compose`, with a hard 25-user
  concurrency cap that defines the boundary between the OSS edition and
  the commercial edition.
- Tauri-based desktop wrapper available separately from Tiamat (not part
  of this OSS repository).

## Next — v0.2 (Q3 2026, indicative)

The "make it pleasant to self-host" milestone.

- **Hand-drawn character sprites** to replace the procedural set in
  [`tools/sprite-generator/`](tools/sprite-generator/). The procedural
  sprites are functional but uniform; a commissioned pixel artist would
  give each office worker visible personality.
- **Helm chart** for Kubernetes self-hosters, published to a public OCI
  registry.
- **Reverse-proxy guides** for Caddy, nginx, and Traefik — including the
  WebSocket pass-through configuration that today is easy to get wrong.
- **OpenTelemetry exporters** for first-class Prometheus + OTLP support.
- **LiveKit production hardening**: drop the `--dev` flag from production
  compose files, document a real TURN-server configuration, expand the
  UDP port range beyond the current single port.
- **Backup/restore documentation** with Postgres-dump + asset-pack export
  examples.

## Then — v0.3 (Q4 2026, indicative)

The "scale and reliability" milestone.

- LiveKit `ConnectionQuality` wiring restored so adaptive bitrate actually
  takes effect.
- NPC service gets reconnect logic on top of its current Colyseus
  reconnect-only behavior.
- Stats loop (`apps/web/src/av/core/stats.ts`) extended to populate the
  currently-empty RTT / jitter / bitrate histograms.
- First-class horizontal scaling story (multiple server instances behind
  Redis presence).
- One-click deployments on Railway, Render, Coolify, Dokploy.

## Eventually

These are explicitly long-term and may not happen in the order listed. We
mention them so contributors interested in any of them know they are on
our radar.

- Native mobile clients for iOS and Android (today only the iOS debug
  client exists, and it is internal).
- Map import/export interoperability with Tiled (`.tmx`) and similar
  formats.
- Plugin API for third-party in-world widgets.
- Self-hostable demo recorder for marketing/onboarding videos.

## Out of scope

This roadmap deliberately does NOT include:

- A drop-in Slack or Discord replacement. Meetropolis is a virtual
  office, not a chat platform; chat is intentionally minimal and we have
  no plans to grow it into a Slack competitor.
- A turn-key meeting recording system. Recording is doable with LiveKit
  Egress in your own infrastructure; we will not bundle managed
  recording into the OSS edition.
- Multi-tenant orchestration, Stripe billing, SSO/SAML/SCIM, and audit
  logging — these live in the (non-OSS) Enterprise module. The split is
  intentional; see [LICENSING.md](LICENSING.md).

## Want to influence the roadmap?

- File a [feature request](https://github.com/lass-machen/meetropolis/issues/new?template=feature_request.yml).
- Comment on the [Discussions board](https://github.com/lass-machen/meetropolis/discussions).
- Contribute a pull request that explores an item; concrete PRs almost
  always re-order priorities faster than wish-lists do.

## Why these dates are indicative

We do not block community work on date milestones, and we will not ship
broken code just to hit a quarter. The dates in this document exist to
signal direction and rough sequencing, not deadlines. The CHANGELOG is
the authoritative record of what actually shipped when.
