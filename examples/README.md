# Examples

- [`github.example.ts`](./github.example.ts) tests a small GitHub service while the recorder captures and replays its real HTTP request.
- [`websocket.example.ts`](./websocket.example.ts) tests an application service that selects multiple WebSocket URLs at runtime.

The examples use only the public `effect-http-recorder` package entrypoint. Run the HTTP test with:

```sh
bun run test:examples
```

The first run records the GitHub response and WebSocket conversations. Later runs replay the committed cassettes without contacting either service.
