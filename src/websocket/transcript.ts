import { Deferred, Effect, Encoding, Option, Ref, Result, Semaphore } from "effect"
import { Socket } from "effect/unstable/socket"
import type { Redactor } from "../redaction/redactor.js"
import { canonicalizeJson, decodeJson, safeText } from "../replay/comparison.js"
import type { WebSocketEvent, WebSocketInteraction } from "./model.js"

export type Frame = string | Uint8Array

export const socketReadError = (cause: unknown): Socket.SocketError =>
  new Socket.SocketError({ reason: new Socket.SocketReadError({ cause }) })
export const socketWriteError = (cause: unknown): Socket.SocketError =>
  new Socket.SocketError({ reason: new Socket.SocketWriteError({ cause }) })

export const encodeEvent = (direction: "client" | "server", message: Frame): WebSocketEvent =>
  typeof message === "string"
    ? { direction, kind: "text", body: message }
    : { direction, kind: "binary", body: Encoding.encodeBase64(message), bodyEncoding: "base64" }

export const decodeEvent = (event: WebSocketEvent): Frame =>
  event.kind === "text" ? event.body : Result.getOrThrow(Encoding.decodeBase64(event.body))

export const redactEvent = (event: WebSocketEvent, redactor: Redactor): WebSocketEvent => {
  if (event.kind === "binary") return event
  const body =
    event.direction === "client"
      ? redactor.request({ method: "WEBSOCKET", url: "", headers: {}, body: event.body }).body
      : redactor.response({ status: 101, headers: {}, body: event.body }).body
  return { ...event, body }
}

const comparable = (event: WebSocketEvent, asJson: boolean) => {
  if (!asJson || event.kind === "binary") return JSON.stringify(canonicalizeJson(event))
  const decoded = decodeJson(event.body)
  return JSON.stringify(
    canonicalizeJson({
      ...event,
      body: Option.match(decoded, { onNone: () => event.body, onSome: canonicalizeJson }),
    }),
  )
}

export interface ReplayTranscript {
  readonly read: Effect.Effect<Frame | undefined, Socket.SocketError>
  readonly awaitWriteReady: Effect.Effect<void>
  readonly write: (message: Frame | Socket.CloseEvent) => Effect.Effect<void, Socket.SocketError>
}

interface Progress {
  readonly position: number
  readonly changed: Deferred.Deferred<void>
  readonly writeReady: Deferred.Deferred<void>
  readonly closed: boolean
}

type Next = { readonly frame: Frame | undefined } | { readonly wait: Deferred.Deferred<void> }

export const makeReplayTranscript = Effect.fn("WebSocket.makeReplayTranscript")(function* (
  interaction: WebSocketInteraction,
  options: {
    readonly redactor: Redactor
    readonly compareClientMessagesAsJson: boolean
    readonly secrets: Record<string, string>
  },
): Effect.fn.Return<ReplayTranscript> {
  const progress = yield* Ref.make<Progress>({
    position: 0,
    changed: yield* Deferred.make<void>(),
    writeReady: yield* Deferred.make<void>(),
    closed: false,
  })
  const lock = yield* Semaphore.make(1)
  const unconsumed = (position: number) =>
    new Error(`WebSocket closed with unconsumed events: used ${position} of ${interaction.events.length}`)
  const advance = (current: Progress, writeReady = current.writeReady) =>
    Effect.gen(function* () {
      yield* Ref.set(progress, {
        position: current.position + 1,
        changed: yield* Deferred.make<void>(),
        writeReady,
        closed: false,
      })
      yield* Deferred.succeed(current.changed, undefined)
    })

  const read = Effect.gen(function* () {
    while (true) {
      // Claim before exposing the frame, but never await a writer or run a handler
      // under the lock. Advancing and notifying form one cancellation-safe step.
      const next: Next = yield* lock.withPermit(
        Effect.uninterruptible(
          Effect.gen(function* () {
            const current = yield* Ref.get(progress)
            const event = interaction.events[current.position]
            if (!event) {
              yield* Deferred.succeed(current.writeReady, undefined)
              return { frame: undefined }
            }
            if (current.closed) return yield* Effect.fail(socketReadError(unconsumed(current.position)))
            if (event.direction === "client") {
              // The next read acknowledges delivery of the previous server frame.
              // Keep this separate from changed, which wakes reads after writes.
              yield* Deferred.succeed(current.writeReady, undefined)
              return { wait: current.changed }
            }
            const frame = decodeEvent(event)
            yield* advance(current)
            return { frame }
          }),
        ),
      )
      if ("frame" in next) return next.frame
      yield* Deferred.await(next.wait)
    }
  })

  const awaitWriteReady = Effect.flatMap(Ref.get(progress), (current) => Deferred.await(current.writeReady))

  const write = Effect.fn("WebSocket.writeTranscript")((message: Frame | Socket.CloseEvent) =>
    lock.withPermit(
      Effect.uninterruptible(
        Effect.gen(function* () {
          const current = yield* Ref.get(progress)
          if (current.closed) return yield* Effect.fail(socketWriteError("WebSocket is closed"))
          if (Socket.isCloseEvent(message)) {
            yield* Ref.set(progress, { ...current, closed: true })
            yield* Deferred.succeed(current.changed, undefined)
            yield* Deferred.succeed(current.writeReady, undefined)
            if (current.position !== interaction.events.length)
              return yield* Effect.fail(socketWriteError(unconsumed(current.position)))
            return
          }
          const actual = redactEvent(encodeEvent("client", message), options.redactor)
          const expected = interaction.events[current.position]
          if (
            !expected ||
            comparable(actual, options.compareClientMessagesAsJson) !==
              comparable(expected, options.compareClientMessagesAsJson)
          )
            return yield* Effect.fail(
              socketWriteError(
                new Error(
                  `WebSocket event ${current.position + 1}: expected ${safeText(expected, options.secrets)}, received ${safeText(actual, options.secrets)}`,
                ),
              ),
            )
          yield* advance(current, yield* Deferred.make<void>())
        }),
      ),
    ),
  )

  return { read, awaitWriteReady, write }
})
