# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

`throttle-window`: npm library (CommonJS + `.d.ts`, zero runtime deps) that gives you a keyed leading + trailing throttle with a pluggable window store (`MemoryEngine` by default, `RedisEngine` for ioredis 5/6). The user docs are in README.md. The architecture and the decision log (D1–D29) are in `docs/design-decisions.md`. Read it before you change behavior.

## Commands

Toolchain: Node >= 24.12 (`.nvmrc`), pnpm 12.6.0 installed with `npm i -g pnpm@12.6.0`. Never use corepack (Node stops bundling it from v25), and this applies in Dockerfiles, CI and docs too. `devEngines` fails installs on older Node.

| Task        | Command                                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------ |
| Install     | `pnpm install` (CI: `--frozen-lockfile`)                                                                     |
| Test (full) | `pnpm test`: runs clean, then `tsc --build` (src + test → `dist-test/`), then `ava reset-cache`, then `ava` |
| Lint        | `pnpm lint` (oxlint, correctness rules only)                                                                 |
| Build       | `pnpm build` (`tsconfig.build.json`, src → `dist/`)                                                          |
| Format      | `pnpm format` (Prettier: single quotes, trailing commas)                                                     |
| Build (Docker) | `docker compose run --rm builder`: builds in the image, then replaces the host's `dist/` (only Docker needed) |

AVA does **not** compile TypeScript (`compile: false`). It maps `test/**/*.spec.ts` to the JS that `tsc` has already emitted in `dist-test/`, so compile before you run a subset:

```bash
pnpm exec tsc --build && pnpm exec ava test/utils/circuit-breaker.spec.ts
pnpm exec tsc --build && pnpm exec ava test/window/throttle-window/basics.spec.ts --match '*coalesce*'
```

Tests don't need a Redis server. CI runs lint, test, build, `npm pack --dry-run` and a `require('./dist')` smoke test. Before a PR, run `pnpm lint && pnpm test`. Use Conventional Commits.

## Architecture

Layers (each layer calls only the one below it):

```text
window/ThrottleWindow (facade, option validation, wiring) → window/ThrottleJob (fluent builder)
  → scheduler/ThrottleScheduler (per-key state machine, implements ThrottleJobScheduler)
      ├─ scheduler/key-state (KeyStateRegistry + KeyState, RAM only)
      ├─ scheduler/key-run-with-lease (pure: run fn, lease extension, settle covered waiters)
      └─ utils/TimerRegistry (all timers)
  → scheduler/EngineGuard (CircuitBreaker + window-end encoding, fail-open, never throws)
  → ThrottleEngine { get, set(k, v, { PX, NX? }), del, clear }: MemoryEngine | RedisEngine | custom
```

- `ThrottleWindow` creates the timers, registry, guard and default engine, and injects them into `ThrottleScheduler` as a narrow config (D27). The scheduler never imports from `window/` except the `ThrottleJobScheduler` type.
- Engines are thin Redis-style stores. All throttle logic lives in the scheduler (D16). `EngineGuard` maps operations onto the engine: `acquire` → `set NX`, `extend` → `set` without NX, `remaining` → `get`. The stored value is the window's end time in epoch ms (D17).
- One `#attempt(state, phase)` drives both leading and trailing runs: acquire, then either run with a lease, or re-arm for the remaining remote window. After 10 lost races the pending calls are dropped with `ThrottleDroppedError`.

## Invariants to preserve

- **Liveness check after every `await`:** call `registry.alive(state)` before you touch state, so cleanup or `destroy()` is never undone (D13). Cleanup always rejects the remaining waiters.
- **Waiters are registered synchronously, before any `await`** (D12). Only a leading run rethrows to its caller. A failed trailing run rejects its covered waiters and is logged at `error` (D22).
- **Local claim before remote acquire:** `state.busy = true` is set before awaiting `guard.acquire` (D10).
- **Fail-open:** on an engine error or an open breaker, the job still runs. There is no engine timeout (D18), and clients must bring their own.
- **All timers go through `TimerRegistry`** (never a raw `setTimeout`). Timers are `unref`'d, delays are clamped to [min, 2^31−1], and `deadline` timers are never cancelled by the scheduler.
- `destroy()` clears only the default engine it created, never an engine that was injected (D23).
- Zero runtime dependencies. `src/` never imports `ioredis`. `RedisEngine` takes any structural `RedisClientLike`.

## Conventions

- Files are kebab-case and named for what they do, and each stays under ~200 lines (`throttle-scheduler.ts` is at the limit, so extract pure helpers rather than grow it). Source is grouped as `window/`, `scheduler/`, `engines/`, `utils/`. `test/` mirrors `src/`, and larger suites are split into folders (for example `test/window/throttle-window/*.spec.ts`).
- Class internals use ES `#private` fields. Comments are short block comments above classes and methods, never trailing inline comments.
- Public API errors: throw `TypeError`/`RangeError` for invalid arguments, and use `Throttle*Error` subclasses (with `key`) for runtime outcomes. Export anything new from `src/index.ts`.
- The decision log is append-only. To change a decision, add a new `D<n>` row that names the one it supersedes. Keep README and design-decisions in sync with behavior changes.

## Testing notes

- Every timer is `unref`'d, so a timing suite must hold the loop open: `const release = keepEventLoopAlive(); test.after.always(release);`. Otherwise AVA can exit before timers fire.
- Timing-sensitive tests use `test.serial` and call `t.teardown(() => throttle.destroy())`.
- Helpers in `test/helpers/`: `StubEngine` (a scripted responder per intent: acquire/extend/get/del/clear), `FakeRedisClient` (normal/failing/hanging modes, latency, in-flight counts), `createRedisWindow`/`recordInstanceRuns` (multi-instance cluster tests), `createTestRegistry` (KeyStateRegistry fixtures), `createRecordingLogger`, `createDeferred`, `waitFor`/`waitForEachTurn`, `captureUnhandledRejections`.
- ioredis compatibility is type-checked against both v6 (`ioredis`) and v5 (the `ioredis5` alias) using `lazyConnect` clients, with no server.
