# effect-http-recorder

## 0.2.1

### Patch Changes

- f2def1d: Replay each HTTP request from the first unused matching interaction so distinct requests can run out of order or concurrently.

## 0.2.0

### Minor Changes

- 6b1c422: Add constructor-level WebSocket recording for applications that select connection URLs at runtime. Rename the public layers to `layer`, `layerSocket`, and `layerWebSocketConstructor` to mirror Effect's layer naming.

## 0.1.0

Initial public beta with deterministic Effect HTTP and finite WebSocket conversation recording and replay.
