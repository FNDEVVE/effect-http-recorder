---
"effect-http-recorder": minor
---

Make persistence, transport configuration, and cassette lifecycle operations Effect v4-native.

- Removed `HttpRecorder.hasCassetteSync`/`removeCassetteSync`; use Effect-based `HttpRecorder.hasCassette`/`removeCassette` instead. Invalid cassette names now fail with `InvalidCassetteError` instead of throwing.
- `CassetteService.fileSystem` now requires `FileSystem.FileSystem` and `Path.Path`; provide `NodePath.layer` (or `BunPath.layer`) alongside the file-system layer. Added `remove` to the service interface.
- Configuration types are now named root exports (`RecorderOptions`, `SocketRecorderOptions`, and related types), rather than members of a TypeScript `HttpRecorder` namespace. The root also exports `CassetteService` for storage-layer composition.
- Replay auto-mode reads the `CI` flag via `Config`, so tests can override it with `ConfigProvider.layer(ConfigProvider.fromUnknown(...))` instead of mutating `process.env`.
- Binary bodies use Effect `Encoding`. Configured secret values are checked before persistence and redacted from replay diagnostics.
- Cassette operations expose typed failures rather than hiding filesystem errors. Removing a cassette clears its recording state, and later appends retain the first recording timestamp.
- Replay validates its cassette during layer acquisition. Missing or invalid cassettes fail in the typed error channel; scoped release checks for unused recorded exchanges.
- Both WebSocket replay interfaces share one Effect-native transcript engine. The native constructor adapter is isolated from `Socket.make` recording/replay, and explicit delivery acknowledgments preserve ordering across large server-frame bursts and queued client writes.
- The test suite uses standard `@effect/vitest`, scoped filesystem fixtures, and real Effect HTTP server layers.
- Build and release workflows use scoped Effect filesystem and process services. The package retains its complete declaration graph and is verified through a compiled clean consumer on both Node and Bun.
