import { NodeFileSystem } from "@effect/platform-node-shared"
import { Deferred, Effect, Exit, FiberSet, Layer, Option, Ref, Scope, Semaphore } from "effect"
import { Socket } from "effect/unstable/socket"
import * as CassetteService from "../cassette/store.js"
import type { SocketRecorderOptions } from "../options.js"
import { make, type Redactor } from "../redaction/redactor.js"
import { canonicalizeJson, decodeJson, safeText } from "../replay/comparison.js"
import { makeReplayState, resolveAutoMode } from "../replay/state.js"
import { webSocketInteractions } from "../cassette/model.js"
import type { WebSocketEvent, WebSocketInteraction } from "./model.js"

interface WebSocketRecorderOptions extends SocketRecorderOptions {
  readonly compareClientMessagesAsJson?: boolean
}

interface ActiveReplay {
  readonly interaction: WebSocketInteraction
  readonly progress: Ref.Ref<{
    readonly position: number
    readonly changed: Deferred.Deferred<void>
  }>
  readonly writeLock: Semaphore.Semaphore
  readonly closed: Ref.Ref<boolean>
}

interface ActiveRecording {
  readonly events: Array<WebSocketEvent>
  readonly eventLock: Semaphore.Semaphore
  readonly accepting: Ref.Ref<boolean>
  opened: boolean
  valid: boolean
}

type Frame = string | Uint8Array

const encodeEvent = (direction: "client" | "server", message: Frame): WebSocketEvent =>
  typeof message === "string"
    ? { direction, kind: "text", body: message }
    : {
        direction,
        kind: "binary",
        body: Buffer.from(message).toString("base64"),
        bodyEncoding: "base64",
      }

const decodeEvent = (event: WebSocketEvent): Frame =>
  event.kind === "text" ? event.body : new Uint8Array(Buffer.from(event.body, "base64"))

const redactEvent = (event: WebSocketEvent, redactor: Redactor): WebSocketEvent => {
  if (event.kind === "binary") return event
  const body =
    event.direction === "client"
      ? redactor.request({
          method: "WEBSOCKET",
          url: "",
          headers: {},
          body: event.body,
        }).body
      : redactor.response({ status: 101, headers: {}, body: event.body }).body
  return { ...event, body }
}

const comparable = (event: WebSocketEvent, asJson: boolean) => {
  if (!asJson || event.kind === "binary") return JSON.stringify(canonicalizeJson(event))
  const decoded = decodeJson(event.body)
  return JSON.stringify(
    canonicalizeJson({
      ...event,
      body: decoded._tag === "None" ? event.body : canonicalizeJson(decoded.value),
    }),
  )
}

const assertEvent = (actual: WebSocketEvent, expected: WebSocketEvent | undefined, index: number, asJson: boolean) =>
  Effect.sync(() => {
    if (expected && comparable(actual, asJson) === comparable(expected, asJson)) return
    throw new Error(`WebSocket event ${index + 1}: expected ${safeText(expected)}, received ${safeText(actual)}`)
  })

const runHandler = <A, E, R>(handler: (value: A) => Effect.Effect<unknown, E, R> | void, value: A) =>
  Effect.suspend(() => {
    const result = handler(value)
    return Effect.isEffect(result) ? Effect.asVoid(result) : Effect.void
  })

const runReplay = <A, E, R>(
  state: ActiveReplay,
  handler: (value: A) => Effect.Effect<unknown, E, R> | void,
  decode: (event: WebSocketEvent) => A,
  onOpen: Effect.Effect<void> | undefined,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const handlers = yield* FiberSet.make<unknown, E>()
      const run = yield* FiberSet.runtime(handlers)<R>()
      if (onOpen) yield* onOpen

      const drive = Effect.gen(function* () {
        while (true) {
          const current = yield* Ref.get(state.progress)
          const event = state.interaction.events[current.position]
          if (!event) return
          if (yield* Ref.get(state.closed))
            return yield* Effect.die(
              new Error(
                `WebSocket closed with unconsumed events: used ${current.position} of ${state.interaction.events.length}`,
              ),
            )
          if (event.direction === "server") {
            yield* Ref.set(state.progress, {
              position: current.position + 1,
              changed: yield* Deferred.make<void>(),
            })
            run(runHandler(handler, decode(event)))
            continue
          }
          yield* Deferred.await(current.changed)
        }
      })

      yield* drive.pipe(Effect.raceFirst(FiberSet.join(handlers)))
      yield* FiberSet.awaitEmpty(handlers).pipe(Effect.raceFirst(FiberSet.join(handlers)))
    }),
  )

const makeRecordingSocket = (
  upstream: Socket.Socket,
  cassette: CassetteService.Interface,
  name: string,
  options: WebSocketRecorderOptions,
  redactor: Redactor,
) =>
  Effect.gen(function* () {
    const active = yield* Ref.make<ActiveRecording | undefined>(undefined)
    const writeLock = yield* Semaphore.make(1)

    return Socket.make({
      runRaw: (handler, runOptions) =>
        Effect.gen(function* () {
          const state: ActiveRecording = {
            events: [],
            eventLock: yield* Semaphore.make(1),
            accepting: yield* Ref.make(true),
            opened: false,
            valid: true,
          }
          const occupied = yield* Ref.modify(active, (current) => [current !== undefined, current ?? state])
          if (occupied) return yield* Effect.die("Concurrent runs of a recorded WebSocket are not supported")
          yield* upstream
            .runRaw(
              (message) => {
                if (!Ref.getUnsafe(state.accepting)) throw new Error("WebSocket received a frame after closing")
                state.events.push(redactEvent(encodeEvent("server", message), redactor))
                return handler(message)
              },
              {
                ...runOptions,
                onOpen: Effect.gen(function* () {
                  state.opened = true
                  if (runOptions?.onOpen) yield* runOptions.onOpen
                }),
              },
            )
            .pipe(
              Effect.onExit((exit) =>
                writeLock.withPermit(
                  state.eventLock.withPermit(
                    Effect.gen(function* () {
                      yield* Ref.set(state.accepting, false)
                      yield* Ref.set(active, undefined)
                      if (!Exit.isSuccess(exit) || !state.opened || !state.valid) return
                      yield* cassette
                        .append(
                          name,
                          {
                            transport: "websocket",
                            events: [...state.events],
                          },
                          options.metadata,
                        )
                        .pipe(Effect.orDie)
                    }),
                  ),
                ),
              ),
            )
        }),
      writer: upstream.writer.pipe(
        Effect.map(
          (write) => (message) =>
            writeLock.withPermit(
              Effect.gen(function* () {
                if (Socket.isCloseEvent(message)) return yield* write(message)
                const state = yield* Ref.get(active)
                if (!state || !(yield* Ref.get(state.accepting)))
                  return yield* Effect.die("WebSocket writer used without an active socket run")
                const event = redactEvent(encodeEvent("client", message), redactor)
                yield* state.eventLock.withPermit(Effect.sync(() => state.events.push(event)))
                return yield* write(message).pipe(Effect.onError(() => Effect.sync(() => (state.valid = false))))
              }),
            ),
        ),
      ),
    })
  })

const makeReplaySocket = (
  cassette: CassetteService.Interface,
  name: string,
  options: WebSocketRecorderOptions,
  redactor: Redactor,
): Effect.Effect<Socket.Socket, never, Scope.Scope> =>
  Effect.gen(function* () {
    const replay = yield* makeReplayState(cassette, name, webSocketInteractions)
    const active = yield* Ref.make<ActiveReplay | undefined>(undefined)
    const runLock = yield* Semaphore.make(1)

    return Socket.make({
      runRaw: (handler, runOptions) =>
        runLock
          .withPermitsIfAvailable(1)(
            Effect.gen(function* () {
              const claimed = yield* replay
                .claim((interaction) =>
                  interaction ? Effect.void : Effect.die("Missing recorded WebSocket interaction"),
                )
                .pipe(Effect.orDie)
              const state = {
                interaction: claimed.interaction,
                progress: yield* Ref.make({
                  position: 0,
                  changed: yield* Deferred.make<void>(),
                }),
                writeLock: yield* Semaphore.make(1),
                closed: yield* Ref.make(false),
              }
              yield* Ref.set(active, state)
              yield* runReplay(state, handler, decodeEvent, runOptions?.onOpen).pipe(
                Effect.ensuring(Ref.set(active, undefined)),
              )
            }),
          )
          .pipe(
            Effect.flatMap(
              Option.match({
                onNone: () => Effect.die("Concurrent runs of a replayed WebSocket are not supported"),
                onSome: () => Effect.void,
              }),
            ),
          ),
      writer: Effect.succeed((message) => {
        return Ref.get(active).pipe(
          Effect.flatMap((state) =>
            state
              ? state.writeLock.withPermit(
                  Effect.gen(function* () {
                    const current = yield* Ref.get(state.progress)
                    if (Socket.isCloseEvent(message)) {
                      yield* Ref.set(state.closed, true)
                      yield* Deferred.succeed(current.changed, undefined)
                      if (current.position === state.interaction.events.length) return
                      return yield* Effect.die(
                        new Error(
                          `WebSocket closed with unconsumed events: used ${current.position} of ${state.interaction.events.length}`,
                        ),
                      )
                    }
                    const actual = redactEvent(encodeEvent("client", message), redactor)
                    yield* assertEvent(
                      actual,
                      state.interaction.events[current.position],
                      current.position,
                      options.compareClientMessagesAsJson === true,
                    )
                    yield* Ref.set(state.progress, {
                      position: current.position + 1,
                      changed: yield* Deferred.make<void>(),
                    })
                    yield* Deferred.succeed(current.changed, undefined)
                  }),
                )
              : Effect.die("WebSocket writer used without an active socket run"),
          ),
        )
      }),
    })
  })

const recordingLayer = (
  name: string,
  options: WebSocketRecorderOptions,
  forcedMode?: "record" | "replay",
): Layer.Layer<Socket.Socket, never, Socket.Socket | CassetteService.Service> =>
  Layer.effect(
    Socket.Socket,
    Effect.gen(function* () {
      const upstream = yield* Socket.Socket
      const cassette = yield* CassetteService.Service
      const redactor = make(options.redact)
      if ((forcedMode ?? (yield* resolveAutoMode(cassette, name))) === "record")
        return yield* makeRecordingSocket(upstream, cassette, name, options, redactor)
      return yield* makeReplaySocket(cassette, name, options, redactor)
    }),
  )

/**
 * Wraps a provided `Socket.Socket` with cassette recording and replay.
 *
 * Supply the ordinary URL-bound Effect socket layer beneath this decorator.
 * The cassette name identifies the connection during replay; recorder
 * configuration does not duplicate or validate the transport URL.
 *
 * A recording is committed only after the socket run completes successfully.
 * Replay releases server frames in order and waits at each recorded client
 * frame until the application writes a matching frame.
 */
export const socket = (
  name: string,
  options: SocketRecorderOptions = {},
): Layer.Layer<Socket.Socket, never, Socket.Socket> =>
  provideCassette(recordingLayer(name, { ...options, compareClientMessagesAsJson: true }), options)

/** @internal */
export const socketLayer = (
  name: string,
  options: WebSocketRecorderOptions & { readonly mode: "record" | "replay" },
): Layer.Layer<Socket.Socket, never, Socket.Socket> =>
  provideCassette(recordingLayer(name, options, options.mode), options)

const provideCassette = (
  layer: Layer.Layer<Socket.Socket, never, Socket.Socket | CassetteService.Service>,
  options: WebSocketRecorderOptions,
) =>
  layer.pipe(
    Layer.provide(CassetteService.fileSystem({ directory: options.directory })),
    Layer.provide(NodeFileSystem.layer),
  )
