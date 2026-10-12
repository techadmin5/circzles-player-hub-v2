# Frontend build boundary correction

The failing submission preview imported AdminSubmissionDto from backend/src/domain/adminSubmissions.ts. Type-only imports still enter the TypeScript compilation graph, so Next.js also loaded the database schema and Cloudinary implementation. A root-only installation cannot resolve those backend packages. tsconfig exclude cannot protect against imported files.

## Fix and contract synchronization

- src/types/adminSubmissions.ts contains the frontend JSON contract, preserving IDs/status, player/puzzle data, video metadata, maximum time, review history and optional/null fields. Review createdAt is a JSON string, not the backend Date object.
- backend/tests/frontendContracts.test.ts requires exact type equality between the frontend DTO and the recursively JSON-serialized backend DTO during backend typecheck. Changing either contract without synchronizing the other fails compilation.
- Catalog identity functions/types moved unchanged to dependency-free shared/catalogIdentity.mjs and shared/catalogIdentity.d.mts. Both browser previews and backend catalog/import/repair consume the same implementation. The backend source module re-exports it, preserving existing imports and build output entry points. The compiled backend runtime was checked resolving this shared module.
- All frontend imports into backend implementation modules were removed, including catalog UI, API client, import wizard and test imports.
- Frontend regression tests inspect the actual TypeScript source graph and frontend/shared imports, failing if backend implementation or backend dependencies enter the frontend build.
- Only backend test rootDir was widened for the type-only cross-contract check. Backend production build configuration, frontend strict checking, and submission/catalog business rules remain unchanged. No frontend backend-only dependencies were added.

## Clean checkout validation

A separate temporary clone outside the workspace dependency tree was installed from the unchanged root package-lock.json, with no backend/node_modules. The original commit reproduced TS2307 for drizzle-orm/cloudinary and downstream TS7006 errors after successful Next.js compilation. The fix was applied to the isolated checkout and baseline .next output was removed.

The fixed clean root-only checkout passed npm run build (45 generated pages), npx tsc --noEmit, npm run lint, and npm test (206 passing tests). Backend build, typecheck, lint and npm test -- --maxWorkers=2 passed (926 tests across 48 files). git diff --check passed. No database, Cloudinary, production deployment or merge operation was performed. The existing workspace next-env.d.ts edit was preserved.

Local npm 12.0.2 defaults to blocking remote-package fetches. The repository already pins SheetJS to its CDN tarball; the clean install used npm ci --allow-remote=root for this invocation only. No npm settings or lockfiles were changed. npm also reported blocked esbuild/unrs-resolver postinstall scripts and an ESLint deprecation notice; build, typecheck, lint and tests nevertheless passed with that installation.

## Separate npm audit report (2026-10-12)

The unchanged frontend lockfile reports 8 high and 1 critical vulnerable packages. This is a separate dependency remediation task; no npm audit fix, forced upgrade, or version change was performed.

| Package | Installed version(s) | Severity | Source |
| --- | --- | --- | --- |
| next | 16.3.4 | Critical | Multiple advisories, including [Node ImageResponse RCE](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j) |
| brace-expansion | 5.0.9, 1.1.18 | High | [Expansion DoS](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr), plus recursion advisories |
| braces | 3.0.3 | High | [Nested-pattern stack exhaustion](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) |
| micromatch | 4.0.8 | High | Inherits braces advisory |
| fast-glob | 3.3.1 | High | Inherits micromatch/braces advisory |
| @next/eslint-plugin-next | 16.3.4 | High | Inherits fast-glob chain |
| eslint-config-next | 16.3.4 | High | Inherits eslint-plugin-next chain |
| sharp | 0.35.4 | High | [librsvg dependency vulnerability](https://github.com/advisories/GHSA-wq5f-xc86-pv6w) |
| source-map-js | 1.2.1 | High | [Indexed source-map DoS](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) |

npm's combined next remediation suggests 16.4.0. Its proposed eslint-config-next remediation is 14.2.35 and marked a semver-major change; do not blindly apply that framework downgrade. Review targeted compatible dependency updates separately. Package audit severity alone does not establish that a specific vulnerable feature is exposed by this app.
