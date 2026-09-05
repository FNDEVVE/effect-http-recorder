import { describe, expect, it } from "@effect/vitest"
import { Deferred, Effect, Exit, Fiber, FileSystem, Layer } from "effect"
import { Socket } from "effect/unstable/socket"
import { HttpRecorder } from "../src"
import type { WebSocketInteraction } from "../src/websocket/model"
import { layerSocketWithMode } from "../src/websocket/recorder"
import { fromMap, readCassette, seedCassetteDirectory, tempDirectory, testLayer } from "./support"

const unavailableSocket = Socket.make({
  runRaw: () => Effect.die(new Error("unexpected live WebSocket run")),
  writer: Effect.succeed(() => Effect.die(new Error("unexpected live WebSocket write"))),
})

class SocketClosedEvent extends Event implements CloseEvent {
  readonly wasClean: boolean

  constructor(
    readonly code: number,
    readonly reason: string,
  ) {
    super("close")
    this.wasClean = code === 1000
  }
}

class EchoWebSocket extends EventTarget implements WebSocket {
  readonly CONNECTING = 0
  readonly OPEN = 1
  readonly CLOSING = 2
  readonly CLOSED = 3
  onopen: ((this: WebSocket, event: Event) => unknown) | null = null
  onerror: ((this: WebSocket, event: Event) => unknown) | null = null
  onmessage: ((this: WebSocket, event: MessageEvent) => unknown) | null = null
  onclose: ((this: WebSocket, event: CloseEvent) => unknown) | null = null
  readonly protocol = ""
  readonly extensions = ""
  bufferedAmount = 0
  binaryType: BinaryType = "blob"
  readyState: WebSocket["readyState"] = 0

  constructor(readonly url: string) {
    super()
    this.addEventListener("open", (event) => this.onopen?.call(this, event))
    this.addEventListener("error", (event) => this.onerror?.call(this, event))
    this.addEventListener("message", (event) => {
      if (event instanceof MessageEvent) this.onmessage?.call(this, event)
    })
    this.addEventListener("close", (event) => {
      if (event instanceof SocketClosedEvent) this.onclose?.call(this, event)
    })
    queueMicrotask(() => {
      this.readyState = 1
      this.dispatchEvent(new Event("open"))
    })
  }

  send(data: BufferSource | Blob | string) {
    queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data })))
  }

  close(code = 1000, reason = "") {
    if (this.readyState === 3) return
    this.readyState = 3
    this.dispatchEvent(new SocketClosedEvent(code, reason))
  }
}

describe("WebSocket", () => {
  it.effect("constructor recording is complete when the recorder layer closes", () =>
    Effect.gen(function* () {
      const directory = yield* tempDirectory("http-recorder-websocket-constructor-")
      const recorder = HttpRecorder.layerWebSocketConstructor("websocket/constructor-record", {
        directory: directory.path,
      }).pipe(Layer.provide(Layer.succeed(Socket.WebSocketConstructor, (url) => new EchoWebSocket(url))))

      yield* Effect.gen(function* () {
        const socket = yield* Socket.makeWebSocket("wss://echo.example.test/one", {
          protocols: ["echo.v1"],
          closeCodeIsError: () => false,
        })
        const write = yield* socket.writer
        yield* socket.runString(() => write(new Socket.CloseEvent(1000, "complete")).pipe(Effect.orDie), {
          onOpen: write("hello").pipe(Effect.orDie),
        })
      }).pipe(Effect.scoped, Effect.provide(recorder), Effect.provide(fromMap(new Map())))

      expect((yield* readCassette(`${directory.path}/websocket/constructor-record.json`)).interactions).toEqual([
        {
          transport: "websocket",
          connection: {
            sequence: 0,
            url: "wss://echo.example.test/one",
            protocols: ["echo.v1"],
            close: { code: 1000, reason: "complete" },
          },
          events: [
            { direction: "client", kind: "text", body: "hello" },
            { direction: "server", kind: "text", body: "hello" },
          ],
        },
      ])
    }).pipe(Effect.provide(testLayer)),
  )

  it.effect("constructor replay validates dynamic URLs and protocols without opening a live socket", () =>
    Effect.gen(function* () {
      const directory = yield* tempDirectory("http-recorder-websocket-constructor-")
      yield* seedCassetteDirectory(directory.path, "websocket/constructor", [
        {
          transport: "websocket",
          connection: {
            sequence: 0,
            url: "wss://events.example.test/workspaces/one",
            protocols: ["events.v1"],
            close: { code: 1000, reason: "complete" },
          },
          events: [
            { direction: "client", kind: "text", body: '{"type":"subscribe"}' },
            { direction: "server", kind: "text", body: '{"type":"ready"}' },
          ],
        },
      ])
      const unavailableConstructor = () => {
        throw new Error("unexpected live WebSocket construction")
      }
      const recorder = HttpRecorder.layerWebSocketConstructor("websocket/constructor", {
        directory: directory.path,
      }).pipe(Layer.provide(Layer.succeed(Socket.WebSocketConstructor, unavailableConstructor)))

      const received = yield* Effect.gen(function* () {
        const socket = yield* Socket.makeWebSocket("wss://events.example.test/workspaces/one", {
          protocols: ["events.v1"],
          closeCodeIsError: () => false,
        })
        const write = yield* socket.writer
        const received: string[] = []
        yield* socket.runString(
          (message) => {
            received.push(message)
          },
          {
            onOpen: write('{"type":"subscribe"}').pipe(Effect.orDie),
          },
        )
        return received
      }).pipe(Effect.scoped, Effect.provide(recorder))

      expect(received).toEqual(['{"type":"ready"}'])
    }).pipe(Effect.provide(testLayer)),
  )

  it.effect("constructor replay drains long server spans before processing queued sends", () =>
    Effect.gen(function* () {
      const directory = yield* tempDirectory("http-recorder-websocket-queued-sends-")
      const url = "wss://events.example.test/queued-sends"
      const serverMessages = Array.from({ length: 10_000 }, (_, index) => String(index))
      yield* seedCassetteDirectory(directory.path, "websocket/queued-sends", [
        {
          transport: "websocket",
          connection: { sequence: 0, url, protocols: [], close: { code: 1000, reason: "complete" } },
          events: [
            { direction: "client", kind: "text", body: "A" },
            ...serverMessages.map((body) => ({ direction: "server" as const, kind: "text" as const, body })),
            { direction: "client", kind: "text", body: "B" },
            { direction: "server", kind: "text", body: "done" },
          ],
        },
      ])
      const recorder = HttpRecorder.layerWebSocketConstructor("websocket/queued-sends", {
        directory: directory.path,
      }).pipe(
        Layer.provide(
          Layer.succeed(Socket.WebSocketConstructor, () => {
            throw new Error("Unexpected live WebSocket construction")
          }),
        ),
      )

      yield* Effect.gen(function* () {
        const construct = yield* Socket.WebSocketConstructor
        const handlerMessages: string[] = []
        const listenerMessages: string[] = []
        const terminal = yield* Effect.callback<{ code: number; reason: string; wasClean: boolean }, Error>(
          (resume) => {
            const socket = construct(url)
            socket.onopen = () => {
              socket.send("A")
              socket.send("B")
            }
            socket.onmessage = (event) => handlerMessages.push(event.data)
            socket.onerror = () => resume(Effect.fail(new Error("Unexpected replay error")))
            socket.addEventListener("message", (event) => listenerMessages.push(event.data))
            socket.addEventListener("close", (event) => {
              resume(Effect.succeed({ code: event.code, reason: event.reason, wasClean: event.wasClean }))
            })
            return Effect.sync(() => socket.close())
          },
        )
        expect(handlerMessages).toEqual([...serverMessages, "done"])
        expect(listenerMessages).toEqual([...serverMessages, "done"])
        expect(terminal).toEqual({ code: 1000, reason: "complete", wasClean: true })
      }).pipe(Effect.scoped, Effect.provide(recorder))
    }).pipe(Effect.provide(testLayer)),
  )

  it.effect("terminal-frame Blob mismatches emit error and abnormal close to listeners and handlers", () =>
    Effect.gen(function* () {
      const directory = yield* tempDirectory("http-recorder-websocket-terminal-blob-")
      const url = "wss://events.example.test/terminal"
      yield* seedCassetteDirectory(directory.path, "websocket/terminal-blob", [
        {
          transport: "websocket",
          connection: { sequence: 0, url, protocols: [], close: { code: 1000, reason: "complete" } },
          events: [{ direction: "server", kind: "text", body: "done" }],
        },
      ])
      const recorder = HttpRecorder.layerWebSocketConstructor("websocket/terminal-blob", {
        directory: directory.path,
      }).pipe(
        Layer.provide(
          Layer.succeed(Socket.WebSocketConstructor, () => {
            throw new Error("Unexpected live WebSocket construction")
          }),
        ),
      )

      yield* Effect.gen(function* () {
        const construct = yield* Socket.WebSocketConstructor
        const observed: string[] = []
        const terminal = yield* Effect.callback<{ code: number; wasClean: boolean }>((resume) => {
          const socket = construct(url)
          socket.onerror = () => observed.push("error-handler")
          socket.onclose = () => observed.push("close-handler")
          socket.addEventListener("error", () => observed.push("error-listener"))
          socket.addEventListener("message", (event) => {
            observed.push(`message:${event.data}`)
            socket.send(new Blob(["unexpected-client-frame"]))
          })
          socket.addEventListener("close", (event) => {
            observed.push("close-listener")
            resume(Effect.succeed({ code: event.code, wasClean: event.wasClean }))
          })
          return Effect.sync(() => socket.close())
        })
        expect(terminal).toEqual({ code: 1006, wasClean: false })
        expect(observed).toEqual(["message:done", "error-handler", "error-listener", "close-handler", "close-listener"])
      }).pipe(Effect.provide(recorder))
    }).pipe(Effect.provide(testLayer)),
  )

  it.effect("constructor replay rejects a different dynamic URL", () =>
    Effect.gen(function* () {
      const directory = yield* tempDirectory("http-recorder-websocket-constructor-")
      yield* seedCassetteDirectory(directory.path, "websocket/constructor-mismatch", [
        {
          transport: "websocket",
          connection: {
            sequence: 0,
            url: "wss://events.example.test/workspaces/one",
            protocols: [],
            close: { code: 1000, reason: "complete" },
          },
          events: [],
        },
      ])
      const recorder = HttpRecorder.layerWebSocketConstructor("websocket/constructor-mismatch", {
        directory: directory.path,
      }).pipe(
        Layer.provide(
          Layer.succeed(Socket.WebSocketConstructor, () => {
            throw new Error("unexpected live WebSocket construction")
          }),
        ),
      )

      const exit = yield* Effect.gen(function* () {
        const socket = yield* Socket.makeWebSocket("wss://events.example.test/workspaces/two")
        yield* socket.runString(() => {})
      }).pipe(Effect.scoped, Effect.exit, Effect.provide(recorder))

      expect(Exit.isFailure(exit)).toBe(true)
    }).pipe(Effect.provide(testLayer)),
  )

  it.effect("records WebSocket frames in observed client/server order", () =>
    Effect.gen(function* () {
      const directory = yield* tempDirectory("http-recorder-websocket-")
      const response = JSON.stringify({
        type: "response.completed",
        token: "server-secret",
      })
      const upstream = Socket.make({
        runRaw: (handler, options) =>
          Effect.gen(function* () {
            if (options?.onOpen) yield* options.onOpen
            const result = handler(response)
            if (Effect.isEffect(result)) yield* result
          }),
        writer: Effect.succeed(() => Effect.void),
      })

      yield* Effect.gen(function* () {
        const socket = yield* Socket.Socket
        const write = yield* socket.writer
        yield* socket.runRaw(() => {}, {
          onOpen: write(JSON.stringify({ type: "response.create", token: "client-secret" })).pipe(Effect.orDie),
        })
      }).pipe(
        Effect.scoped,
        Effect.provide(
          layerSocketWithMode("websocket/record", {
            directory: directory.path,
            metadata: { provider: "test" },
            mode: "record",
          }).pipe(Layer.provide(Layer.succeed(Socket.Socket, upstream))),
        ),
      )

      expect(yield* readCassette(`${directory.path}/websocket/record.json`)).toMatchObject({
        interactions: [
          {
            transport: "websocket",
            events: [
              {
                direction: "client",
                kind: "text",
                body: '{"type":"response.create","token":"[REDACTED]"}',
              },
              {
                direction: "server",
                kind: "text",
                body: '{"type":"response.completed","token":"[REDACTED]"}',
              },
            ],
          },
        ],
      })
    }).pipe(Effect.provide(testLayer)),
  )

  it.effect("WebSocket replay preserves causal frame ordering", () =>
    Effect.gen(function* () {
      const directory = yield* tempDirectory("http-recorder-websocket-")
      yield* seedCassetteDirectory(directory.path, "websocket/replay", [
        {
          transport: "websocket",
          events: [
            {
              direction: "server",
              kind: "text",
              body: '{"type":"session.created"}',
            },
            {
              direction: "client",
              kind: "text",
              body: '{"type":"response.create","prompt":"hello"}',
            },
            {
              direction: "server",
              kind: "text",
              body: '{"type":"response.completed"}',
            },
          ],
        },
      ])

      const received: string[] = []
      yield* Effect.gen(function* () {
        const socket = yield* Socket.Socket
        const write = yield* socket.writer
        yield* socket.runRaw((message) =>
          Effect.gen(function* () {
            if (typeof message !== "string") return
            received.push(message)
            const event: unknown = JSON.parse(message)
            if (typeof event !== "object" || event === null || !("type" in event)) return
            if (event.type === "session.created") yield* write('{"prompt":"hello","type":"response.create"}')
          }),
        )
      }).pipe(
        Effect.scoped,
        Effect.provide(
          layerSocketWithMode("websocket/replay", {
            directory: directory.path,
            compareClientMessagesAsJson: true,
            mode: "replay",
          }).pipe(Layer.provide(Layer.succeed(Socket.Socket, unavailableSocket))),
        ),
      )

      expect(received).toEqual(['{"type":"session.created"}', '{"type":"response.completed"}'])
    }).pipe(Effect.provide(testLayer)),
  )

  it.effect("the public socket decorator replays a causal provider conversation", () =>
    Effect.gen(function* () {
      const directory = yield* tempDirectory("http-recorder-websocket-")
      yield* seedCassetteDirectory(directory.path, "websocket/public-layer", [
        {
          transport: "websocket",
          events: [
            {
              direction: "server",
              kind: "text",
              body: '{"type":"session.created"}',
            },
            {
              direction: "client",
              kind: "text",
              body: '{"type":"response.create","prompt":"first"}',
            },
            {
              direction: "server",
              kind: "text",
              body: '{"type":"response.completed","id":"first"}',
            },
            {
              direction: "client",
              kind: "text",
              body: '{"type":"response.create","prompt":"second"}',
            },
            {
              direction: "server",
              kind: "text",
              body: '{"type":"response.completed","id":"second"}',
            },
          ],
        },
      ])

      const received: string[] = []
      yield* Effect.gen(function* () {
        const socket = yield* Socket.Socket
        const write = yield* socket.writer
        yield* socket.runString((message) =>
          Effect.gen(function* () {
            received.push(message)
            const event: unknown = JSON.parse(message)
            if (typeof event !== "object" || event === null) return
            if ("type" in event && event.type === "session.created") {
              yield* write('{"prompt":"first","type":"response.create"}')
              return
            }
            if ("id" in event && event.id === "first") {
              yield* write('{"prompt":"second","type":"response.create"}')
              return
            }
            yield* write(new Socket.CloseEvent(1000, "done"))
          }),
        )
      }).pipe(
        Effect.scoped,
        Effect.provide(
          HttpRecorder.layerSocket("websocket/public-layer", { directory: directory.path }).pipe(
            Layer.provide(Layer.succeed(Socket.Socket, unavailableSocket)),
          ),
        ),
      )

      expect(received).toEqual([
        '{"type":"session.created"}',
        '{"type":"response.completed","id":"first"}',
        '{"type":"response.completed","id":"second"}',
      ])
    }).pipe(Effect.provide(testLayer)),
  )

  it.effect("WebSocket replay runs message handlers concurrently", () =>
    Effect.gen(function* () {
      const directory = yield* tempDirectory("http-recorder-websocket-")
      yield* seedCassetteDirectory(directory.path, "websocket/concurrent-handlers", [
        {
          transport: "websocket",
          events: [
            { direction: "server", kind: "text", body: "first" },
            { direction: "server", kind: "text", body: "second" },
          ],
        },
      ])

      yield* Effect.gen(function* () {
        const socket = yield* Socket.Socket
        const second = yield* Deferred.make<void>()
        yield* socket.runString((message) =>
          message === "first" ? Deferred.await(second) : Deferred.succeed(second, undefined),
        )
      }).pipe(
        Effect.scoped,
        Effect.provide(
          layerSocketWithMode("websocket/concurrent-handlers", { directory: directory.path, mode: "replay" }).pipe(
            Layer.provide(Layer.succeed(Socket.Socket, unavailableSocket)),
          ),
        ),
      )
    }).pipe(Effect.provide(testLayer)),
  )

  it.effect("rejected concurrent replay does not consume the next interaction", () =>
    Effect.gen(function* () {
      const directory = yield* tempDirectory("http-recorder-websocket-")
      yield* seedCassetteDirectory(directory.path, "websocket/concurrent-runs", [
        { transport: "websocket", events: [{ direction: "server", kind: "text", body: "first" }] },
        { transport: "websocket", events: [{ direction: "server", kind: "text", body: "second" }] },
      ])

      const received: string[] = []
      yield* Effect.gen(function* () {
        const socket = yield* Socket.Socket
        const started = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const first = yield* socket
          .runString((message) =>
            Effect.gen(function* () {
              received.push(message)
              yield* Deferred.succeed(started, undefined)
              yield* Deferred.await(release)
            }),
          )
          .pipe(Effect.forkChild)
        yield* Deferred.await(started)

        const concurrent = yield* Effect.exit(socket.runString(() => Effect.void))
        expect(Exit.isFailure(concurrent)).toBe(true)

        yield* Deferred.succeed(release, undefined)
        yield* Fiber.join(first)
        yield* socket.runString((message) => Effect.sync(() => received.push(message)))
      }).pipe(
        Effect.scoped,
        Effect.provide(
          layerSocketWithMode("websocket/concurrent-runs", { directory: directory.path, mode: "replay" }).pipe(
            Layer.provide(Layer.succeed(Socket.Socket, unavailableSocket)),
          ),
        ),
      )

      expect(received).toEqual(["first", "second"])
    }).pipe(Effect.provide(testLayer)),
  )

  it.effect("WebSocket replay rejects close with unconsumed events", () =>
    Effect.gen(function* () {
      const directory = yield* tempDirectory("http-recorder-websocket-")
      yield* seedCassetteDirectory(directory.path, "websocket/early-close", [
        {
          transport: "websocket",
          events: [{ direction: "client", kind: "text", body: "expected" }],
        },
      ])

      const exit = yield* Effect.gen(function* () {
        const socket = yield* Socket.Socket
        const write = yield* socket.writer
        return yield* Effect.exit(
          socket.runRaw(() => {}, {
            onOpen: write(new Socket.CloseEvent(1000)).pipe(Effect.orDie),
          }),
        )
      }).pipe(
        Effect.scoped,
        Effect.provide(
          layerSocketWithMode("websocket/early-close", { directory: directory.path, mode: "replay" }).pipe(
            Layer.provide(Layer.succeed(Socket.Socket, unavailableSocket)),
          ),
        ),
      )

      expect(Exit.isFailure(exit)).toBe(true)
    }).pipe(Effect.provide(testLayer)),
  )

  it.effect("failed WebSocket runs do not write complete cassettes", () =>
    Effect.gen(function* () {
      const directory = yield* tempDirectory("http-recorder-websocket-")
      const exit = yield* Effect.gen(function* () {
        const socket = yield* Socket.Socket
        return yield* Effect.exit(socket.runRaw(() => {}))
      }).pipe(
        Effect.scoped,
        Effect.provide(
          layerSocketWithMode("websocket/failed-run", { directory: directory.path, mode: "record" }).pipe(
            Layer.provide(
              Layer.succeed(
                Socket.Socket,
                Socket.make({
                  runRaw: () => Effect.die(new Error("connection failed")),
                  writer: Effect.succeed(() => Effect.void),
                }),
              ),
            ),
          ),
        ),
      )

      expect(Exit.isFailure(exit)).toBe(true)
      const fs = yield* FileSystem.FileSystem
      expect(yield* fs.exists(`${directory.path}/websocket/failed-run.json`)).toBe(false)
    }).pipe(Effect.provide(testLayer)),
  )

  it.effect("WebSocket replay preserves binary frame kinds across reconnects", () =>
    Effect.gen(function* () {
      const directory = yield* tempDirectory("http-recorder-websocket-")
      const interaction: WebSocketInteraction = {
        transport: "websocket",
        events: [
          {
            direction: "client",
            kind: "binary",
            body: Buffer.from([1, 2]).toString("base64"),
            bodyEncoding: "base64",
          },
          {
            direction: "server",
            kind: "binary",
            body: Buffer.from([3, 4]).toString("base64"),
            bodyEncoding: "base64",
          },
        ],
      }
      yield* seedCassetteDirectory(directory.path, "websocket/binary", [interaction, interaction])

      const received: number[][] = []
      yield* Effect.gen(function* () {
        const socket = yield* Socket.Socket
        const write = yield* socket.writer
        const run = socket.runRaw(
          (message) => {
            if (typeof message === "string") throw new Error("Expected a binary WebSocket frame")
            received.push([...message])
          },
          { onOpen: write(new Uint8Array([1, 2])).pipe(Effect.orDie) },
        )
        yield* run
        yield* run
      }).pipe(
        Effect.scoped,
        Effect.provide(
          layerSocketWithMode("websocket/binary", { directory: directory.path, mode: "replay" }).pipe(
            Layer.provide(Layer.succeed(Socket.Socket, unavailableSocket)),
          ),
        ),
      )

      expect(received).toEqual([
        [3, 4],
        [3, 4],
      ])
    }).pipe(Effect.provide(testLayer)),
  )

  for (const adapter of ["socket", "constructor"] as const) {
    describe(`shared replay contract: ${adapter}`, () => {
      const url = "wss://events.example.test/shared-contract"
      const protocols = ["contract.v1"]
      const replayLayer = (directory: string, name: string) =>
        adapter === "socket"
          ? HttpRecorder.layerSocket(name, { directory }).pipe(
              Layer.provide(Layer.succeed(Socket.Socket, unavailableSocket)),
            )
          : Layer.effect(
              Socket.Socket,
              Socket.makeWebSocket(url, { protocols, closeCodeIsError: (code) => code !== 1000 }),
            ).pipe(
              Layer.provide(
                HttpRecorder.layerWebSocketConstructor(name, { directory }).pipe(
                  Layer.provide(
                    Layer.succeed(Socket.WebSocketConstructor, () => {
                      throw new Error("unexpected live WebSocket construction")
                    }),
                  ),
                ),
              ),
            )
      const interaction = (events: WebSocketInteraction["events"]): WebSocketInteraction => ({
        transport: "websocket",
        connection: { sequence: 0, url, protocols, close: { code: 1000, reason: "complete" } },
        events,
      })

      it.effect("alternates text and binary with canonical JSON and concurrent handler writes", () =>
        Effect.gen(function* () {
          const directory = yield* tempDirectory("http-recorder-shared-")
          const name = "websocket/alternation"
          yield* seedCassetteDirectory(directory.path, name, [
            interaction([
              { direction: "server", kind: "text", body: "ready" },
              { direction: "client", kind: "text", body: '{"type":"subscribe","options":{"a":1,"b":2}}' },
              { direction: "server", kind: "binary", body: "AwQ=", bodyEncoding: "base64" },
              { direction: "client", kind: "binary", body: "AQI=", bodyEncoding: "base64" },
              { direction: "server", kind: "text", body: "done" },
            ]),
          ])

          const received: Array<string | number[]> = []
          yield* Effect.gen(function* () {
            const socket = yield* Socket.Socket
            const write = yield* socket.writer
            const completed = yield* Deferred.make<void>()
            yield* socket.runRaw((message) =>
              Effect.gen(function* () {
                received.push(typeof message === "string" ? message : [...message])
                if (message === "ready") {
                  yield* write('{"options":{"b":2,"a":1},"type":"subscribe"}')
                  yield* Deferred.await(completed)
                } else if (message instanceof Uint8Array) {
                  yield* write(new Uint8Array([1, 2]))
                } else {
                  yield* Deferred.succeed(completed, undefined)
                }
              }),
            )
            yield* Deferred.await(completed)
          }).pipe(Effect.scoped, Effect.provide(replayLayer(directory.path, name)))

          expect(received).toEqual(["ready", [3, 4], "done"])
        }).pipe(Effect.provide(testLayer)),
      )

      for (const rejection of ["mismatched frame", "premature close"] as const) {
        it.effect(`rejects a ${rejection} without delivering later server frames`, () =>
          Effect.gen(function* () {
            const directory = yield* tempDirectory("http-recorder-shared-rejection-")
            const name = "websocket/rejected"
            yield* seedCassetteDirectory(directory.path, name, [
              interaction([
                { direction: "server", kind: "text", body: "ready" },
                { direction: "client", kind: "text", body: "expected" },
                { direction: "server", kind: "text", body: "must not arrive" },
              ]),
            ])

            const received: string[] = []
            const error = yield* Effect.gen(function* () {
              const socket = yield* Socket.Socket
              const write = yield* socket.writer
              return yield* socket
                .runString((message) =>
                  Effect.gen(function* () {
                    received.push(message)
                    yield* write(rejection === "mismatched frame" ? "wrong" : new Socket.CloseEvent(1000))
                  }),
                )
                .pipe(Effect.flip)
            }).pipe(Effect.scoped, Effect.provide(replayLayer(directory.path, name)))

            expect(Socket.isSocketError(error)).toBe(true)
            expect(received).toEqual(["ready"])
          }).pipe(Effect.provide(testLayer)),
        )
      }

      it.effect("scope closure interrupts a suspended handler and pending transcript read", () =>
        Effect.gen(function* () {
          const directory = yield* tempDirectory("http-recorder-shared-interruption-")
          const name = "websocket/interrupted"
          yield* seedCassetteDirectory(directory.path, name, [
            interaction([
              { direction: "server", kind: "text", body: "ready" },
              { direction: "client", kind: "text", body: "never sent" },
              { direction: "server", kind: "text", body: "must not arrive" },
            ]),
          ])

          const started = yield* Deferred.make<void>()
          const finalized = yield* Deferred.make<Exit.Exit<never>>()
          const received: string[] = []
          const fiber = yield* Effect.gen(function* () {
            const socket = yield* Socket.Socket
            const fiber = yield* socket
              .runString((message) =>
                Effect.gen(function* () {
                  received.push(message)
                  yield* Deferred.succeed(started, undefined)
                  return yield* Effect.never
                }).pipe(Effect.onExit((exit) => Deferred.succeed(finalized, exit))),
              )
              .pipe(Effect.forkScoped)
            yield* Deferred.await(started)
            return fiber
          }).pipe(Effect.scoped, Effect.provide(replayLayer(directory.path, name)))

          expect(Exit.hasInterrupts(yield* Deferred.await(finalized))).toBe(true)
          expect(Exit.hasInterrupts(yield* Fiber.await(fiber))).toBe(true)
          expect(received).toEqual(["ready"])
        }).pipe(Effect.provide(testLayer)),
      )
    })
  }
})
