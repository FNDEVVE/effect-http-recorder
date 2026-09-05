import { describe, expect, it } from "@effect/vitest"
import { DateTime, Duration, Effect, Exit, FileSystem } from "effect"
import { TestClock } from "effect/testing"
import { HttpClient, HttpClientRequest, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import type { Interaction } from "../src/cassette/model"
import { Service, memory } from "../src/cassette/store"
import { HttpRecorder, readCassette, recordedAt, setTestClockToRecordedAt } from "../src"
import { startServer, tempDirectory, testLayer, withFileCassette } from "./support"

const interaction: Interaction = {
  transport: "http",
  request: { method: "GET", url: "https://example.test/time", headers: {}, body: "" },
  response: { status: 200, headers: {}, body: "ok" },
}

const roundtrip = Effect.gen(function* () {
  const store = yield* Service
  const t0 = 1_725_000_000_000
  yield* TestClock.setTime(t0)
  yield* store.append("clock", interaction)
  yield* TestClock.adjust(Duration.days(50))
  yield* store.append("clock", interaction)
  expect(DateTime.toEpochMillis(yield* recordedAt("clock"))).toBe(t0)
  expect(DateTime.toEpochMillis(yield* setTestClockToRecordedAt("clock"))).toBe(t0)
  expect(DateTime.toEpochMillis(yield* DateTime.now)).toBe(t0)
  expect((yield* readCassette("clock")).interactions).toEqual([interaction, interaction])
})

describe("clock anchoring", () => {
  it.effect("file recordings retain the first timestamp across appends and anchor TestClock", () =>
    Effect.gen(function* () {
      const directory = yield* tempDirectory("clock-roundtrip-")
      yield* withFileCassette(directory.path, roundtrip)
    }).pipe(Effect.provide(testLayer)),
  )

  it.effect("memory recordings retain the first timestamp across appends and anchor TestClock", () =>
    roundtrip.pipe(Effect.provide(memory())),
  )

  it.effect("reads legacy cassettes but reports their missing timestamp", () =>
    Effect.gen(function* () {
      const directory = yield* tempDirectory("clock-legacy-")
      const fs = yield* FileSystem.FileSystem
      yield* fs.writeFileString(
        `${directory.path}/legacy.json`,
        JSON.stringify({
          version: 1,
          metadata: { name: "legacy" },
          interactions: [interaction],
        }),
      )
      yield* withFileCassette(
        directory.path,
        Effect.gen(function* () {
          expect((yield* readCassette("legacy")).interactions).toEqual([interaction])
          expect((yield* Effect.flip(recordedAt("legacy")))._tag).toBe("MissingRecordedAtError")
          expect((yield* Effect.flip(setTestClockToRecordedAt("legacy")))._tag).toBe("MissingRecordedAtError")
        }),
      )
    }).pipe(Effect.provide(testLayer)),
  )

  it.effect("rejects malformed present timestamps rather than treating them as legacy", () =>
    Effect.gen(function* () {
      const directory = yield* tempDirectory("clock-invalid-")
      const fs = yield* FileSystem.FileSystem
      for (const invalid of ["not-a-date", null, 42]) {
        yield* fs.writeFileString(
          `${directory.path}/invalid.json`,
          JSON.stringify({
            version: 1,
            metadata: { recordedAt: invalid },
            interactions: [interaction],
          }),
        )
        expect((yield* Effect.flip(readCassette("invalid", { directory: directory.path })))._tag).toBe(
          "InvalidCassetteError",
        )
        expect((yield* Effect.flip(setTestClockToRecordedAt("invalid", { directory: directory.path })))._tag).toBe(
          "InvalidCassetteError",
        )
      }
    }).pipe(Effect.provide(testLayer)),
  )

  it.effect("missing recordings anchor to live time even when TestClock starts at epoch zero", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(0)
      const before = Date.now()
      const anchored = yield* setTestClockToRecordedAt("missing")
      const after = Date.now()
      expect(DateTime.toEpochMillis(anchored)).toBeGreaterThanOrEqual(before)
      expect(DateTime.toEpochMillis(anchored)).toBeLessThanOrEqual(after)
      expect(DateTime.toEpochMillis(yield* DateTime.now)).toBe(DateTime.toEpochMillis(anchored))
    }).pipe(Effect.provide(memory())),
  )

  it.effect("explicit directory helpers override an injected store", () =>
    Effect.gen(function* () {
      const directory = yield* tempDirectory("clock-precedence-")
      yield* TestClock.setTime(1000)
      yield* withFileCassette(
        directory.path,
        Effect.gen(function* () {
          const store = yield* Service
          yield* store.append("clock", interaction)
        }),
      )
      yield* Effect.gen(function* () {
        const store = yield* Service
        yield* TestClock.setTime(2000)
        yield* store.append("clock", interaction)
        const anchored = yield* setTestClockToRecordedAt("clock", { directory: directory.path })
        expect(DateTime.toEpochMillis(anchored)).toBe(1000)
      }).pipe(Effect.provide(memory()))
    }).pipe(Effect.provide(testLayer)),
  )

  it.effect("date-window replay mismatches after thirty days and succeeds offline after anchoring", () =>
    Effect.gen(function* () {
      const directory = yield* tempDirectory("clock-date-window-")
      const server = yield* startServer(
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest
          const url = new URL(request.url, "http://localhost")
          return HttpServerResponse.jsonUnsafe({ from: url.searchParams.get("from"), to: url.searchParams.get("to") })
        }),
      )
      const window = Effect.gen(function* () {
        const now = yield* DateTime.now
        return {
          from: DateTime.formatIso(DateTime.subtract(now, { days: 7 })),
          to: DateTime.formatIso(DateTime.add(now, { days: 7 })),
        }
      })
      const echo = (range: { from: string; to: string }) =>
        Effect.gen(function* () {
          const http = yield* HttpClient.HttpClient
          const response = yield* http.execute(
            HttpClientRequest.get(`${server.url}/echo?${new URLSearchParams(range)}`),
          )
          return yield* response.text
        }).pipe(Effect.provide(HttpRecorder.layerFetch("date-window", { directory: directory.path })))

      const t0 = 1_725_000_000_000
      yield* TestClock.setTime(t0)
      const originalWindow = yield* window
      const original = yield* echo(originalWindow)
      expect(JSON.parse(original)).toEqual(originalWindow)
      yield* server.stop

      yield* TestClock.adjust(Duration.days(30))
      const laterWindow = yield* window
      expect(laterWindow).not.toEqual(originalWindow)
      expect(Exit.isFailure(yield* Effect.exit(echo(laterWindow)))).toBe(true)
      expect(DateTime.toEpochMillis(yield* DateTime.now)).toBe(t0 + 30 * 24 * 60 * 60 * 1000)

      const anchored = yield* HttpRecorder.setTestClockToRecordedAt("date-window", { directory: directory.path })
      expect(DateTime.toEpochMillis(anchored)).toBe(t0)
      const anchoredWindow = yield* window
      expect(anchoredWindow).toEqual(originalWindow)
      expect(yield* echo(anchoredWindow)).toBe(original)
    }).pipe(Effect.provide(testLayer)),
  )
})
