import { Effect, FiberSet, Option, Ref, Semaphore } from "effect"
import { Socket } from "effect/unstable/socket"
import type { SocketRecorderOptions } from "../api.js"
import * as CassetteService from "../cassette/store.js"
import { webSocketInteractions } from "../cassette/model.js"
import type { Redactor } from "../redaction/redactor.js"
import { makeReplayState } from "../replay/state.js"
import type { WebSocketEvent } from "./model.js"
import {
  encodeEvent,
  makeReplayTranscript,
  redactEvent,
  socketReadError,
  socketWriteError,
  type Frame,
  type ReplayTranscript,
} from "./transcript.js"

export interface WebSocketRecorderOptions extends SocketRecorderOptions {
  readonly compareClientMessagesAsJson?: boolean
}

interface ActiveRecording {
  readonly events: Array<WebSocketEvent>
  readonly accepting: Ref.Ref<boolean>
  opened: boolean
  valid: boolean
}

const runHandler = <A, E, R>(handler: (value: A) => Effect.Effect<unknown, E, R> | void, value: A) =>
  Effect.suspend(() => {
    const result = handler(value)
    return Effect.isEffect(result) ? Effect.asVoid(result) : Effect.void
  })

export const makeRecordingSocket = Effect.fn("WebSocket.makeRecordingSocket")(
  (
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
              accepting: yield* Ref.make(true),
              opened: false,
              valid: true,
            }
            const occupied = yield* Ref.modify(active, (current) => [current !== undefined, current ?? state])
            if (occupied)
              return yield* Effect.fail(socketReadError("Concurrent runs of a recorded WebSocket are not supported"))
            yield* upstream
              .runRaw(
                (message) => {
                  // Encode at receipt, before an upstream buffer can be reused or
                  // concurrent handler fibers can reorder the recorded frames.
                  const accepting = Ref.getUnsafe(state.accepting)
                  if (accepting) state.events.push(redactEvent(encodeEvent("server", message), redactor))
                  return Effect.gen(function* () {
                    if (!accepting)
                      return yield* Effect.fail(socketReadError("WebSocket received a frame after closing"))
                    yield* runHandler(handler, message)
                  })
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
                Effect.andThen(
                  writeLock.withPermit(
                    Effect.gen(function* () {
                      yield* Ref.set(state.accepting, false)
                      if (!state.opened || !state.valid) return
                      yield* cassette
                        .append(name, { transport: "websocket", events: state.events }, options.metadata)
                        .pipe(Effect.mapError(socketReadError))
                    }),
                  ),
                ),
                Effect.ensuring(
                  writeLock.withPermit(
                    Ref.set(state.accepting, false).pipe(Effect.andThen(Ref.set(active, undefined))),
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
                    return yield* Effect.fail(socketWriteError("WebSocket writer used without an active socket run"))
                  const event = redactEvent(encodeEvent("client", message), redactor)
                  state.events.push(event)
                  return yield* write(message).pipe(Effect.onError(() => Effect.sync(() => (state.valid = false))))
                }),
              ),
          ),
        ),
      })
    }),
)

const runReplay = Effect.fn("WebSocket.runReplay")(function* <E, R>(
  transcript: ReplayTranscript,
  handler: (value: Frame) => Effect.Effect<unknown, E, R> | void,
  onOpen: Effect.Effect<void> | undefined,
) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handlers = yield* FiberSet.make<unknown, E>()
      const run = yield* FiberSet.runtime(handlers)<R>()
      if (onOpen) yield* onOpen
      const drive = Effect.gen(function* () {
        while (true) {
          const frame = yield* transcript.read
          if (frame === undefined) return
          run(runHandler(handler, frame))
        }
      })
      yield* drive.pipe(Effect.raceFirst(FiberSet.join(handlers)))
      yield* FiberSet.awaitEmpty(handlers).pipe(Effect.raceFirst(FiberSet.join(handlers)))
    }),
  )
})

export const makeReplaySocket = Effect.fn("WebSocket.makeReplaySocket")(function* (
  cassette: CassetteService.Interface,
  name: string,
  options: WebSocketRecorderOptions,
  redactor: Redactor,
  secrets: Record<string, string>,
) {
  const replay = yield* makeReplayState(cassette, name, webSocketInteractions)
  const active = yield* Ref.make<ReplayTranscript | undefined>(undefined)
  const runLock = yield* Semaphore.make(1)

  return Socket.make({
    runRaw: (handler, runOptions) =>
      runLock
        .withPermitsIfAvailable(1)(
          Effect.gen(function* () {
            const claimed = yield* replay.claim((interaction) =>
              interaction ? Effect.void : Effect.fail(socketReadError("Missing recorded WebSocket interaction")),
            )
            const transcript = yield* makeReplayTranscript(claimed.interaction, {
              redactor,
              compareClientMessagesAsJson: options.compareClientMessagesAsJson === true,
              secrets,
            })
            yield* Ref.set(active, transcript)
            yield* runReplay(transcript, handler, runOptions?.onOpen).pipe(Effect.ensuring(Ref.set(active, undefined)))
          }),
        )
        .pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.fail(socketReadError("Concurrent runs of a replayed WebSocket are not supported")),
              onSome: () => Effect.void,
            }),
          ),
        ),
    writer: Effect.succeed((message) =>
      Ref.get(active).pipe(
        Effect.flatMap((transcript) =>
          transcript
            ? transcript.write(message)
            : Effect.fail(socketWriteError("WebSocket writer used without an active socket run")),
        ),
      ),
    ),
  })
})
