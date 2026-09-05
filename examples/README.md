# Examples

- [`github.example.ts`](./github.example.ts) runs three GitHub requests concurrently, demonstrating that each request claims its matching recorded interaction regardless of execution order.
- [`openai.example.ts`](./openai.example.ts) records a real OpenAI chat completion, then replays the LLM response without making another paid request.
- [`websocket.example.ts`](./websocket.example.ts) connects to two chat rooms and exchanges schema-validated JSON messages over each recorded WebSocket.

The examples use only the public `effect-http-recorder` package entrypoint. Run them with:

```sh
bun run test:examples
```

This command replays the committed cassettes from [`recordings`](./recordings) without contacting the services. If a cassette is missing, the preflight fails rather than silently making a network request.

Delete and regenerate all example recordings with:

```sh
bun run record:examples
```

This command explicitly enables recording, removes only `examples/recordings`, then runs all examples against their real services. Review and commit the regenerated JSON files so CI can replay them. It can make paid provider requests; supply credentials only when intentionally recording.

The GitHub example optionally reads `GITHUB_TOKEN`. To record with the token from the local GitHub CLI login:

```sh
GITHUB_TOKEN="$(gh auth token)" bun run record:examples
```

The live request is authenticated, but the recorder's secure defaults omit the `authorization` header from the cassette. Replay does not require the token.

The OpenAI example needs `OPENAI_API_KEY` only when recording a new cassette:

```sh
OPENAI_API_KEY="..." bun run record:examples
```

The API key is likewise omitted from the cassette, and replay does not consume tokens or require OpenAI credentials.
