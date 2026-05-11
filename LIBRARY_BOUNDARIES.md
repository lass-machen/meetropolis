# Library Boundaries

How Meetropolis deals with the type-unsafe edges of third-party libraries,
runtime globals, and optional submodules — and how to keep contributions
clean as the project grows.

## Why this document exists

`strict` TypeScript and the `@typescript-eslint/no-unsafe-*` rules give us a
safety net throughout the codebase. But every TypeScript project has a few
places where the type system genuinely runs out of road:

- A library exposes useful behaviour only through private fields
  (`room.engine.signalClient.ws`).
- A web API requires monkey-patching a global (`globalThis.WebSocket`).
- A worklet runs in a context where the standard DOM lib is not loaded
  (`AudioWorkletGlobalScope`).
- An optional submodule must be loaded via dynamic `import()` so it can be
  absent in OSS builds.

We do not want to disable the unsafe-\* rules globally — that would let real
tech-debt hide. We also do not want a wall of `eslint-disable-next-line`
comments that scatter the rationale across the codebase. So we adopt a layered
strategy: prefer wrappers, fall back to module augmentation, fall back to
file-scoped overrides, and only as a last resort write inline disables with
a written reason.

This document is the contract. Read it before adding any `as any` or
`@typescript-eslint/...` disable to the code.

## The four patterns, in order of preference

### 1. Narrow wrapper types (preferred)

When a library's published types are too loose, write a small interface that
captures the shape we actually need, then cast at the import boundary. The
rest of the codebase consumes the wrapper, not the original type.

Example: `apps/web/src/types/livekit.ts` defines `TrackLike`,
`TrackPublicationLike`, `ParticipantLike`, plus accessors like
`listPublications(participant)` and `readPubSource(pub)`. Code that needs to
inspect a LiveKit participant's tracks uses these helpers instead of casting
each call site.

When to use: you are touching the same library type in more than one place
and would otherwise repeat the same cast.

### 2. Declaration merging / module augmentation

When the missing type is on a known interface (the global `Window`,
`import.meta.env`, or a third-party's exported interface), augment the
declaration once and let TypeScript pick it up everywhere.

Examples:

- `apps/web/src/vite-env.d.ts` augments `ImportMetaEnv` with every `VITE_*`
  variable the project uses. Adding a new env var means adding a line here.
- `apps/web/src/types/global.d.ts` augments `Window` with every property
  the codebase sets (e.g. `__corrSessionId`, `__avDebugOn`, `desktop`,
  `__MEETROPOLIS_API_BASE__`). Adding a new window property means adding a
  line here.
- `apps/server/src/types/express.d.ts` augments Express's `Request` with the
  correlation id.

When to use: the property lives on a standard runtime surface (Window,
ImportMeta, Request, Response) that everyone already imports.

### 3. Boundary helper functions

When the boundary involves runtime checks (type guards, defensive reads),
encapsulate the unsafe logic inside a helper that returns a clean type.

Examples:

- `apps/web/src/types/livekit.ts` exports `listPublications(participant)` —
  it inspects `participant.trackPublications` (loosely typed Map in some
  LiveKit versions) and returns a strongly-typed array.
- `apps/web/src/types/colyseus.ts` mirrors the server's `WorldRoomState`
  schema so the client treats Colyseus state as typed data instead of casting
  per-message.

When to use: the boundary needs runtime validation (e.g. `instanceof`,
`'field' in obj`, null checks) on top of a type cast.

### 4. File-scoped ESLint override (used sparingly)

A handful of files are inherently unsafe by design. They reach into library
internals, monkey-patch globals, or run in a non-standard runtime context.
For these we silence the `no-unsafe-*` and `no-explicit-any` rules at the file
level via `eslint.config.mjs` overrides.

This is **only** for files whose entire purpose is the boundary translation.
A new file does not qualify just because the author finds typing
inconvenient.

Current file-scoped overrides:

| File                                                  | Reason                                                                                                                                          |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/av/core/SignalMonitor.ts`               | Reads private LiveKit fields (`room.engine.signalClient.ws`) to detect stale signaling connections. Public API lacks an equivalent.             |
| `apps/web/src/lib/patchWebSocket.ts`                  | Monkey-patches `globalThis.WebSocket` to work around a WKWebView (Safari/Tauri) handshake bug.                                                  |
| `apps/web/src/av/audio/worklets/rnnoise-processor.ts` | Runs inside `AudioWorkletGlobalScope`. Standard DOM lib is unavailable; `sampleRate` and `AudioWorkletProcessor` come from the worklet runtime. |

If you believe a new file needs to join this list, open a discussion. The
default answer is no — try patterns 1, 2, or 3 first.

### 5. Per-line ESLint disable (last resort)

If a single line in an otherwise-clean file legitimately needs to use `any`
or read an unsafe value, you may write:

```ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- reason
```

The comment **must** include a `--` followed by the rationale. A bare
`eslint-disable-next-line` without a reason is rejected by the ESLint config
(via `@eslint-community/eslint-plugin-eslint-comments`, rule
`require-description`).

Examples of acceptable rationales:

- `-- LiveKit engine.client is private; public API lacks the WS handle`
- `-- AudioWorklet sampleRate is provided by the worklet global scope`
- `-- Vendor lib types are missing for this version, see issue #123`

Examples of unacceptable rationales:

- `-- needed`
- `-- fix later`
- (no comment at all)

## What counts as "overlooked tech-debt"

The default lint-stats baseline is the upper bound we are willing to ship.
Several past sweeps removed casts that looked like boundary work but were
actually overlooked tech-debt. The clear signs:

- The thing being cast already has a proper type elsewhere in the codebase
  (`gameBridge` has `GameBridge` in `apps/web/src/types/game.ts`).
- The boundary is to our own code (a class we wrote, a JSON shape we control).
- The cast is to silence a single property access where a 3-line interface
  would have worked.

If you find yourself writing `as any` because typing the right interface
would take more than fifteen minutes, write the interface anyway. The
cumulative cost of casts dwarfs the cost of typing.

## The lint-stats baseline

`scripts/lint-stats.cjs` aggregates all ESLint warnings per rule and compares
the result against the committed `lint-stats.json`. The CI gate fails any PR
that increases the count for any rule.

To run locally:

```bash
node scripts/lint-stats.cjs           # check current state vs baseline
node scripts/lint-stats.cjs --update  # rewrite baseline (commit alongside)
node scripts/lint-stats.cjs --json    # machine-readable summary
```

You should only need `--update` when you have legitimately reduced warnings
(commit the smaller baseline) or when a refactor has moved boundary code into
one of the override files (warning counts shift between rules).

Adding new warnings is allowed when there is no other reasonable option —
but you must update the baseline in the same PR and document why in the PR
description.

## Adding new external libraries

When introducing a new dependency:

1. Read its public types first. If they are strict, you have no boundary
   work to do.
2. If they are loose (lots of `any`, missing fields), draft a wrapper module
   under `apps/web/src/types/<libname>.ts` or `apps/server/src/types/<libname>.ts`.
3. Decide whether the friction is concentrated in one file (declare-module
   augmentation in a shared `.d.ts`) or scattered (narrow wrappers + helper
   functions).
4. Only after exhausting 1-3 do you reach for a file-scoped override or
   inline disable.

## Active adapter files (reference)

These files exist solely to give the rest of the codebase a clean type
surface. Do not delete them, and do not duplicate their patterns elsewhere.

Web:

- `apps/web/src/vite-env.d.ts` — `ImportMetaEnv` augmentation
- `apps/web/src/types/global.d.ts` — `Window` augmentation
- `apps/web/src/types/colyseus.ts` — Colyseus schema mirror + message types
- `apps/web/src/types/livekit.ts` — LiveKit narrow wrappers + helpers
- `apps/web/src/types/av.ts` — AVManager interface
- `apps/web/src/types/game.ts` — GameBridge contract + game data shapes
- `apps/web/src/types/assetPack.ts` — Asset pack JSON schema
- `apps/web/src/game/types/scene.ts` — Phaser scene shape adapters

Server:

- `apps/server/src/types/express.d.ts` — Request augmentation
- `apps/server/src/types/shims.d.ts` — Typed shims for vendor libs
- `apps/server/src/types/multer.ts` — Multer request shapes
- `apps/server/src/types/authShapes.ts` — Cookie / token parsing
- `apps/server/src/types/assetPack.ts` — Asset pack JSON schema (mirror)

If you change the public type surface in any of these, run the test suite
and `node scripts/lint-stats.cjs` before opening a PR.
