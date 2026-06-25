import { NodeSocket } from "@effect/platform-node"
import { assert, it } from "@effect/vitest"
import { Context, Effect, Fiber, Layer, Queue, Schema, Stream } from "effect"
import { Socket } from "effect/unstable/socket"
import { HttpRecorder } from "effect-http-recorder"

const Room = Schema.Literals(["general", "random"])
const ChatEvent = Schema.Union([
  Schema.Struct({ type: Schema.tag("join"), room: Room }),
  Schema.Struct({ type: Schema.tag("message"), room: Room, text: Schema.String }),
])
const ChatEventJson = Schema.fromJsonString(ChatEvent)

const rooms = {
  general: "wss://ws.postman-echo.com/raw",
  random: "wss://ws.postman-echo.com/raw/",
} as const

class Chat extends Context.Service<Chat>()("example/Chat", {
  make: Effect.gen(function* () {
    const constructor = yield* Socket.WebSocketConstructor

    const connect = Effect.fn("Chat.connect")(
      function* (room: keyof typeof rooms) {
        const socket = yield* Socket.makeWebSocket(rooms[room], { closeCodeIsError: () => false })
        const outgoing = yield* Queue.bounded<string | Socket.CloseEvent>(16)
        const incoming = yield* Stream.fromQueue(outgoing).pipe(
          Stream.pipeThroughChannel(Socket.toChannelString(socket)),
          Stream.mapEffect((message) => Schema.decodeEffect(ChatEventJson)(message)),
          Stream.toQueue({ capacity: 16 }),
        )

        yield* Schema.encodeEffect(ChatEventJson)({ type: "join", room }).pipe(
          Effect.flatMap((message) => Queue.offer(outgoing, message)),
        )
        const joined = yield* Queue.take(incoming)
        if (joined.type !== "join" || joined.room !== room) return yield* Effect.die(`Failed to join ${room}`)

        const messages = Stream.fromQueue(incoming).pipe(
          Stream.filter((event) => event.type === "message"),
          Stream.map(({ room, text }) => ({ room, text })),
        )
        const send = Effect.fn("ChatRoom.send")((text: string) =>
          Schema.encodeEffect(ChatEventJson)({ type: "message", room, text }).pipe(
            Effect.flatMap((message) => Queue.offer(outgoing, message)),
            Effect.asVoid,
          ),
        )
        yield* Effect.addFinalizer(() =>
          Queue.offer(outgoing, new Socket.CloseEvent(1000, `left ${room}`)).pipe(
            Effect.andThen(Stream.runDrain(messages)),
            Effect.orDie,
          ),
        )

        return { room, messages, send } as const
      },
      Effect.provideService(Socket.WebSocketConstructor, constructor),
    )

    return { connect } as const
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)
}

it.effect(
  "records messages across chat rooms",
  () =>
    Effect.gen(function* () {
      const chat = yield* Chat
      yield* Effect.scoped(
        Effect.gen(function* () {
          const general = yield* chat.connect("general")
          const random = yield* chat.connect("random")

          const generalMessages = yield* general.messages.pipe(
            Stream.take(3),
            Stream.runCollect,
            Effect.forkScoped({ startImmediately: true }),
          )
          const randomMessages = yield* random.messages.pipe(
            Stream.take(3),
            Stream.runCollect,
            Effect.forkScoped({ startImmediately: true }),
          )

          yield* general.send("Hello!")
          yield* random.send("Did you see that?")
          yield* general.send("Anyone around?")
          yield* random.send("Incredible")
          yield* general.send("See you later")
          yield* random.send("Wow")

          assert.deepStrictEqual(yield* Fiber.join(generalMessages), [
            { room: "general", text: "Hello!" },
            { room: "general", text: "Anyone around?" },
            { room: "general", text: "See you later" },
          ])
          assert.deepStrictEqual(yield* Fiber.join(randomMessages), [
            { room: "random", text: "Did you see that?" },
            { room: "random", text: "Incredible" },
            { room: "random", text: "Wow" },
          ])
        }),
      )
    }).pipe(
      Effect.provide(
        Chat.layer.pipe(
          Layer.provide(HttpRecorder.layerWebSocketConstructor("websocket-chat", { directory: "examples/recordings" })),
          Layer.provide(NodeSocket.layerWebSocketConstructor),
        ),
      ),
    ),
  30_000,
)
