import { NodeFileSystem, NodePath } from "@effect/platform-node-shared"
import { Effect, Layer } from "effect"
import { Socket } from "effect/unstable/socket"
import type { SocketRecorderOptions } from "../api.js"
import * as CassetteService from "../cassette/store.js"
import { configuredSecrets } from "../redaction/secrets.js"
import { make } from "../redaction/redactor.js"
import { resolveAutoMode } from "../replay/state.js"
import { makeRecordingWebSocketConstructor, makeReplayWebSocketConstructor } from "./constructor.js"
import { makeRecordingSocket, makeReplaySocket, type WebSocketRecorderOptions } from "./socket.js"

const recordingLayer = (name: string, options: WebSocketRecorderOptions, forcedMode?: "record" | "replay") =>
  Layer.effect(
    Socket.Socket,
    Effect.gen(function* () {
      const upstream = yield* Socket.Socket
      const cassette = yield* CassetteService.Service
      const redactor = make(options.redact)
      const env = yield* configuredSecrets.pipe(
        Effect.mapError(
          () =>
            new CassetteService.InvalidCassetteError({
              cassetteName: name,
              description: "Unable to read secret configuration",
            }),
        ),
      )
      if ((forcedMode ?? (yield* resolveAutoMode(cassette, name))) === "record")
        return yield* makeRecordingSocket(upstream, cassette, name, options, redactor)
      return yield* makeReplaySocket(cassette, name, options, redactor, env)
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
export const layerSocket = (name: string, options: SocketRecorderOptions = {}) =>
  provideCassette(recordingLayer(name, { ...options, compareClientMessagesAsJson: true }), options)

/** @internal */
export const layerSocketWithMode = (
  name: string,
  options: WebSocketRecorderOptions & { readonly mode: "record" | "replay" },
) => provideCassette(recordingLayer(name, options, options.mode), options)

const provideCassette = <A, E, R>(layer: Layer.Layer<A, E, R>, options: WebSocketRecorderOptions) =>
  layer.pipe(
    Layer.provide(CassetteService.fileSystem({ directory: options.directory })),
    Layer.provide(NodeFileSystem.layer),
    Layer.provide(NodePath.layer),
  )

/** Decorates Effect's WebSocket constructor so dynamic connections are recorded and replayed. */
export const layerWebSocketConstructor = (name: string, options: SocketRecorderOptions = {}) =>
  provideCassette(
    Layer.effect(
      Socket.WebSocketConstructor,
      Effect.gen(function* () {
        const upstream = yield* Socket.WebSocketConstructor
        const cassette = yield* CassetteService.Service
        const redactor = make(options.redact)
        const env = yield* configuredSecrets.pipe(
          Effect.mapError(
            () =>
              new CassetteService.InvalidCassetteError({
                cassetteName: name,
                description: "Unable to read secret configuration",
              }),
          ),
        )
        if ((yield* resolveAutoMode(cassette, name)) === "replay")
          return yield* makeReplayWebSocketConstructor(cassette, name, redactor, env)
        return yield* makeRecordingWebSocketConstructor(upstream, cassette, name, options.metadata, redactor)
      }),
    ),
    options,
  )
