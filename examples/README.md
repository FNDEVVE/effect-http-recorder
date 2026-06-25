# Examples

- [`github.example.ts`](./github.example.ts) runs two GitHub requests concurrently with random delays, demonstrating that each request claims its matching recorded interaction regardless of execution order.
- [`websocket.example.ts`](./websocket.example.ts) tests an application service that selects multiple WebSocket URLs at runtime.

The examples use only the public `effect-http-recorder` package entrypoint. Run them with:

```sh
bun run test:examples
```

The first run writes cassettes to [`recordings`](./recordings). Later runs replay those cassettes without contacting either service.

Delete and regenerate all example recordings with:

```sh
bun run record:examples
```

This command removes only `examples/recordings`, then runs both examples against their real services. Commit the regenerated JSON files so CI can replay them.

The GitHub example optionally reads `GITHUB_TOKEN`. To record with the token from the local GitHub CLI login:

```sh
GITHUB_TOKEN="$(gh auth token)" bun run record:examples
```

The live request is authenticated, but the recorder's secure defaults omit the `authorization` header from the cassette. Replay does not require the token.
