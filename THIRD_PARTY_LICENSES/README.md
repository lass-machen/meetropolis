# Third-Party License Texts

This directory contains the verbatim license texts of every open-source
license that applies to dependencies bundled with Meetropolis. Including
these texts is how we satisfy the redistribution clauses of permissive
licenses (notably Apache-2.0 §4(a) which requires recipients to receive a
copy of the License, and BSD/ISC which require the license to travel with
the binary).

Attributions to individual upstream projects (copyright lines, NOTICE-file
contents) live in the repository's top-level [`NOTICE`](../NOTICE) file.
This directory contains only the **license texts** themselves.

## File ↔ license mapping

| File                | SPDX identifier | Source                                    |
| ------------------- | --------------- | ----------------------------------------- |
| `Apache-2.0.txt`    | Apache-2.0      | <https://spdx.org/licenses/Apache-2.0>    |
| `MIT.txt`           | MIT             | <https://spdx.org/licenses/MIT>           |
| `BSD-2-Clause.txt`  | BSD-2-Clause    | <https://spdx.org/licenses/BSD-2-Clause>  |
| `BSD-3-Clause.txt`  | BSD-3-Clause    | <https://spdx.org/licenses/BSD-3-Clause>  |
| `ISC.txt`           | ISC             | <https://spdx.org/licenses/ISC>           |
| `0BSD.txt`          | 0BSD            | <https://spdx.org/licenses/0BSD>          |
| `Zlib.txt`          | Zlib            | <https://spdx.org/licenses/Zlib>          |
| `BlueOak-1.0.0.txt` | BlueOak-1.0.0   | <https://spdx.org/licenses/BlueOak-1.0.0> |

The texts are unmodified from the SPDX license list (May 2026 snapshot).

In addition, this directory contains one project-specific license text
for the bundled art assets:

| File                   | SPDX identifier | Source                                                           |
| ---------------------- | --------------- | ---------------------------------------------------------------- |
| `MIT-pixel-agents.txt` | MIT             | <https://github.com/pablodelucca/pixel-agents/blob/main/LICENSE> |

## Which dependency uses which license?

A representative — not exhaustive — list of dependencies grouped by license:

### Apache-2.0

`@prisma/client`, `@prisma/adapter-pg`, `@prisma/engines`, `livekit-server-sdk`,
`livekit-client`, `@livekit/rtc-node`, `@livekit/protocol`, `@livekit/mutex`,
`@bufbuild/protobuf` (dual with BSD-3-Clause), `prom-client`, `typescript`,
`@opentelemetry/*`, `import-in-the-middle`.

`import-in-the-middle` ships its own NOTICE; the relevant attribution is
reproduced in the top-level `NOTICE`.

### MIT

Far too many to enumerate; the long tail of the dependency tree is MIT.
Notable: `react`, `react-dom`, `@radix-ui/*`, `phaser`, `i18next`,
`react-i18next`, `vite`, `vitest`,
`express`, `cookie-parser`, `cors`, `helmet`, `compression`, `pino`, `zod`,
`stripe`, `@colyseus/*`, `lucide-react` (ISC, treated as MIT-equivalent
permissive), `pg`, `multer`, `jsonwebtoken`, `c12`, `effect`, `empathic`,
`fast-check`, `jiti`, `pathe`, `pure-rand`, `unzipper`.

### BSD-2-Clause

`dotenv`.

### BSD-3-Clause

`bcryptjs`, `deepmerge-ts`, `qs`, `secure-json-parse`, `webrtc-adapter` (web).
Also the BSD-3-Clause portion of dual-licensed `@bufbuild/protobuf` and the
embedded Google WebRTC C++ inside `@livekit/rtc-ffi-bindings`.

### ISC

`rimraf`, `once`, several smaller utilities.

### 0BSD

`tslib`.

### Zlib

The Zlib portion of the dual-licensed `pako` package (the MIT portion is
the primary license).

### BlueOak-1.0.0

`lru-cache`, `minimatch` (recent versions).

## Dual-licensed dependencies (license chosen)

- **`jszip`** is offered under `MIT OR GPL-3.0-or-later`. We use it under
  the **MIT** option.
- **`@bufbuild/protobuf`** is `(Apache-2.0 AND BSD-3-Clause)` — both texts
  apply simultaneously; both are reproduced in this directory.
- **`pako`** is `(MIT AND Zlib)` — both texts apply simultaneously.

## How to regenerate this file

If new dependencies are added with previously-unused license types, drop a
fresh SPDX text into this directory and add a row to the table above.
`spdx-license-list-data` on npm exposes the canonical SPDX corpus
programmatically if you want to script this. The tool `license-checker`
(npm) is also useful for an audit pass over the lockfile.

## What is intentionally NOT here

- License texts for our own components (`/LICENSE`, `apps/web/LICENSE`,
  `packages/shared/LICENSE`) — those live at their canonical paths.
- License texts for the optional private submodules (`packages/brand`,
  `packages/desktop`, `packages/tenancy-enterprise`) — those are not
  redistributed with the OSS package.
- Trademark policy — see [`../TRADEMARKS.md`](../TRADEMARKS.md).
