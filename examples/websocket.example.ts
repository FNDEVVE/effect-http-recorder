import { NodeSocket } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { Socket } from "effect/unstable/socket"
import { HttpRecorder } from "effect-http-recorder"

const conversation = Effect.gen(function* () {
  const socket = yield* Socket.Socket
  const write = yield* socket.writer

  yield* socket.runString((message) =>
    Effect.gen(function* () {
      const event: unknown = JSON.parse(message)
      if (typeof event !== "object" || event === null || !("type" in event)) return
      if (event.type === "session.created") yield* write(JSON.stringify({ type: "response.create" }))
      if (event.type === "response.completed") yield* write(new Socket.CloseEvent(1000, "done"))
    }),
  )
})

export const program = conversation.pipe(
  Effect.scoped,
  Effect.provide(
    HttpRecorder.socket("examples/provider-conversation").pipe(
      Layer.provide(NodeSocket.layerWebSocket("wss://provider.example/realtime")),
    ),
  ),
)
