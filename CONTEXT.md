# HTTP Recorder

The HTTP recorder is a public testing library for recording real Effect transport traffic into deterministic cassettes and replaying it without contacting the upstream service.

## Language

**Library Version**:
The independently managed semantic version of `effect-http-recorder` published to npm.

**Effect Compatibility Version**:
The exact Effect 4 beta against which the package's unstable HTTP and socket integrations are built and verified.

**Provider Conversation**:
A finite WebSocket connection in which either peer may send first, the client sends one or more JSON commands, server frames follow in causal order, and the application closes after a terminal event.

**Connection Identity**:
The explicit cassette name supplied to the WebSocket recorder. It identifies the recorded conversation during replay.

**Completed Conversation**:
A WebSocket socket run that opened and finished successfully after recording a valid finite transcript.

**Client Frame Match**:
The replay check that requires an outgoing application frame to equal the next recorded client frame after redaction. Text JSON ignores object-key order; other text and binary frames match exactly.

## Relationships

- The **Library Version** begins with the public beta at `0.1.0` and advances independently through Changesets.
- The initial **Effect Compatibility Version** is `4.0.0-beta.83`; compatibility with later Effect betas is not implied.
- Changing the **Effect Compatibility Version** requires a new **Library Version** and clean-consumer package verification.
- A **Provider Conversation** is the canonical WebSocket scenario for evaluating the public beta contract; arbitrary socket emulation is not implied.
- Application code owns WebSocket construction, including URL, protocols, timeout, authentication, and close policy; the recorder decorates the resulting Effect `Socket.Socket` service.
- **Connection Identity**, not the live WebSocket destination, selects and validates a replay. The beta does not validate URL or handshake configuration during replay.
- Only a **Completed Conversation** is committed to a cassette; failed, interrupted, unopened, or invalid runs do not produce a recording.
- Replay requires every recorded frame to be consumed before application close.
- Terminal close codes, close reasons, connection timing, and transport failures are not cassette events in the first public beta.
- Every outgoing replay frame must satisfy the **Client Frame Match** before later server frames are released.
- The first public beta does not expose a custom WebSocket frame matcher.
- Replay starts incoming frame handlers in recorded order and may run them concurrently; it waits for every handler before the socket run completes but does not guarantee handler completion order.
