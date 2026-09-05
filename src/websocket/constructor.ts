import { Cause, Deferred, Effect, Fiber, FiberSet } from "effect"
import { Socket } from "effect/unstable/socket"
import type { SocketRecorderOptions } from "../api.js"
import { webSocketInteractions, type Interaction } from "../cassette/model.js"
import type * as CassetteService from "../cassette/store.js"
import type { Redactor } from "../redaction/redactor.js"
import { safeText } from "../replay/comparison.js"
import { makeReplayState } from "../replay/state.js"
import type { WebSocketEvent } from "./model.js"
import { encodeEvent, makeReplayTranscript, redactEvent, type Frame, type ReplayTranscript } from "./transcript.js"

const normalizeProtocols = (protocols?: string | Array<string>): Array<string> =>
  protocols === undefined ? [] : typeof protocols === "string" ? [protocols] : [...protocols]

// Snapshot mutable binary inputs synchronously, before the caller can reuse them.
const captureFrame = (data: unknown): Effect.Effect<Frame, unknown> => {
  if (typeof data === "string") return Effect.succeed(data)
  if (data instanceof Blob)
    return Effect.tryPromise(() => data.arrayBuffer()).pipe(Effect.map((buffer) => new Uint8Array(buffer)))
  if (data instanceof ArrayBuffer) return Effect.succeed(new Uint8Array(data.slice(0)))
  if (ArrayBuffer.isView(data))
    return Effect.succeed(new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice())
  return Effect.fail(new Error(`Unsupported WebSocket frame: ${Object.prototype.toString.call(data)}`))
}

class RecordedCloseEvent extends Event implements CloseEvent {
  readonly wasClean: boolean
  constructor(
    readonly code: number,
    readonly reason: string,
  ) {
    super("close")
    this.wasClean = code === 1000
  }
}

class RecordedErrorEvent extends Event implements ErrorEvent {
  readonly filename = ""
  readonly lineno = 0
  readonly colno = 0
  readonly message: string
  constructor(readonly error: unknown) {
    super("error")
    this.message = error instanceof Error ? error.message : String(error)
  }
}

const closeEvent = (code: number, reason: string): CloseEvent =>
  typeof globalThis.CloseEvent === "function"
    ? new globalThis.CloseEvent("close", { code, reason, wasClean: code === 1000 })
    : new RecordedCloseEvent(code, reason)

const errorEvent = (error: unknown): ErrorEvent =>
  typeof globalThis.ErrorEvent === "function"
    ? new globalThis.ErrorEvent("error", { error, message: error instanceof Error ? error.message : String(error) })
    : new RecordedErrorEvent(error)

class ReplayWebSocket extends EventTarget implements globalThis.WebSocket {
  readonly CONNECTING = 0
  readonly OPEN = 1
  readonly CLOSING = 2
  readonly CLOSED = 3
  readonly extensions = ""
  readonly bufferedAmount = 0
  binaryType: BinaryType = "blob"
  readyState: 0 | 1 | 2 | 3 = 0
  onopen: ((this: WebSocket, event: Event) => unknown) | null = null
  onmessage: ((this: WebSocket, event: MessageEvent) => unknown) | null = null
  onerror: ((this: WebSocket, event: Event) => unknown) | null = null
  onclose: ((this: WebSocket, event: CloseEvent) => unknown) | null = null

  constructor(
    readonly url: string,
    readonly protocol: string,
    readonly send: (data: BufferSource | Blob | string) => void,
    readonly close: (code?: number, reason?: string) => void,
  ) {
    super()
    this.addEventListener("open", (event) => this.onopen?.call(this, event))
    this.addEventListener("message", (event) => {
      if (event instanceof MessageEvent) this.onmessage?.call(this, event)
    })
    this.addEventListener("error", (event) => this.onerror?.call(this, event))
    this.addEventListener("close", (event) => {
      if (
        event instanceof RecordedCloseEvent ||
        (typeof globalThis.CloseEvent === "function" && event instanceof globalThis.CloseEvent)
      )
        this.onclose?.call(this, event)
    })
  }
}

// Each queued callback is a scoped fiber. Deferred gates preserve event order
// without detaching Promise continuations from the layer's context or lifetime.
const makeCallbacks = Effect.fn("WebSocket.makeCallbacks")(function* (drain = false) {
  const fibers = yield* FiberSet.make<void, never>()
  const run = yield* FiberSet.runtime(fibers)()
  const resources = new Set<() => void>()
  let disposed = false
  let failure: Cause.Cause<unknown> | undefined
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      disposed = true
      for (const dispose of resources) dispose()
      resources.clear()
      if (drain) yield* FiberSet.awaitEmpty(fibers)
      // Native close may already have removed every error listener. The owning
      // scope must still observe a failed commit; finalizers have no typed error
      // channel, unlike Socket.runRaw's commit path above.
      if (failure !== undefined) yield* Effect.die(Cause.squash(failure))
    }),
  )
  return {
    run,
    resources,
    isDisposed: () => disposed,
    serial: (fail: (cause: unknown) => void) => {
      let previous: Effect.Effect<void> = Effect.void
      const pending = new Set<Fiber.Fiber<void, never>>()
      let cancelled = false
      const enqueue = (operation: Effect.Effect<void, unknown>) => {
        if (disposed || cancelled) return
        const before = previous
        const complete = Deferred.makeUnsafe<void>()
        previous = Deferred.await(complete)
        const fiber = run(
          before.pipe(
            Effect.andThen(operation),
            Effect.catchCause((cause) =>
              Effect.sync(() => {
                if (cancelled) return
                if (drain && failure === undefined) failure = cause
                fail(Cause.squash(cause))
              }),
            ),
            Effect.ensuring(Deferred.succeed(complete, undefined)),
          ),
        )
        pending.add(fiber)
        fiber.addObserver(() => pending.delete(fiber))
      }
      return {
        enqueue,
        cancel: () => {
          cancelled = true
          for (const fiber of pending) fiber.interruptUnsafe()
        },
      }
    },
  }
})

export const makeRecordingWebSocketConstructor = Effect.fn("WebSocket.makeRecordingConstructor")(function* (
  upstream: Socket.WebSocketConstructor["Service"],
  cassette: CassetteService.Interface,
  name: string,
  metadata: SocketRecorderOptions["metadata"],
  redactor: Redactor,
) {
  // Drain commits for closed connections; live connections are canceled on disposal.
  const callbacks = yield* makeCallbacks(true)
  let nextSequence = 0
  return (url: string, protocols?: string | Array<string>): globalThis.WebSocket => {
    if (callbacks.isDisposed()) throw new Error("WebSocket recorder scope is closed")
    const sequence = nextSequence++
    const requestedProtocols = normalizeProtocols(protocols)
    const native = upstream(url, requestedProtocols)
    const events: WebSocketEvent[] = []
    let opened = false
    let failed = false
    let closed = false

    const fail = (cause: unknown) => {
      if (failed) return
      failed = true
      native.dispatchEvent(errorEvent(cause))
      if (native.readyState < 2) native.close()
    }
    const { enqueue, cancel } = callbacks.serial(fail)
    const appendEvent = (direction: "client" | "server", frame: Effect.Effect<Frame, unknown>) => {
      enqueue(
        Effect.gen(function* () {
          if (failed) return
          events.push(redactEvent(encodeEvent(direction, yield* frame), redactor))
        }),
      )
    }
    const onOpen = () => {
      opened = true
    }
    const onMessage = (event: MessageEvent) => {
      if (!closed) appendEvent("server", captureFrame(event.data))
    }
    const onError = () => {
      failed = true
    }
    const detach = () => {
      native.removeEventListener("open", onOpen)
      native.removeEventListener("message", onMessage)
      native.removeEventListener("error", onError)
      native.removeEventListener("close", onClose)
      callbacks.resources.delete(dispose)
    }
    const dispose = () => {
      closed = true
      failed = true
      cancel()
      detach()
      if (native.readyState < 2) native.close()
    }
    const onClose = (event: CloseEvent) => {
      if (closed) return
      closed = true
      detach()
      enqueue(
        Effect.gen(function* () {
          if (!opened || failed) return
          const request = redactor.request({ method: "WEBSOCKET", url, headers: {}, body: "" })
          yield* cassette.append(
            name,
            {
              transport: "websocket",
              connection: {
                sequence,
                url: request.url,
                protocols: requestedProtocols,
                close: { code: event.code, reason: event.reason },
              },
              events,
            },
            metadata,
          )
        }),
      )
    }
    callbacks.resources.add(dispose)
    native.addEventListener("open", onOpen)
    native.addEventListener("message", onMessage)
    native.addEventListener("error", onError)
    native.addEventListener("close", onClose)

    return new Proxy(native, {
      get: (target, property) => {
        if (property === "send")
          return (data: BufferSource | Blob | string) => {
            const frame = captureFrame(data)
            target.send(data)
            if (!closed) appendEvent("client", frame)
          }
        const value: unknown = Reflect.get(target, property, target)
        return typeof value === "function" ? value.bind(target) : value
      },
      set: (target, property, value) => Reflect.set(target, property, value, target),
    })
  }
})

const constructorWebSocketInteractions = (interactions: ReadonlyArray<Interaction>) =>
  webSocketInteractions(interactions)
    .flatMap((interaction) =>
      interaction.connection === undefined ? [] : [{ interaction, sequence: interaction.connection.sequence }],
    )
    .sort((a, b) => a.sequence - b.sequence)
    .map(({ interaction }) => interaction)

export const makeReplayWebSocketConstructor = Effect.fn("WebSocket.makeReplayConstructor")(function* (
  cassette: CassetteService.Interface,
  name: string,
  redactor: Redactor,
  secrets: Record<string, string>,
) {
  const replay = yield* makeReplayState(cassette, name, constructorWebSocketInteractions)
  const callbacks = yield* makeCallbacks()
  return (url: string, protocols?: string | Array<string>): globalThis.WebSocket => {
    if (callbacks.isDisposed()) throw new Error("WebSocket recorder scope is closed")
    const requestedProtocols = normalizeProtocols(protocols)
    const request = redactor.request({ method: "WEBSOCKET", url, headers: {}, body: "" })
    let transcript: ReplayTranscript | undefined
    let terminal = { code: 1000, reason: "" }
    let finished = false
    let closeRequested = false
    let driver: Fiber.Fiber<void, never> | undefined
    let timer: ReturnType<typeof setTimeout> | undefined

    const clearTimer = () => {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    }
    const stop = () => {
      finished = true
      clearTimer()
      cancel()
      driver?.interruptUnsafe()
      callbacks.resources.delete(dispose)
      target.readyState = 3
    }
    const dispose = () => {
      if (finished) return
      stop()
      target.dispatchEvent(closeEvent(1001, "Recorder scope closed"))
    }
    const fail = (error: unknown) => {
      if (finished) return
      stop()
      target.dispatchEvent(errorEvent(error))
      target.dispatchEvent(closeEvent(1006, ""))
    }
    const finish = () => {
      if (finished) return
      stop()
      target.dispatchEvent(closeEvent(terminal.code, terminal.reason))
    }
    const { enqueue, cancel } = callbacks.serial(fail)
    const drive = (active: ReplayTranscript) =>
      Effect.gen(function* () {
        while (!finished) {
          const frame = yield* active.read
          if (finished) return
          if (frame === undefined) {
            // Native listeners get an event-loop turn before close. Queue the
            // terminal callback behind sends, including unresolved Blob reads.
            // This scheduling intentionally does not depend on Effect's Clock.
            timer = setTimeout(() => enqueue(Effect.sync(finish)), 0)
            return
          }
          const data =
            typeof frame === "string"
              ? frame
              : target.binaryType === "blob"
                ? new Blob([frame.buffer instanceof ArrayBuffer ? frame.buffer : new Uint8Array(frame).buffer])
                : frame.buffer
          target.dispatchEvent(new MessageEvent("message", { data }))
        }
      }).pipe(Effect.catchCause((cause) => Effect.sync(() => fail(Cause.squash(cause)))))
    const target = new ReplayWebSocket(
      url,
      requestedProtocols[0] ?? "",
      (data) => {
        const active = transcript
        if (!active || target.readyState !== 1 || closeRequested) throw new Error("WebSocket is not open")
        const frame = captureFrame(data)
        enqueue(
          Effect.gen(function* () {
            if (finished) return
            yield* active.write(yield* frame)
            // Drain the server span without waiting on read's next client event.
            yield* active.awaitWriteReady
          }),
        )
      },
      (code, reason) => {
        if (closeRequested || target.readyState === 3) return
        closeRequested = true
        target.readyState = 2
        enqueue(
          Effect.gen(function* () {
            if (finished) return
            if (!transcript) return fail(new Error("WebSocket closed before it opened"))
            yield* transcript.write(new Socket.CloseEvent(code, reason))
            finish()
          }),
        )
      },
    )
    callbacks.resources.add(dispose)
    // Defer even an already-cached claim so callers can install native listeners.
    enqueue(
      Effect.yieldNow.pipe(
        Effect.andThen(
          Effect.gen(function* () {
            const claimed = yield* replay.claim((recorded, index) =>
              Effect.try(() => {
                if (!recorded) throw new Error(`Missing recorded WebSocket connection ${index + 1}`)
                const connection = recorded.connection
                if (!connection) throw new Error(`WebSocket interaction ${index + 1} has no connection metadata`)
                if (connection.url !== request.url)
                  throw new Error(
                    `WebSocket connection ${index + 1}: expected URL ${safeText(connection.url, secrets)}, received ${safeText(request.url, secrets)}`,
                  )
                if (
                  connection.protocols.length !== requestedProtocols.length ||
                  connection.protocols.some((protocol, index) => protocol !== requestedProtocols[index])
                )
                  throw new Error(
                    `WebSocket connection ${index + 1}: expected protocols ${safeText(connection.protocols, secrets)}, received ${safeText(requestedProtocols, secrets)}`,
                  )
              }),
            )
            if (finished) return
            if (closeRequested) return fail(new Error("WebSocket closed before it opened"))
            const active = yield* makeReplayTranscript(claimed.interaction, {
              redactor,
              compareClientMessagesAsJson: true,
              secrets,
            })
            transcript = active
            terminal = claimed.interaction.connection?.close ?? terminal
            target.readyState = 1
            target.dispatchEvent(new Event("open"))
            // Keep the reader independent so readiness never waits on client input.
            driver = callbacks.run(drive(active))
            yield* active.awaitWriteReady
          }),
        ),
      ),
    )
    return target
  }
})
