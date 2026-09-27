# @ivann/throttle-window

[![npm version](https://img.shields.io/npm/v/@ivann/throttle-window.svg)](https://www.npmjs.com/package/@ivann/throttle-window)
[![CI](https://github.com/ivannguyendev/throttle/actions/workflows/ci.yml/badge.svg)](https://github.com/ivannguyendev/throttle/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@ivann/throttle-window.svg)](LICENSE)

Keyed leading + trailing throttle with a pluggable window store: Redis for clusters, in-memory for a single process. The first call for a key runs immediately, and all calls during the window collapse into exactly one trailing run.

## Contents

- [Features](#features)
- [Install](#install)
- [Quick start](#quick-start)
- [Redis and clusters](#redis-and-clusters)
- [How it works](#how-it-works)
- [API](#api)
- [Engines](#engines)
- [Failure handling](#failure-handling)
- [Errors](#errors)
- [Caveats](#caveats)
- [Development](#development)
- [Release](#release)
- [License](#license)

## Features

- **Leading + trailing, per key.** The first call runs now. A burst of calls collapses into exactly one trailing run at the end of the window.
- **No overlapping runs.** Each window starts when a run _finishes_, and long runs hold a lease, so a key never runs twice at once, even across instances.
- **Cluster or single process.** `RedisEngine` (ioredis 5/6) dedupes across instances. The default `MemoryEngine` needs nothing.
- **Fail-open.** A circuit breaker skips a failing engine. If Redis is down, jobs still run and each instance keeps throttling on its own.
- **Await the result.** `waitFinish()` resolves with the value of the run that covers your call, with an optional `timeout()`.
- **Quiet by default.** Nothing is logged unless you pass `debug: true` (console) or your own logger.
- **Small surface.** A custom engine is 4 Redis-style methods: `get`, `set`, `del`, `clear`. TypeScript types included. The CommonJS build works with `require` and `import`. Zero runtime dependencies.

## Install

```bash
npm i @ivann/throttle-window

# Only for RedisEngine (optional peer dependency, ioredis >= 5)
npm i ioredis
```

Requires Node.js >= 18. The package targets servers only, with no browser build.

## Quick start

```ts
import { ThrottleWindow } from '@ivann/throttle-window';

// Default engine: an in-memory MemoryEngine (single process).
const throttle = new ThrottleWindow('sync:', { windowMs: 1000 });

// Called on every change event, possibly many times per second per room.
export async function onRoomChanged(roomId: string): Promise<void> {
  const ran = await throttle.job(roomId, (phase) => syncRoom(roomId)).exec();
  // true  -> this call ran syncRoom now (leading) and it has finished
  // false -> coalesced: the trailing run at the end of the window covers it
}

// Need the result? Wait for the run that covers this call.
export function getSyncedRoom(roomId: string) {
  return throttle
    .job(roomId, (phase) => syncRoom(roomId))
    .waitFinish()
    .timeout(3000)
    .exec();
}

// On shutdown
process.once('SIGTERM', () => throttle.destroy());
```

CommonJS works the same way:

```js
const {
  ThrottleWindow,
  MemoryEngine,
  RedisEngine,
} = require('@ivann/throttle-window');
```

## Redis and clusters

```ts
import { Redis } from 'ioredis';
import { RedisEngine, ThrottleWindow } from '@ivann/throttle-window';

const redis = new Redis('redis://localhost:6379', {
  // The throttle has no engine timeout: let the client fail fast instead.
  commandTimeout: 500,
  enableOfflineQueue: false,
});

// One engine can back many throttles. keyPrefix keeps their keys apart.
const engine = new RedisEngine({ client: redis });

const roomSync = new ThrottleWindow('sync:room:', { engine });
const userSync = new ThrottleWindow('sync:user:', { engine, windowMs: 5000 });

await roomSync.job(roomId, (phase) => syncRoom(roomId)).exec();

// Shutdown: destroy the throttles, then close the client you own.
roomSync.destroy();
userSync.destroy();
await redis.quit();
```

- The Redis key for a job is `keyPrefix + key` (for example `sync:room:42`). It is a plain string with a `PX` expiry, so there is nothing to clean up. Its value is the time the window ends, in epoch milliseconds.
- Every instance that should share windows must use the same `keyPrefix` and `windowMs`.
- A cluster runs each key at most once per window. Pending calls live in each instance's memory. An instance that loses the window race keeps its pending calls, reads the window's end time with `GET`, and retries then. After 10 losses in a row, those calls fail with `ThrottleDroppedError`.

## How it works

```text
windowMs = 1000, fn takes 300 ms

t=0.0  call #1 -> runs now (leading)
t=0.3          -> run done, window [0.3 -> 1.3)
t=0.5  call #2 -> coalesced
t=0.9  call #3 -> coalesced
t=1.3          -> one trailing run, covers #2 and #3
t=1.6          -> run done, window [1.6 -> 2.6)
t=2.6          -> window passed with no calls: closed, key idle
t=3.0  call #4 -> runs now (leading)
```

- The first call for an idle key runs immediately (`phase = 'leading'`).
- Calls during an open window are coalesced into exactly one trailing run at the end of the window (`phase = 'trailing'`).
- Every run opens a new window that starts when the run **finishes**, so runs of the same key never overlap.
- A window that passes with no calls closes. The next call leads again.
- The trailing run executes the latest `fn` passed for that key (latest closure wins).
- **Covered calls:** a run covers a call if the call arrived **before that run started executing `fn`**. A call that arrives while `fn` is executing (t=0.1 or t=1.4 above) is covered by the next trailing run.

What each caller in the timeline gets:

| Call   | `exec()`            | `waitFinish().exec()`                  |
| ------ | ------------------- | -------------------------------------- |
| #1     | `true` at t=0.3     | value of the leading run, at t=0.3     |
| #2, #3 | `false` immediately | value of the trailing run, at t=1.6    |
| #4     | `true` at t=3.3     | value of its own leading run, at t=3.3 |

## API

### `new ThrottleWindow(keyPrefix, options?)`

`keyPrefix` (required, non-empty string) namespaces the throttle: engine keys are `keyPrefix + key`.

| Option     | Type                        | Default                              | Description                                                                                                             |
| ---------- | --------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `engine`   | `ThrottleEngine`            | `new MemoryEngine()`                 | Window store. The default engine belongs to the throttle and is cleared with it. An engine you pass in is never cleared. |
| `windowMs` | `number`                    | `1000`                               | Window length in ms, an integer from 1 to 2^31-1.                                                                       |
| `name`     | `string`                    | `keyPrefix` without the trailing `:` | Tag used in log messages.                                                                                               |
| `debug`    | `boolean \| ThrottleLogger` | `false`                              | `false`: log nothing, not even errors. `true`: log through `console`. A logger `{ debug, info, error }`: log through it. |

What gets logged: every run with its phase (`info`), failed trailing runs and failing timer callbacks (`error`), and the breaker opening, the rearm limit and an unusually large key map (`debug`). Each call is `(message, meta?)`, and a logger that throws never breaks the throttle. Invalid arguments throw a `TypeError` or `RangeError`.

Example with your own logger (pino-style):

```ts
const throttle = new ThrottleWindow('sync:', {
  debug: {
    debug: (message, meta) => log.debug(meta, message),
    info: (message, meta) => log.info(meta, message),
    error: (message, meta) => log.error(meta, message),
  },
});
```

### `throttle.job(key, fn)`

Creates a job. Nothing happens until `.exec()`.

- `key`: a string. The engine key is `keyPrefix + key`.
- `fn`: `(phase: 'leading' | 'trailing') => T | Promise<T>`.

Throws `TypeError` for an invalid `key` or `fn`.

### `.exec(): Promise<boolean>`

| Case                                                                   | Result                                                                                         |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Leading**: the key is idle                                           | Runs `fn('leading')`, waits for it, resolves `true`. Rejects with `fn`'s error (backpressure). |
| **Coalesced**: the key is running or inside a window (on any instance) | Resolves `false` immediately. The trailing run covers this call.                               |

A coalesced `exec()` never sees the trailing run's outcome. A failed trailing run rejects the `waitFinish()` calls it covers and is logged at `error` level when `debug` is on.

### `.waitFinish().exec(): Promise<T>`

Resolves with the value of the run that covers this call (leading or trailing), or rejects with that run's error. The trailing run uses the latest `fn` for the key, so the value may come from a newer closure than the one you passed. That is safe when handlers recompute from source.

### `.waitFinish().timeout(ms).exec(): Promise<T>`

Rejects with `ThrottleTimeoutError` if the covering run has not settled within `ms`. The job is **not** cancelled: it still runs and still covers the call. `timeout()` is only available after `waitFinish()`.

### Getters

| Getter         | Description                                                              |
| -------------- | ------------------------------------------------------------------------ |
| `activeCount`  | Keys with a run in progress, including keys still waiting on the engine. |
| `pendingCount` | Keys with coalesced calls waiting for a trailing run.                    |
| `keyCount`     | Keys tracked in memory.                                                  |
| `timerCount`   | Timers currently scheduled by this throttle.                             |

### `throttle.destroy()`

- Clears every timer. Calls that have not run yet reject with `ThrottleDestroyedError`.
- Clears the default `MemoryEngine`. An engine you passed in, and its Redis client, stay untouched: close them yourself.
- Does not cancel runs that are already executing `fn`.
- Any `exec()` after `destroy()` rejects with `ThrottleDestroyedError`.

## Engines

### `MemoryEngine` (default)

For a single process. Expiry is measured with a monotonic clock (`performance.now()`), so wall-clock jumps don't affect it. A lazy sweeper purges expired keys and only runs while keys exist. Tune it with `new MemoryEngine({ sweepIntervalMs })` (default `60000`). `clear()` empties it, and the engine keeps working afterwards.

### `RedisEngine`

`new RedisEngine({ client })` takes an ioredis 5 or 6 client (any object with ioredis-compatible `set`, `get` and `del` works). It stores one auto-expiring key per throttle key and only uses single-key commands:

| Method                         | Redis command                     |
| ------------------------------ | --------------------------------- |
| `get(key)`                     | `GET key`                         |
| `set(key, value, { PX, NX })`  | `SET key value PX ms NX`          |
| `set(key, value, { PX })`      | `SET key value PX ms`             |
| `del(key)`                     | `DEL key`                         |
| `clear()`                      | none: keys expire on their own    |

`clear()` is a no-op because a shared Redis has no safe way to delete only this engine's keys.

### Custom engines

Implement `ThrottleEngine`, exported as a type (`import type { ThrottleEngine, ThrottleEngineSetOptions } from '@ivann/throttle-window'`). Keys arrive already prefixed.

```ts
interface ThrottleEngineSetOptions {
  PX: number; // expiry in ms
  NX?: boolean; // only set if the key is missing or expired
}

interface ThrottleEngine {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options: ThrottleEngineSetOptions): Promise<boolean>;
  del(key: string): Promise<void>;
  clear(): Promise<void>;
}
```

| Method                        | Contract                                                                                                                                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get(key)`                    | The stored value, or `null` when the key is missing or expired.                                                                                                                           |
| `set(key, value, { PX, NX })` | Store `value` with a `PX` ms expiry. With `NX: true`, write **atomically and only if the key is missing or expired**, and resolve `true` only if this call wrote it. Without `NX`, always overwrite, **even an expired key** (`SET ... PX` semantics), and resolve `true`. |
| `del(key)`                    | Remove the key. The throttle never calls it: it is there for you.                                                                                                                         |
| `clear()`                     | Remove every key the engine owns. The throttle only calls it in `destroy()`, on the default engine it created. A shared store may make it a no-op.                                         |

The throttle stores the window's end time (epoch ms) as the value, and reads it back with `get()` to know when to retry after losing a window race. The atomic `NX` is what stops two instances from running the same key.

Just throw or reject on failure. Circuit breaking and fail-open are handled for you, so don't retry inside the engine. There is no timeout around engine calls, so give your client its own.

Example for [node-redis](https://www.npmjs.com/package/redis) (not built in):

```ts
import { createClient } from 'redis';
import type { ThrottleEngine, ThrottleEngineSetOptions } from '@ivann/throttle-window';

type NodeRedisClient = ReturnType<typeof createClient>;

export class NodeRedisEngine implements ThrottleEngine {
  constructor(private readonly client: NodeRedisClient) {}

  get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, { PX, NX }: ThrottleEngineSetOptions): Promise<boolean> {
    const reply = await this.client.set(key, value, NX ? { PX, NX: true } : { PX });
    return reply === 'OK';
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async clear(): Promise<void> {}
}
```

## Failure handling

| Mechanism          | Behavior                                                                                                                                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No engine timeout  | The throttle waits for each engine call as long as it takes, so a slow engine slows the throttle. Give the client its own timeout (ioredis `commandTimeout`): a command that fails that way counts as an engine error and the job fails open.            |
| Circuit breaker    | 5 consecutive engine failures open the breaker for 10 s, and the engine is skipped. Then a single probe call decides: success closes the breaker, failure opens it for another 10 s.                                                                   |
| Fail-open          | On an engine error or an open breaker, the job **still runs**. In-memory state keeps throttling per instance, so during a Redis outage each instance runs a key at most once per window. Cross-instance dedupe returns when Redis recovers.            |
| No fallback engine | By design. The scheduler's in-memory state already throttles in-process.                                                                                                                                                                               |
| Lease              | While `fn` runs, the window is extended every `max(windowMs / 2, 100)` ms, so another instance can't overlap a run that lasts longer than `windowMs`.                                                                                                  |
| Lost window race   | The losing instance reads the window's end time with `get()` and retries then. The wait is capped at the lease TTL, and an unreadable value falls back to `windowMs`.                                                                                  |
| Run errors         | A failed leading run rejects its caller's `exec()`. A failed trailing run rejects the `waitFinish()` calls it covered and is logged at `error` level when `debug` is on.                                                                               |

## Errors

All error classes are exported from `@ivann/throttle-window`.

| Error                      | When                                                                                        | Extra field |
| -------------------------- | ------------------------------------------------------------------------------------------- | ----------- |
| `ThrottleError`            | Base class of the errors below.                                                             | `key`       |
| `ThrottleTimeoutError`     | `waitFinish().timeout(ms)` elapsed before the covering run settled. The job keeps running.  | `timeoutMs` |
| `ThrottleDroppedError`     | A pending call gave up after losing the window race to other instances 10 times in a row.   |             |
| `ThrottleDestroyedError`   | `destroy()` was called before the call could run, or `exec()` was called after `destroy()`. |             |
| `TypeError` / `RangeError` | Invalid `keyPrefix`, constructor options, or `job()` / `timeout()` arguments.               |             |

```ts
import { ThrottleTimeoutError } from '@ivann/throttle-window';

try {
  await throttle
    .job(roomId, (phase) => syncRoom(roomId))
    .waitFinish()
    .timeout(3000)
    .exec();
} catch (error) {
  if (error instanceof ThrottleTimeoutError) {
    // Still running. The result arrives later, so the caller moves on.
  } else {
    throw error;
  }
}
```

## Caveats

- **Pending trailing runs are lost on exit.** Timers are `unref`'d, so they never keep the process alive, and a trailing run still waiting when the process exits never happens. Keep your own safety net, such as a periodic full sync.
- **Pending state lives in RAM only.** Redis stores only the window key. Pending calls don't survive a crash or restart.
- **No re-entrant waits.** Inside a key's `fn`, don't `await` `waitFinish()` for the **same key**. The covering run can't start until the current one finishes, so it deadlocks until the timeout, or forever without one.
- **A hung engine stalls its key.** There is no engine timeout. If an engine call never settles, the key stays busy: a leading `exec()` waits with it, and later calls coalesce into a run that never comes. Set `commandTimeout` and `enableOfflineQueue: false` on ioredis, and use `waitFinish().timeout(ms)` where a caller must not hang.
- **Silent by default.** Without `debug`, nothing is logged, not even failed trailing runs, and a caller that only uses `exec()` never sees them. Pass a logger in production.
- **Trailing runs are not capped across keys.** Many keys whose windows end together run their trailing `fn` at the same time.
- **Retry timing reads wall clocks.** The window's end time is stored in epoch ms, so clock skew between hosts shifts when a losing instance retries (capped at the lease TTL). It never lets two instances run the same key: `NX` decides that.
- **Latest closure wins.** A trailing run, and every `waitFinish()` it covers, uses the most recent `fn` for the key. Write handlers that recompute from source.
- **Leading runs apply backpressure.** `exec()` awaits a leading run and rejects if it throws. If you don't await it, attach a `.catch()`.
- `activeCount` includes keys still waiting on the engine, not only running `fn`s.
- `destroy()` does not clear an engine or close a Redis client you passed in, and does not cancel in-flight runs.

## Development

Requirements, enforced by `devEngines`:

- Node.js >= 24.12 (`nvm use` reads `.nvmrc`)
- pnpm 12.6.0, installed with npm. Don't use corepack: Node.js stops bundling it from v25.

```bash
npm i -g pnpm@12.6.0
git clone https://github.com/ivannguyendev/throttle.git
cd throttle
pnpm install
pnpm test
```

| Command        | Description                                         |
| -------------- | --------------------------------------------------- |
| `pnpm install` | Install dependencies from `pnpm-lock.yaml`          |
| `pnpm build`   | Compile `src/` to `dist/` (CommonJS + `.d.ts`)      |
| `pnpm test`    | Compile `src/` and `test/` to `dist-test/` with `tsc`, then run AVA |
| `pnpm lint`    | Lint with Oxlint                                    |
| `pnpm format`  | Format `src/` and `test/` with Prettier             |
| `docker compose run --rm builder` | Build `dist/` in a container. Needs only Docker, no Node.js or pnpm |

- Source is grouped by module (`window/`, `scheduler/`, `engines/`, `utils/`). Tests live in `test/` and mirror that layout.
- Tests don't need a Redis server.
- CI (`.github/workflows/ci.yml`) runs on every push to `main` and every pull request. It runs lint, test, build, `npm pack --dry-run` and a `require('./dist')` smoke test.
- Before opening a PR, run `pnpm lint && pnpm test` and use [Conventional Commits](https://www.conventionalcommits.org/).
- Architecture and the decision log are in [`docs/design-decisions.md`](docs/design-decisions.md).

## Release

`.github/workflows/release.yml` publishes to npm when a `v*` tag is pushed. It uses npm [trusted publishing](https://docs.npmjs.com/trusted-publishers) (GitHub OIDC, with provenance), so no npm token is stored in GitHub.

### One-time bootstrap

A trusted publisher can only be attached to a package that already exists, so publish the first version by hand:

1. Use Node.js >= 24.12 and run `npm login`.
2. From a clean checkout of `main`:

   ```bash
   npm i -g pnpm@12.6.0
   pnpm install --frozen-lockfile
   npm publish --access public   # prepublishOnly runs lint, test and build
   ```

3. On npmjs.com, open the package, then **Settings** → **Trusted Publisher** → **GitHub Actions**. Enter user `ivannguyendev`, repository `throttle` and workflow filename `release.yml`.
4. Optional: on the same page, set publishing access to require 2FA and disallow tokens.

### Every release

```bash
# Bump "version" in package.json first (for example 0.1.0 -> 0.2.0).
git commit -am "chore(release): v0.2.0"
git tag v0.2.0
git push origin main v0.2.0
```

The workflow fails if the tag is not `v` + the `package.json` version. Otherwise it runs `npm publish --provenance --access public`, and `prepublishOnly` runs lint, test and build first.
Tags with a pre-release suffix (for example `v1.0.0-beta.1`) are published under the `next` dist-tag instead of `latest`.
## License

[MIT](LICENSE)
