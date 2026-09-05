# Contributing

Install the pinned dependencies and run the complete quality gate:

```sh
bun install --frozen-lockfile
bun run check
```

Use `bun run format` and `bun run lint:fix` for local fixes. Tests live under `test/`, examples under `examples/`, and consumers import from the package root. `bun run test` runs the complete Vitest suite; `bun run test -- test/clock.test.ts` selects a file.

Add a Changeset with `bun run changeset` for user-facing changes. Review every cassette diff for credentials before committing it. Refresh a cassette by deleting only that cassette and rerunning its focused test.

Effect release candidate upgrades must update runtime, peer, development, documentation, and clean-consumer versions together. Use static imports only; dynamic `import()` and inline import-type expressions are not accepted.

## Effect v4 First

- Define effectful operations with named `Effect.fn` functions. Model expected failures with `Schema.TaggedError` and decode persisted data with Effect Schema.
- Keep persistence behind `FileSystem` and `Path`, configuration behind `ConfigProvider`, and time behind `Clock`/`DateTime`. Supply platform implementations through layers.
- Own temporary files, directories, servers, and background fibers with scopes. Do not hide operational failures with `orDie` or catch-all fallbacks.
- Prefer `@effect/vitest`'s `it.effect` and deterministic synchronization (`Deferred`, `Queue`, `TestClock`). Use live time only when it is the behavior under test.
- Test observable contracts: replay ordering, errors, redaction, resource cleanup, and time-dependent requests. Avoid assertions about implementation details or export-key inventories.
- Keep standard JavaScript data operations where they are pure. Effect is for effects, resource ownership, typed failures, and composition—not an excuse to wrap every expression.

`bun run check` also builds an archive, installs it into a clean consumer, checks its declarations, and exercises its public exports with Node and Bun. Source typechecking alone is not sufficient package verification.

## Socket Architecture

- `src/websocket/transcript.ts` owns frame codecs, redaction, matching, and the shared replay cursor. Its read/write synchronization uses Effect primitives; readiness acknowledges delivery through the next client-frame or end boundary.
- `src/websocket/socket.ts` implements recording and replay through `Socket.make` from `effect/unstable/socket`, with scoped handler fibers.
- `src/websocket/constructor.ts` adapts the shared transcript to the synchronous native `WebSocket` contract. Native events, binary snapshots, and terminal event-loop scheduling stay at this boundary; they must not introduce a second replay cursor.
- `src/websocket/recorder.ts` composes the public layers. Keep dynamic URL/protocol recording and both replay interfaces covered when changing the shared engine.
