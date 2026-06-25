import { NodeSocket } from "@effect/platform-node"
import { assert, it } from "@effect/vitest"
import { Context, Deferred, Effect, Layer } from "effect"
import { Socket } from "effect/unstable/socket"
import { HttpRecorder } from "effect-http-recorder"

class EchoService extends Context.Service<EchoService>()("example/EchoService", {
  make: Effect.gen(function* () {
    const constructor = yield* Socket.WebSocketConstructor

    const roundTrip = Effect.fn("EchoService.roundTrip")(
      function* (url: string, message: string) {
        const socket = yield* Socket.makeWebSocket(url, { closeCodeIsError: () => false })
        const write = yield* socket.writer
        const echoed = yield* Deferred.make<string>()

        yield* socket.runString(
          (response) =>
            Effect.gen(function* () {
              if (response !== message) return
              yield* Deferred.succeed(echoed, response)
              yield* write(new Socket.CloseEvent(1000, "received echo")).pipe(Effect.orDie)
            }),
          { onOpen: write(message).pipe(Effect.orDie) },
        )

        return yield* Deferred.await(echoed)
      },
      Effect.provideService(Socket.WebSocketConstructor, constructor),
    )

    return { roundTrip } as const
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)
}

it.effect(
  "records connections selected by an application service",
  () =>
    Effect.gen(function* () {
      const echo = yield* EchoService

      assert.strictEqual(yield* echo.roundTrip("wss://ws.postman-echo.com/raw", "hello alpha"), "hello alpha")
      assert.strictEqual(yield* echo.roundTrip("wss://ws.postman-echo.com/raw/", "hello beta"), "hello beta")
    }).pipe(
      Effect.provide(
        EchoService.layer.pipe(
          Layer.provide(HttpRecorder.layerWebSocketConstructor("websocket-echo", { directory: "examples/recordings" })),
          Layer.provide(NodeSocket.layerWebSocketConstructor),
        ),
      ),
    ),
  30_000,
)
