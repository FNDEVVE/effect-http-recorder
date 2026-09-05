import { NodeFileSystem, NodePath } from "@effect/platform-node-shared"
import { Deferred, Effect, Encoding, Exit, FiberSet, Layer, Match, Ref, Result } from "effect"
import {
  FetchHttpClient,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http"
import * as CassetteService from "../cassette/store.js"
import type { RecorderOptions } from "../api.js"
import { make, redactUrl, type Redactor } from "../redaction/redactor.js"
import { makeReplayPoolState, resolveAutoMode } from "../replay/state.js"
import { httpInteractions } from "../cassette/model.js"
import { defaultMatcher, selectFirstMatching, type RequestMatcher } from "./matching.js"
import type { HttpInteraction, ResponseSnapshot } from "./model.js"
import type { CassetteMetadata } from "../cassette/model.js"
import { configuredSecrets } from "../redaction/secrets.js"

export { defaultMatcher }

export type RecordReplayMode = "auto" | "record" | "replay" | "passthrough"

export interface RecordReplayOptions {
  readonly mode?: RecordReplayMode
  readonly directory?: string
  readonly metadata?: CassetteMetadata
  readonly redactor?: Redactor
  readonly match?: RequestMatcher
}

const TEXT_CONTENT_TYPES = new Set([
  "application/graphql",
  "application/javascript",
  "application/json",
  "application/sql",
  "application/x-www-form-urlencoded",
  "application/xml",
  "application/yaml",
  "image/svg+xml",
])

const isTextContentType = (contentType: string | undefined) => {
  const mediaType = contentType?.split(";", 1)[0]?.trim().toLowerCase()
  if (!mediaType) return false
  return (
    mediaType.startsWith("text/") ||
    mediaType.endsWith("+json") ||
    mediaType.endsWith("+xml") ||
    TEXT_CONTENT_TYPES.has(mediaType)
  )
}

const captureResponseBody = (response: HttpClientResponse.HttpClientResponse, contentType: string | undefined) =>
  response.arrayBuffer.pipe(
    Effect.map((bytes) => ({
      bytes,
      snapshot: isTextContentType(contentType)
        ? { body: new TextDecoder().decode(bytes) }
        : {
            body: Encoding.encodeBase64(new Uint8Array(bytes)),
            bodyEncoding: "base64" as const,
          },
    })),
  )

const decodeResponseBody = (snapshot: ResponseSnapshot) => {
  if (snapshot.bodyEncoding !== "base64") return snapshot.body
  const bytes = Result.getOrThrow(Encoding.decodeBase64(snapshot.body))
  // Encoding allocates a dedicated ArrayBuffer; narrow its declared ArrayBufferLike without copying.
  if (!(bytes.buffer instanceof ArrayBuffer)) throw new Error("Unsupported shared response buffer")
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

const responseFromSnapshot = (
  request: HttpClientRequest.HttpClientRequest,
  snapshot: ResponseSnapshot,
  capturedBody?: ArrayBuffer,
) =>
  Effect.try({
    try: () =>
      HttpClientResponse.fromWeb(
        request,
        new Response(
          request.method === "HEAD" || snapshot.status === 204 || snapshot.status === 205 || snapshot.status === 304
            ? null
            : (capturedBody ?? decodeResponseBody(snapshot)),
          snapshot,
        ),
      ),
    catch: () => transportError(request, "Invalid recorded HTTP response"),
  })

export const redactedErrorRequest = (
  request: HttpClientRequest.HttpClientRequest,
  redactedUrl = redactUrl(request.url),
) => HttpClientRequest.make(request.method)(redactedUrl)

const transportError = (request: HttpClientRequest.HttpClientRequest, description: string, redactedUrl?: string) =>
  new HttpClientError.HttpClientError({
    reason: new HttpClientError.TransportError({
      request: redactedErrorRequest(request, redactedUrl),
      description,
    }),
  })

export const recordingLayer = (name: string, options: Omit<RecordReplayOptions, "directory"> = {}) =>
  Layer.effect(
    HttpClient.HttpClient,
    Effect.gen(function* () {
      const upstream = yield* HttpClient.HttpClient
      const cassetteService = yield* CassetteService.Service
      const redactor = options.redactor ?? make()
      const match = options.match ?? defaultMatcher
      const requested = options.mode ?? "auto"
      const mode = requested === "auto" ? yield* resolveAutoMode(cassetteService, name) : requested

      if (mode === "passthrough") return upstream
      const secrets = yield* configuredSecrets.pipe(
        Effect.mapError(
          () =>
            new CassetteService.InvalidCassetteError({
              cassetteName: name,
              description: "Could not load configuration for secret protection",
            }),
        ),
      )
      const snapshotRequest = Effect.fn("HttpRecorder.snapshotRequest")(function* (
        request: HttpClientRequest.HttpClientRequest,
        signal: AbortSignal,
      ) {
        const web = yield* HttpClientRequest.toWeb(request, { signal }).pipe(
          Effect.mapError(() => transportError(request, "Could not encode request")),
        )
        return redactor.request({
          method: web.method,
          url: web.url,
          headers: Object.fromEntries(web.headers.entries()),
          body: yield* Effect.tryPromise({
            try: () => web.text(),
            catch: () => transportError(request, "Could not read request body"),
          }),
        })
      })

      if (mode === "record") {
        const completions = yield* FiberSet.make<void, never>()
        const initial = yield* Deferred.make<void>()
        yield* Deferred.succeed(initial, undefined)
        const tail = yield* Ref.make(initial)
        return HttpClient.make((request, _url, signal) =>
          Effect.uninterruptibleMask((restore) =>
            Effect.gen(function* () {
              const completed = yield* Deferred.make<void>()
              const previous = yield* Ref.modify(tail, (current) => [current, completed])
              return yield* restore(
                Effect.gen(function* () {
                  const incoming = yield* snapshotRequest(request, signal)
                  const requestError = (description: string) => transportError(request, description, incoming.url)
                  const response = yield* upstream.execute(request)
                  const captured = yield* captureResponseBody(response, response.headers["content-type"])
                  const responseSnapshot: ResponseSnapshot = {
                    status: response.status,
                    headers: response.headers,
                    ...captured.snapshot,
                  }
                  const interaction: HttpInteraction = {
                    transport: "http",
                    request: incoming,
                    response: redactor.response(responseSnapshot),
                  }
                  yield* Deferred.await(previous)
                  yield* cassetteService
                    .append(name, interaction, options.metadata)
                    .pipe(Effect.mapError((error) => requestError(error.message)))
                  return yield* responseFromSnapshot(request, responseSnapshot, captured.bytes)
                }),
              ).pipe(
                Effect.onExit((exit) =>
                  Exit.isSuccess(exit)
                    ? Deferred.succeed(completed, undefined)
                    : FiberSet.run(
                        completions,
                        Deferred.await(previous).pipe(
                          Effect.andThen(Deferred.succeed(completed, undefined)),
                          Effect.asVoid,
                          Effect.interruptible,
                        ),
                      ).pipe(Effect.asVoid),
                ),
              )
            }),
          ),
        )
      }

      const replay = yield* makeReplayPoolState(cassetteService, name, httpInteractions)
      return HttpClient.make((request, _url, signal) =>
        Effect.gen(function* () {
          const incoming = yield* snapshotRequest(request, signal)
          const requestError = (description: string) => transportError(request, description, incoming.url)
          const claimed = yield* replay.claim((interactions, used) =>
            Match.value(selectFirstMatching(interactions, incoming, match, used, secrets)).pipe(
              Match.tagsExhaustive({
                Matched: ({ index }) => Effect.succeed(index),
                Unmatched: ({ detail }) =>
                  Effect.fail(requestError(`Fixture "${name}" does not match the current request: ${detail}.`)),
              }),
            ),
          )
          return yield* responseFromSnapshot(request, claimed.interaction.response)
        }),
      )
    }),
  )

export const cassetteLayer = (name: string, options: RecordReplayOptions = {}) =>
  recordingLayer(name, options).pipe(
    Layer.provide(CassetteService.fileSystem({ directory: options.directory })),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(NodeFileSystem.layer),
    Layer.provide(NodePath.layer),
  )

/**
 * Wraps a provided `HttpClient` with cassette recording and replay.
 *
 * Locally, a missing cassette is recorded from the real service. Existing
 * cassettes are replayed, and `CI=true` makes a missing cassette fail.
 */
export const layer = (name: string, options: RecorderOptions = {}) =>
  recordingLayer(name, {
    metadata: options.metadata,
    redactor: make(options.redact),
    match: options.match,
  }).pipe(
    Layer.provide(CassetteService.fileSystem({ directory: options.directory })),
    Layer.provide(NodeFileSystem.layer),
    Layer.provide(NodePath.layer),
  )

/** Provides a fetch-backed `HttpClient` with cassette recording and replay. */
export const layerFetch = (name: string, options: RecorderOptions = {}) =>
  layer(name, options).pipe(Layer.provide(FetchHttpClient.layer))
