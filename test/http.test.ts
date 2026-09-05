import { describe, expect, it } from "@effect/vitest"
import { Deferred, Effect, Exit, Fiber, FileSystem } from "effect"
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http"
import { isHttpInteraction } from "../src/cassette/model"
import { HttpRecorder, type RecorderOptions } from "../src"
import {
  failureText,
  fromMap,
  post,
  readCassette,
  seedCassetteDirectory,
  startServer,
  tempDirectory,
  testLayer,
} from "./support"

const run = <A, E>(effect: Effect.Effect<A, E, HttpClient.HttpClient>) =>
  effect.pipe(Effect.provide(HttpRecorder.layerFetch("http/multi-step")))

const runWith = <A, E>(name: string, options: RecorderOptions, effect: Effect.Effect<A, E, HttpClient.HttpClient>) =>
  effect.pipe(Effect.provide(HttpRecorder.layerFetch(name, options)), Effect.provide(fromMap(new Map())))

describe("HTTP", () => {
  it.effect("decorates a provided HTTP client", () =>
    Effect.gen(function* () {
      const responses = yield* Effect.all([
        post("https://example.test/echo", { step: 1 }),
        post("https://example.test/echo", { step: 2 }),
      ]).pipe(Effect.provide(HttpRecorder.layer("http/multi-step")), Effect.provide(FetchHttpClient.layer))
      expect(responses).toEqual(['{"reply":"first"}', '{"reply":"second"}'])
    }).pipe(Effect.provide(testLayer)),
  )

  it.effect("replay returns recorded responses in order for identical requests", () =>
    Effect.gen(function* () {
      yield* runWith(
        "http/retry",
        {},
        Effect.gen(function* () {
          expect(yield* post("https://example.test/poll", { id: "job_1" })).toBe('{"status":"pending"}')
          expect(yield* post("https://example.test/poll", { id: "job_1" })).toBe('{"status":"complete"}')
        }),
      )
    }).pipe(Effect.provide(testLayer)),
  )

  it.effect("replay reports exhaustion when more requests are made than recorded", () =>
    Effect.gen(function* () {
      yield* run(
        Effect.gen(function* () {
          yield* post("https://example.test/echo", { step: 1 })
          yield* post("https://example.test/echo", { step: 2 })
          const exit = yield* Effect.exit(post("https://example.test/echo", { step: 3 }))
          expect(Exit.isFailure(exit)).toBe(true)
        }),
      )
    }).pipe(Effect.provide(testLayer)),
  )

  it.effect("a mismatch does not consume an interaction", () =>
    Effect.gen(function* () {
      yield* run(
        Effect.gen(function* () {
          yield* post("https://example.test/echo", { step: 1 })
          const exit = yield* Effect.exit(post("https://example.test/echo", { step: 3 }))
          expect(Exit.isFailure(exit)).toBe(true)
          expect(yield* post("https://example.test/echo", { step: 2 })).toBe('{"reply":"second"}')
        }),
      )
    }).pipe(Effect.provide(testLayer)),
  )

  it.effect("distinct requests replay in any order", () =>
    Effect.gen(function* () {
      yield* run(
        Effect.gen(function* () {
          expect(yield* post("https://example.test/echo", { step: 2 })).toBe('{"reply":"second"}')
          expect(yield* post("https://example.test/echo", { step: 1 })).toBe('{"reply":"first"}')
        }),
      )
    }).pipe(Effect.provide(testLayer)),
  )

  it.effect("concurrent distinct requests atomically claim their matching interactions", () =>
    Effect.gen(function* () {
      const results = yield* run(
        Effect.all([post("https://example.test/echo", { step: 2 }), post("https://example.test/echo", { step: 1 })], {
          concurrency: "unbounded",
        }),
      )
      expect(results).toEqual(['{"reply":"second"}', '{"reply":"first"}'])
    }).pipe(Effect.provide(testLayer)),
  )

  it.effect("concurrent replay claims each interaction once", () =>
    Effect.gen(function* () {
      const results = yield* runWith(
        "http/retry",
        {},
        Effect.all(
          [post("https://example.test/poll", { id: "job_1" }), post("https://example.test/poll", { id: "job_1" })],
          { concurrency: "unbounded" },
        ),
      )
      expect(results.toSorted()).toEqual(['{"status":"complete"}', '{"status":"pending"}'])
    }).pipe(Effect.provide(testLayer)),
  )

  it.effect("mismatch diagnostics redact request secrets", () =>
    Effect.gen(function* () {
      const configuredSecret = "configured-private-value-123"
      yield* run(
        Effect.gen(function* () {
          const exit = yield* Effect.exit(
            post("https://example.test/echo?api_key=secret-value", {
              step: 3,
              token: "sk-123456789012345678901234",
              safe: configuredSecret,
            }),
          )
          expect(Exit.isFailure(exit)).toBe(true)
          const message = failureText(exit)
          expect(message).not.toContain("secret-value")
          expect(message).not.toContain("sk-123456789012345678901234")
          expect(message).not.toContain(configuredSecret)
        }),
      ).pipe(Effect.provide(fromMap(new Map([["PROVIDER_API_KEY", configuredSecret]]))))
    }).pipe(Effect.provide(testLayer)),
  )

  it.effect("applies custom URL redaction to mismatch errors", () =>
    Effect.gen(function* () {
      const secret = "private-account"
      const exit = yield* Effect.exit(
        post(`https://example.test/${secret}`, { step: 1 }).pipe(
          Effect.provide(
            HttpRecorder.layerFetch("http/multi-step", {
              redact: { url: (url) => url.replace(secret, "{account}") },
            }),
          ),
        ),
      )
      expect(Exit.isFailure(exit)).toBe(true)
      const message = failureText(exit)
      expect(message).toContain("https://example.test/{account}")
      expect(message).not.toContain(secret)
    }).pipe(Effect.provide(testLayer)),
  )

  it.effect("fails when a non-empty replay cassette is completely unused", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        Effect.void.pipe(Effect.scoped, Effect.provide(HttpRecorder.layerFetch("http/multi-step"))),
      )
      expect(Exit.isFailure(exit)).toBe(true)
    }).pipe(Effect.provide(testLayer)),
  )

  it.effect("fails to acquire an unused replay layer when the cassette is missing", () =>
    Effect.gen(function* () {
      const directory = yield* tempDirectory("http-recorder-unused-missing-")
      const exit = yield* Effect.exit(
        Effect.void.pipe(
          Effect.scoped,
          Effect.provide(HttpRecorder.layerFetch("missing-cassette", { directory: directory.path })),
          Effect.provide(fromMap(new Map([["CI", "true"]]))),
        ),
      )
      expect(Exit.isFailure(exit)).toBe(true)
    }).pipe(Effect.provide(testLayer)),
  )

  it.effect("rejects a response leaking a secret from the injected configuration", () =>
    Effect.gen(function* () {
      const directory = yield* tempDirectory("http-recorder-config-secret-")
      const secret = "configured-private-value-123"
      const server = yield* startServer(Effect.succeed(HttpServerResponse.text(secret)))
      const exit = yield* Effect.exit(
        post(`${server.url}/secret`, { ok: true }).pipe(
          Effect.provide(HttpRecorder.layerFetch("unsafe", { directory: directory.path })),
          Effect.provide(fromMap(new Map([["SERVICE_SECRET", secret]]))),
        ),
      )
      expect(Exit.isFailure(exit)).toBe(true)
      expect(failureText(exit)).not.toContain(secret)
      const fs = yield* FileSystem.FileSystem
      expect(yield* fs.exists(`${directory.path}/unsafe.json`)).toBe(false)
    }).pipe(Effect.provide(testLayer)),
  )

  describe("auto mode", () => {
    it.effect("preserves append order when the middle concurrent request is interrupted", () =>
      Effect.gen(function* () {
        const directory = yield* tempDirectory("http-recorder-cancel-order-")
        const firstStarted = yield* Deferred.make<void>()
        const middleStarted = yield* Deferred.make<void>()
        const lastStarted = yield* Deferred.make<void>()
        const releaseFirst = yield* Deferred.make<void>()
        const server = yield* startServer(
          Effect.gen(function* () {
            const request = yield* HttpServerRequest.HttpServerRequest
            if (request.url === "/first") {
              yield* Deferred.succeed(firstStarted, undefined)
              yield* Deferred.await(releaseFirst)
            } else if (request.url === "/middle") {
              yield* Deferred.succeed(middleStarted, undefined)
              yield* Deferred.await(releaseFirst)
            } else {
              yield* Deferred.succeed(lastStarted, undefined)
            }
            return HttpServerResponse.text(request.url)
          }),
        )
        yield* Effect.gen(function* () {
          const http = yield* HttpClient.HttpClient
          const request = (name: string) =>
            http
              .execute(HttpClientRequest.get(`${server.url}/${name}`))
              .pipe(Effect.flatMap((response) => response.text))
          const first = yield* request("first").pipe(Effect.forkScoped)
          yield* Deferred.await(firstStarted)
          const middle = yield* request("middle").pipe(Effect.forkScoped)
          yield* Deferred.await(middleStarted)
          const interruptMiddle = yield* Fiber.interrupt(middle).pipe(Effect.forkScoped)
          const last = yield* request("last").pipe(Effect.forkScoped)
          yield* Deferred.await(lastStarted)
          yield* Fiber.join(interruptMiddle)
          yield* Deferred.succeed(releaseFirst, undefined)
          expect(yield* Fiber.join(first)).toBe("/first")
          expect(yield* Fiber.join(last)).toBe("/last")
        }).pipe(
          Effect.provide(HttpRecorder.layerFetch("cancel-order", { directory: directory.path })),
          Effect.provide(fromMap(new Map())),
        )
        const cassette = yield* readCassette(`${directory.path}/cancel-order.json`)
        expect(cassette.interactions.filter(isHttpInteraction).map((interaction) => interaction.request.url)).toEqual([
          `${server.url}/first`,
          `${server.url}/last`,
        ])
      }).pipe(Effect.provide(testLayer)),
    )

    it.effect("replays when the cassette exists", () =>
      Effect.gen(function* () {
        const directory = yield* tempDirectory("http-recorder-auto-")
        yield* seedCassetteDirectory(directory.path, "auto-replay", [
          {
            transport: "http",
            request: {
              method: "POST",
              url: "https://example.test/echo",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ step: 1 }),
            },
            response: {
              status: 200,
              headers: { "content-type": "application/json" },
              body: '{"reply":"hi"}',
            },
          },
        ])
        const result = yield* runWith(
          "auto-replay",
          { directory: directory.path },
          post("https://example.test/echo", { step: 1 }),
        )
        expect(result).toBe('{"reply":"hi"}')
      }).pipe(Effect.provide(testLayer)),
    )

    it.effect("forces replay when CI=true even if cassette is missing", () =>
      Effect.gen(function* () {
        const directory = yield* tempDirectory("http-recorder-auto-ci-")
        const exit = yield* Effect.exit(
          post("https://example.test/echo", { step: 1 }).pipe(
            Effect.provide(HttpRecorder.layerFetch("missing-cassette", { directory: directory.path })),
            Effect.provide(fromMap(new Map([["CI", "true"]]))),
          ),
        )
        expect(Exit.isFailure(exit)).toBe(true)
      }).pipe(Effect.provide(testLayer)),
    )

    it.effect("records to disk when the cassette is missing", () =>
      Effect.gen(function* () {
        const directory = yield* tempDirectory("http-recorder-auto-record-")
        const server = yield* startServer(
          Effect.succeed(
            HttpServerResponse.text('{"reply":"recorded"}', {
              contentType: "application/json",
            }),
          ),
        )
        const url = `${server.url}/echo`
        const result = yield* runWith("auto-record", { directory: directory.path }, post(url, { step: 1 }))
        expect(result).toBe('{"reply":"recorded"}')
        const cassette = yield* readCassette(`${directory.path}/auto-record.json`)
        expect(cassette.interactions.filter(isHttpInteraction).map((interaction) => interaction.response.body)).toEqual(
          ['{"reply":"recorded"}'],
        )
      }).pipe(Effect.provide(testLayer)),
    )

    it.effect("records concurrent requests in request-start order", () =>
      Effect.gen(function* () {
        const directory = yield* tempDirectory("http-recorder-order-")
        const firstStarted = yield* Deferred.make<void>()
        const secondCompleted = yield* Deferred.make<void>()
        const completed: string[] = []
        const server = yield* startServer(
          Effect.gen(function* () {
            const request = yield* HttpServerRequest.HttpServerRequest
            const name = request.url.slice(1)
            if (name === "first") {
              yield* Deferred.succeed(firstStarted, undefined)
              yield* Deferred.await(secondCompleted)
              completed.push(name)
              return HttpServerResponse.text(name)
            }
            completed.push(name)
            yield* Deferred.succeed(secondCompleted, undefined)
            return HttpServerResponse.text(name)
          }),
        )
        const request = (name: string) =>
          Effect.gen(function* () {
            const http = yield* HttpClient.HttpClient
            const response = yield* http.execute(HttpClientRequest.get(`${server.url}/${name}`))
            return yield* response.text
          })
        const responses = yield* runWith(
          "concurrent-order",
          { directory: directory.path },
          Effect.all([request("first"), Deferred.await(firstStarted).pipe(Effect.andThen(request("second")))], {
            concurrency: "unbounded",
          }),
        )
        const cassette = yield* readCassette(`${directory.path}/concurrent-order.json`)
        expect(completed).toEqual(["second", "first"])
        expect(responses).toEqual(["first", "second"])
        expect(cassette.interactions.filter(isHttpInteraction).map((interaction) => interaction.request.url)).toEqual([
          `${server.url}/first`,
          `${server.url}/second`,
        ])
      }).pipe(Effect.provide(testLayer)),
    )

    it.effect("returns the live response while persisting its redacted snapshot", () =>
      Effect.gen(function* () {
        const directory = yield* tempDirectory("http-recorder-live-response-")
        const server = yield* startServer(
          Effect.succeed(
            HttpServerResponse.text(JSON.stringify({ access_token: "live-secret", safe: true }), {
              contentType: "application/json",
              headers: { "x-request-id": "request-1" },
            }),
          ),
        )
        const body = yield* runWith(
          "live-response",
          { directory: directory.path },
          post(`${server.url}/response`, { ok: true }),
        )
        const cassette = yield* readCassette(`${directory.path}/live-response.json`)
        const interaction = cassette.interactions.find(isHttpInteraction)
        expect(body).toBe('{"access_token":"live-secret","safe":true}')
        expect(interaction?.response.body).toBe('{"access_token":"[REDACTED]","safe":true}')
      }).pipe(Effect.provide(testLayer)),
    )

    it.effect("reconstructs responses with null-body statuses", () =>
      Effect.gen(function* () {
        const directory = yield* tempDirectory("http-recorder-no-content-")
        const server = yield* startServer(Effect.succeed(HttpServerResponse.empty({ status: 204 })))
        const program = Effect.gen(function* () {
          const http = yield* HttpClient.HttpClient
          const response = yield* http.execute(HttpClientRequest.get(`${server.url}/empty`))
          return { status: response.status, body: yield* response.text }
        })
        const response = yield* runWith("no-content", { directory: directory.path }, program)
        yield* server.stop
        const replay = yield* runWith("no-content", { directory: directory.path }, program)
        expect(response).toEqual({ status: 204, body: "" })
        expect(replay).toEqual(response)
      }).pipe(Effect.provide(testLayer)),
    )

    it.effect("records and replays arbitrary binary responses without changing bytes", () =>
      Effect.gen(function* () {
        const directory = yield* tempDirectory("http-recorder-binary-")
        const expected = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00, 0x80])
        const server = yield* startServer(
          Effect.succeed(HttpServerResponse.uint8Array(expected, { contentType: "image/png" })),
        )
        const url = `${server.url}/image.png`
        const program = Effect.gen(function* () {
          const http = yield* HttpClient.HttpClient
          const response = yield* http.execute(HttpClientRequest.get(url))
          return new Uint8Array(yield* response.arrayBuffer)
        })
        const record = yield* runWith("binary", { directory: directory.path }, program)
        yield* server.stop
        const replay = yield* runWith("binary", { directory: directory.path }, program)
        expect(record).toEqual(expected)
        expect(replay).toEqual(expected)
      }).pipe(Effect.provide(testLayer)),
    )
  })
})
