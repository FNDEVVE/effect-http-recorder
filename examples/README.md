# Examples

- [`github.example.ts`](./github.example.ts) tests a small GitHub service while the recorder captures and replays its real HTTP request.
- [`websocket.example.ts`](./websocket.example.ts) decorates an application-owned Effect WebSocket for a finite provider conversation.

The examples use only the public `effect-http-recorder` package entrypoint. Run the HTTP test with:

```sh
bun run test:examples
```

The first run records the GitHub response. Later runs replay the committed cassette without contacting GitHub.
