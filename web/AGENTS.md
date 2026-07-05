<!-- intent-skills:start -->
# TanStack Intent - before editing files, run the matching guidance command.
tanstackIntent:
  - id: "@tanstack/devtools#devtools-app-setup"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/devtools#devtools-app-setup"
    for: "Install TanStack Devtools, pick framework adapter (React/Vue/Solid/Preact), register plugins via plugins prop, configure shell (position, hotkeys, theme, hideUntilHover, requireUrlFlag, eventBusConfig). TanStackDevtools component, defaultOpen, localStorage persistence."
  - id: "@tanstack/devtools#devtools-marketplace"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/devtools#devtools-marketplace"
    for: "Publish plugin to npm and submit to TanStack Devtools Marketplace. PluginMetadata registry format, plugin-registry.ts, pluginImport (importName, type), requires (packageName, minVersion), framework tagging, multi-framework submissions, featured plugins."
  - id: "@tanstack/devtools#devtools-plugin-panel"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/devtools#devtools-plugin-panel"
    for: "Build devtools panel components that display emitted event data. Listen via EventClient.on(), handle theme (light/dark), use @tanstack/devtools-ui components. Plugin registration (name, render, id, defaultOpen), lifecycle (mount, activate, destroy), max 3 active plugins. Two paths: Solid.js core with devtools-ui for multi-framework support, or framework-specific panels."
  - id: "@tanstack/devtools#devtools-production"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/devtools#devtools-production"
    for: "Handle devtools in production vs development. removeDevtoolsOnBuild, devDependency vs regular dependency, conditional imports, NoOp plugin variants for tree-shaking, non-Vite production exclusion patterns."
  - id: "@tanstack/devtools-event-client#devtools-bidirectional"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/devtools-event-client#devtools-bidirectional"
    for: "Two-way event patterns between devtools panel and application. App-to-devtools observation, devtools-to-app commands, time-travel debugging with snapshots and revert. structuredClone for snapshot safety, distinct event suffixes for observation vs commands, serializable payloads only."
  - id: "@tanstack/devtools-event-client#devtools-event-client"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/devtools-event-client#devtools-event-client"
    for: "Create typed EventClient for a library. Define event maps with typed payloads, pluginId auto-prepend namespacing, emit()/on()/onAll()/onAllPluginEvents() API. Connection lifecycle (5 retries, 300ms), event queuing, enabled/disabled state, SSR fallbacks, singleton pattern. Unique pluginId requirement to avoid event collisions."
  - id: "@tanstack/devtools-event-client#devtools-instrumentation"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/devtools-event-client#devtools-instrumentation"
    for: "Analyze library codebase for critical architecture and debugging points, add strategic event emissions. Identify middleware boundaries, state transitions, lifecycle hooks. Consolidate events (1 not 15), debounce high-frequency updates, DRY shared payload fields, guard emit() for production. Transparent server/client event bridging."
  - id: "@tanstack/devtools-vite#devtools-vite-plugin"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/devtools-vite#devtools-vite-plugin"
    for: "Configure @tanstack/devtools-vite for source inspection (data-tsd-source, inspectHotkey, ignore patterns), console piping (client-to-server, server-to-client, levels), enhanced logging, server event bus (port, host, HTTPS), production stripping (removeDevtoolsOnBuild), editor integration (launch-editor, custom editor.open). Must be FIRST plugin in Vite config. Vite ^6 || ^7 only."
  - id: "@tanstack/router-core#router-core"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/router-core#router-core"
    for: "Framework-agnostic core concepts for TanStack Router: route trees, createRouter, createRoute, createRootRoute, createRootRouteWithContext, addChildren, Register type declaration, route matching, route sorting, file naming conventions. Entry point for all router skills."
  - id: "@tanstack/router-core#router-core/auth-and-guards"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/router-core#router-core/auth-and-guards"
    for: "Route protection with beforeLoad, redirect()/throw redirect(), isRedirect helper, authenticated layout routes (_authenticated), non-redirect auth (inline login), RBAC with roles and permissions, auth provider integration (Auth0, Clerk, Supabase), router context for auth state."
  - id: "@tanstack/router-core#router-core/code-splitting"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/router-core#router-core/code-splitting"
    for: "Automatic code splitting (autoCodeSplitting), .lazy.tsx convention, createLazyFileRoute, createLazyRoute, lazyRouteComponent, getRouteApi for typed hooks in split files, codeSplitGroupings per-route override, splitBehavior programmatic config, critical vs non-critical properties."
  - id: "@tanstack/router-core#router-core/data-loading"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/router-core#router-core/data-loading"
    for: "Route loader option, loaderDeps for cache keys, staleTime/gcTime/ defaultPreloadStaleTime SWR caching, pendingComponent/pendingMs/ pendingMinMs, errorComponent/onError/onCatch, beforeLoad, router context and createRootRouteWithContext DI pattern, router.invalidate, Await component, deferred data loading with unawaited promises."
  - id: "@tanstack/router-core#router-core/navigation"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/router-core#router-core/navigation"
    for: "Link component, useNavigate, Navigate component, router.navigate, ToOptions/NavigateOptions/LinkOptions, from/to relative navigation, activeOptions/activeProps, preloading (intent/viewport/render), preloadDelay, navigation blocking (useBlocker, Block), createLink, linkOptions helper, scroll restoration, MatchRoute."
  - id: "@tanstack/router-core#router-core/not-found-and-errors"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/router-core#router-core/not-found-and-errors"
    for: "notFound() function, notFoundComponent, defaultNotFoundComponent, notFoundMode (fuzzy/root), errorComponent, CatchBoundary, CatchNotFound, isNotFound, NotFoundRoute (deprecated), route masking (mask option, createRouteMask, unmaskOnReload)."
  - id: "@tanstack/router-core#router-core/path-params"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/router-core#router-core/path-params"
    for: "Dynamic path segments ($paramName), splat routes ($ / _splat), optional params ({-$paramName}), prefix/suffix patterns ({$param}.ext), useParams, params.parse/stringify, pathParamsAllowedCharacters, i18n locale patterns."
  - id: "@tanstack/router-core#router-core/search-params"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/router-core#router-core/search-params"
    for: "validateSearch, search param validation with Zod/Valibot/ArkType adapters, fallback(), search middlewares (retainSearchParams, stripSearchParams), custom serialization (parseSearch, stringifySearch), search param inheritance, loaderDeps for cache keys, reading and writing search params."
  - id: "@tanstack/router-core#router-core/ssr"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/router-core#router-core/ssr"
    for: "Non-streaming and streaming SSR, RouterClient/RouterServer, renderRouterToString/renderRouterToStream, createRequestHandler, defaultRenderHandler/defaultStreamHandler, HeadContent/Scripts components, head route option (meta/links/styles/scripts), ScriptOnce, automatic loader dehydration/hydration, memory history on server, data serialization, document head management."
  - id: "@tanstack/router-core#router-core/type-safety"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/router-core#router-core/type-safety"
    for: "Full type inference philosophy (never cast, never annotate inferred values), Register module declaration, from narrowing on hooks and Link, strict:false for shared components, getRouteApi for code-split typed access, addChildren with object syntax for TS perf, LinkProps and ValidateLinkOptions type utilities, as const satisfies pattern."
  - id: "@tanstack/router-plugin#router-plugin"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/router-plugin#router-plugin"
    for: "TanStack Router bundler plugin for route generation and automatic code splitting. Supports Vite, Webpack, Rspack, and esbuild. Configures autoCodeSplitting, routesDirectory, target framework, and code split groupings."
  - id: "@tanstack/virtual-file-routes#virtual-file-routes"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/virtual-file-routes#virtual-file-routes"
    for: "Programmatic route tree building as an alternative to filesystem conventions: rootRoute, index, route, layout, physical, defineVirtualSubtreeConfig. Use with TanStack Router plugin's virtualRouteConfig option."
<!-- intent-skills:end -->

## What this is

React 19 + Vite + TanStack Router **SPA** against the separate Rust
`hearts-server` backend (see `../crates/AGENTS.md`). This is *not* a
TanStack Start SSR app — no server functions, no `src/routes/demo/`. Note:
`web/README.md` is the generic TanStack Start scaffold README and doesn't
reflect this project's actual architecture; don't take it at face value.

## Layout

`src/routes/` — file-based routing; `routeTree.gen.ts` is generated by
`pnpm generate-routes`, don't hand-edit it.
- `__root.tsx` — `beforeLoad` calls `ensureSession()` so every child route can assume a token exists; wraps the app in `QueryClientProvider`.
- `index.tsx` — `/` landing page.
- `play.tsx` — `/play`; create-a-game or join-by-code form.
- `games.$id.tsx` — `/games/:id`; the switchboard — loader primes the game view, polls every 2s while `status === 'lobby'`, and renders `Lobby`, `GameTable`, or `FinishedView` based on `view.status`.
- `join.$code.tsx` — `/join/:code`; dedicated invite-link join flow.

`src/components/`
- `GameTable.tsx` — live in-progress game: bidding + trick play, subscribes to SSE via `useGameEvents`, drives GSAP Flip animations via `useFlipLayout`. Composes `Countdown`, `Card` (`PlayingCard`), `Scoreboard`, `SeatCard`.
- `Lobby.tsx` — pre-game: invite code + copy button, player list, creator-only "Start game".
- `FinishedView.tsx` — post-game outcome, read from the `gameKeys.result` cache slot seeded by the SSE bridge (the terminal `GameView` itself carries no scores).
- `Scoreboard.tsx` — cumulative per-seat scores + current round's bid/trick tallies.
- `SeatCard.tsx` — one player's seat: composes `BidBadge` + name + `TricksPile`.
- `BidBadge.tsx` / `TricksPile.tsx` — small leaf pieces used only by `SeatCard`.
- `Card.tsx` — `PlayingCard`, the shared card-art primitive (interactive/static, legal/selected states, `data-flip-id` for GSAP Flip).
- `Countdown.tsx` — cosmetic turn timer (`src/hooks/useCountdown.ts`); the server is the real enforcer.

Composition chain: `games.$id.tsx` → (`Lobby` | `GameTable` | `FinishedView`) → `GameTable` → `Scoreboard`, `SeatCard`× per player → `BidBadge`, `TricksPile`.

`src/lib/`
- `api.ts` — typed REST client (`api.createGame/joinGame/startGame/getGame/bid/play`), `ensureSession()` bootstrap, `ApiError` union, one-shot 401 retry. Exports `API_BASE` (`VITE_API_BASE` env var, default `http://127.0.0.1:8080`).
- `session.ts` — localStorage-backed session token + display-name persistence, in-memory cache mirror.
- `sse.ts` — `useGameEvents(gameId)`: opens an `EventSource` on `/games/{id}/events`, invalidates the query cache per event, seeds the terminal result on `game_over`/`game_abandoned`.
- `types.ts` — server DTOs (`Card`, `GameView`, `EngineView`, `RoundView`, `GameEvent` union, etc.) — mirror `hearts-server`'s types 1:1.
- `query.ts` — the shared `QueryClient` + `gameKeys` query-key factory (`detail`, `result`).
- `cards.ts` — card display helpers: `sortHand` (suit-grouped, Hearts last as trump), `SUIT_GLYPH`, `RANK_LABEL`, `formatCard`, `cardId`.
- `anim.ts` — GSAP wiring: `prefersReducedMotion()` and the `useFlipLayout()` hook.

## Commands

```sh
cd web
pnpm install
pnpm dev              # dev server on :3000
pnpm build             # production build
pnpm test              # vitest
pnpm generate-routes   # regenerate routeTree.gen.ts after adding/renaming a route file
```

Package manager is **pnpm** specifically (`pnpm-lock.yaml`).

## Conventions

- No ESLint, Prettier, or Biome config exists — don't assume or invent a
  `pnpm lint` step. `tsconfig.json` runs in `strict` mode plus
  `noUnusedLocals`/`noUnusedParameters`/`noFallthroughCasesInSwitch`, so
  `tsc` itself catches a fair amount.
- Path aliases `#/*` and `@/*` both map to `./src/*`.
- No `.env` files exist yet; the only env var read in code is
  `VITE_API_BASE` (`src/lib/api.ts`), default `http://127.0.0.1:8080`.

## State model

No Redux/Zustand — TanStack Query (`query.ts`) is the only client state
store. Game state is entirely server-derived: every mutation re-renders
from the server's response rather than optimistically patching local
state. The only durable local state is the session token in `localStorage`
(`session.ts`). SSE (`sse.ts`) invalidates the query cache per event rather
than patching it directly.

## Testing conventions

Vitest + Testing Library, jsdom environment. Tests are **colocated** next
to the file they test (`GameTable.tsx` + `GameTable.test.tsx`,
`session.ts` + `session.test.ts`), not in a `__tests__` dir. `src/test/setup.ts`
polyfills `localStorage` and resets storage + mocks after each test.

Component test pattern (see `GameTable.test.tsx`, `Lobby.test.tsx`):
`vi.mock('../lib/api', ...)` via `importActual` to stub specific mutating
calls only; `vi.mock('../lib/sse', () => ({ useGameEvents: () => {} }))` to
no-op SSE; a `renderWithClient` helper wraps the component in a fresh
`QueryClientProvider` (retry disabled); tests build a literal `GameView`
fixture (cast `as unknown as GameView`) rather than hitting the network.

## Backend contract

DTOs in `types.ts` mirror `hearts-server`'s types 1:1.
`you.legal_bids`/`you.legal_plays` non-null is the sole "is it my turn"
signal. On a 409 from bid/play, refetch and re-render rather than
raw-retrying. `../docs/api.md` is the contract source of truth, and
`../crates/hearts-cli` is the reference client implementation this
frontend's request/event patterns mirror. See `docs/frontend-design.md`
for further design rationale — including the one route described there but
not yet implemented: `/account`.
