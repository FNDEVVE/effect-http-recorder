import { describe, expect, it } from "@effect/vitest"
import { ConfigProvider, DateTime, Deferred, Effect, Exit, Fiber, FileSystem, PlatformError } from "effect"
import { TestClock } from "effect/testing"
import { HttpServerResponse } from "effect/unstable/http"
import type { Interaction } from "../src/cassette/model"
import { HttpRecorder } from "../src"
import { Service, memory } from "../src/cassette/store"
import {
  fromMap,
  post,
  readCassette,
  seedCassetteDirectory,
  startServer,
  tempDirectory,
  testLayer,
  withFileCassette,
} from "./support"
const interaction: Interaction = {
  transport: "http",
  request: { method: "GET", url: "https://example.test", headers: {}, body: "" },
  response: { status: 200, headers: {}, body: "safe" },
}

describe("cassette", () => {
  it.effect("colliding flat and nested configuration paths protect both credential values", () =>
    Effect.gen(function* () {
      const store = yield* Service
      const secrets = ["secret-value-one-123", "secret-value-two-456"]
      for (const secret of secrets) {
        const error = yield* Effect.flip(
          store.append("configured", {
            ...interaction,
            response: { ...interaction.response, body: secret },
          }),
        )
        expect(error._tag).toBe("UnsafeCassetteError")
        for (const credential of secrets) expect(String(error)).not.toContain(credential)
      }
      expect(yield* store.exists("configured")).toBe(false)
    }).pipe(
      Effect.provide(memory()),
      Effect.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            API_KEY: "secret-value-one-123",
            API: { KEY: "secret-value-two-456" },
          }),
        ),
      ),
    ),
  )

  it.effect("base64-encoded bodies cannot evade configured secret write protection", () =>
    Effect.gen(function* () {
      const store = yield* Service
      const secret = "configured-private-binary-value"
      const error = yield* Effect.flip(
        store.append("binary-secret", {
          ...interaction,
          response: { ...interaction.response, body: Buffer.from(secret).toString("base64"), bodyEncoding: "base64" },
        }),
      )
      expect(error._tag).toBe("UnsafeCassetteError")
      expect(yield* store.exists("binary-secret")).toBe(false)
    }).pipe(Effect.provide(memory()), Effect.provide(fromMap({ SERVICE_SECRET: "configured-private-binary-value" }))),
  )

  it.effect("unsafe recordings fail without persisting secrets", () =>
    Effect.gen(function* () {
      const directory = yield* tempDirectory("cassette-unsafe-")
      const server = yield* startServer(
        Effect.succeed(HttpServerResponse.text("Bearer abcdefghijklmnopqrstuvwxyz1234")),
      )
      const exit = yield* Effect.exit(
        post(`${server.url}/leaky`, { ok: true }).pipe(
          Effect.provide(HttpRecorder.layerFetch("unsafe", { directory: directory.path })),
        ),
      )
      expect(Exit.isFailure(exit)).toBe(true)
      const fs = yield* FileSystem.FileSystem
      expect(yield* fs.exists(`${directory.path}/unsafe.json`)).toBe(false)
    }).pipe(Effect.provide(testLayer)),
  )

  for (const storage of ["memory", "file"] as const) {
    it.effect(`${storage} failed appends leave cassette state unchanged`, () =>
      Effect.gen(function* () {
        const directory = yield* tempDirectory("cassette-rollback-")
        const program = Effect.gen(function* () {
          const store = yield* Service
          yield* store.append("transactional", interaction)
          const error = yield* Effect.flip(
            store.append("transactional", {
              ...interaction,
              response: { ...interaction.response, body: "Bearer abcdefghijklmnopqrstuvwxyz1234" },
            }),
          )
          expect(error._tag).toBe("UnsafeCassetteError")
          expect(yield* store.read("transactional")).toEqual([interaction])
        })
        yield* storage === "memory" ? program.pipe(Effect.provide(memory())) : withFileCassette(directory.path, program)
      }).pipe(Effect.provide(testLayer)),
    )

    it.effect(
      `${storage} removal${storage === "file" ? " through a path alias" : ""} never resurrects exchanges and resets timestamp`,
      () =>
        Effect.gen(function* () {
          const directory = yield* tempDirectory("cassette-remove-")
          const program = Effect.gen(function* () {
            const store = yield* Service
            yield* TestClock.setTime(1000)
            yield* store.append("session", interaction)
            yield* store.remove(storage === "file" ? "./session" : "session")
            expect(yield* store.exists("session")).toBe(false)
            yield* TestClock.setTime(2000)
            const next = { ...interaction, response: { ...interaction.response, body: "new" } }
            yield* store.append("session", next)
            expect(yield* store.read("session")).toEqual([next])
            expect(DateTime.toEpochMillis(yield* store.recordedAt("session"))).toBe(2000)
          })
          yield* storage === "memory"
            ? program.pipe(Effect.provide(memory()))
            : withFileCassette(directory.path, program)
        }).pipe(Effect.provide(testLayer)),
    )
  }

  it.effect("memory reads observe state when executed, not when constructed", () =>
    Effect.gen(function* () {
      const store = yield* Service
      const read = store.read("lazy")
      yield* store.append("lazy", interaction)
      expect(yield* read).toEqual([interaction])
    }).pipe(Effect.provide(memory())),
  )

  it.effect("concurrent file appends preserve every distinct interaction", () =>
    Effect.gen(function* () {
      const directory = yield* tempDirectory("cassette-concurrent-")
      const interactions = Array.from({ length: 20 }, (_, index) => ({
        ...interaction,
        response: { ...interaction.response, body: String(index) },
      }))
      yield* withFileCassette(
        directory.path,
        Effect.gen(function* () {
          const store = yield* Service
          yield* Effect.forEach(interactions, (item) => store.append("concurrent", item), { concurrency: "unbounded" })
        }),
      )
      const saved = yield* readCassette(`${directory.path}/concurrent.json`)
      expect(saved.interactions).toHaveLength(interactions.length)
      expect(saved.interactions).toEqual(expect.arrayContaining(interactions))
    }).pipe(Effect.provide(testLayer)),
  )

  it.effect("generated metadata cannot be overridden", () =>
    Effect.gen(function* () {
      const directory = yield* tempDirectory("cassette-metadata-")
      yield* TestClock.setTime(1000)
      yield* withFileCassette(
        directory.path,
        Effect.gen(function* () {
          const store = yield* Service
          yield* store.append("metadata", interaction, { name: "wrong", recordedAt: "wrong" })
        }),
      )
      const cassette = yield* readCassette(`${directory.path}/metadata.json`)
      expect(cassette.metadata?.name).toBe("metadata")
      expect(cassette.metadata?.recordedAt).toBe("1970-01-01T00:00:01.000Z")
    }).pipe(Effect.provide(testLayer)),
  )

  it.effect("rejects malformed JSON and invalid transport values", () =>
    Effect.gen(function* () {
      const directory = yield* tempDirectory("cassette-invalid-")
      const fs = yield* FileSystem.FileSystem
      const invalid = [
        "{not-json",
        JSON.stringify({
          version: 1,
          interactions: [{ ...interaction, response: { ...interaction.response, status: 99 } }],
        }),
        JSON.stringify({
          version: 1,
          interactions: [
            { ...interaction, response: { ...interaction.response, body: "%%%", bodyEncoding: "base64" } },
          ],
        }),
        JSON.stringify({
          version: 1,
          interactions: [
            {
              transport: "websocket",
              events: [{ direction: "server", kind: "binary", body: "%%%", bodyEncoding: "base64" }],
            },
          ],
        }),
      ]
      for (const contents of invalid) {
        yield* fs.writeFileString(`${directory.path}/invalid.json`, contents)
        const error = yield* Effect.flip(HttpRecorder.readCassette("invalid", { directory: directory.path }))
        expect(error._tag).toBe("InvalidCassetteError")
      }
    }).pipe(Effect.provide(testLayer)),
  )

  it.effect("rejects cassette paths outside the recording directory", () =>
    Effect.gen(function* () {
      const directory = yield* tempDirectory("cassette-path-")
      for (const name of ["../outside", "C:\\outside"]) {
        expect((yield* Effect.flip(HttpRecorder.hasCassette(name, { directory: directory.path })))._tag).toBe(
          "InvalidCassetteError",
        )
      }
    }).pipe(Effect.provide(testLayer)),
  )

  it.effect("public lifecycle helpers check and idempotently remove recordings", () =>
    Effect.gen(function* () {
      const directory = yield* tempDirectory("cassette-lifecycle-")
      const options = { directory: directory.path }
      expect(yield* HttpRecorder.hasCassette("nested/example", options)).toBe(false)
      yield* seedCassetteDirectory(directory.path, "nested/example", [interaction])
      expect(yield* HttpRecorder.hasCassette("nested/example", options)).toBe(true)
      yield* HttpRecorder.removeCassette("nested/example", options)
      expect(yield* HttpRecorder.hasCassette("nested/example", options)).toBe(false)
      yield* HttpRecorder.removeCassette("nested/example", options)
      expect((yield* Effect.flip(HttpRecorder.removeCassette("../outside", options)))._tag).toBe("InvalidCassetteError")
    }).pipe(Effect.provide(testLayer)),
  )

  it.effect("lists nested recordings and treats a missing root as empty", () =>
    Effect.gen(function* () {
      const directory = yield* tempDirectory("cassette-list-")
      yield* withFileCassette(
        `${directory.path}/missing`,
        Effect.gen(function* () {
          const store = yield* Service
          expect(yield* store.list()).toEqual([])
        }),
      )
      yield* seedCassetteDirectory(directory.path, "alpha/one", [interaction])
      yield* seedCassetteDirectory(directory.path, "beta", [interaction])
      yield* withFileCassette(
        directory.path,
        Effect.gen(function* () {
          const store = yield* Service
          expect(yield* store.list()).toEqual(["alpha/one", "beta"])
        }),
      )
    }).pipe(Effect.provide(testLayer)),
  )

  it.effect("filesystem failures remain typed failures rather than missing data", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const denied = Effect.fail(
        PlatformError.systemError({ _tag: "PermissionDenied", module: "FileSystem", method: "injected" }),
      )
      const failing = FileSystem.FileSystem.of({
        ...fs,
        access: () => denied,
        exists: () => denied,
        remove: () => denied,
        readDirectory: () => denied,
        readFileString: () => denied,
        makeDirectory: () => denied,
      })
      yield* withFileCassette(
        "/injected",
        Effect.gen(function* () {
          const store = yield* Service
          const errors = yield* Effect.all([
            Effect.flip(store.exists("x")),
            Effect.flip(store.remove("x")),
            Effect.flip(store.list()),
            Effect.flip(store.read("x")),
            Effect.flip(store.append("x", interaction)),
          ])
          expect(errors.map((error) => error._tag)).toEqual(Array(5).fill("InvalidCassetteError"))
        }),
      ).pipe(Effect.provideService(FileSystem.FileSystem, failing))
    }).pipe(Effect.provide(testLayer)),
  )

  it.effect("remove waits for an in-flight append instead of allowing its write to resurrect data", () =>
    Effect.gen(function* () {
      const directory = yield* tempDirectory("cassette-remove-race-")
      const fs = yield* FileSystem.FileSystem
      const writing = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const gated = FileSystem.FileSystem.of({
        ...fs,
        rename: (from, to) =>
          Effect.gen(function* () {
            yield* Deferred.succeed(writing, undefined)
            yield* Deferred.await(release)
            yield* fs.rename(from, to)
          }),
      })
      yield* withFileCassette(
        directory.path,
        Effect.gen(function* () {
          const store = yield* Service
          const append = yield* store.append("race", interaction).pipe(Effect.forkChild)
          yield* Deferred.await(writing)
          const remove = yield* store.remove("race").pipe(Effect.forkChild)
          yield* Deferred.succeed(release, undefined)
          yield* Fiber.join(append)
          yield* Fiber.join(remove)
          expect(yield* store.exists("race")).toBe(false)
        }),
      ).pipe(Effect.provideService(FileSystem.FileSystem, gated))
    }).pipe(Effect.provide(testLayer)),
  )
  for (const operation of ["append", "remove"] as const) {
    it.effect(`canceling ${operation} during its filesystem commit keeps subsequent recordings coherent`, () =>
      Effect.gen(function* () {
        const directory = yield* tempDirectory("cassette-cancel-commit-")
        const fs = yield* FileSystem.FileSystem
        const committed = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        let gate = false
        const pause = Effect.gen(function* () {
          if (!gate) return
          gate = false
          yield* Deferred.succeed(committed, undefined)
          yield* Deferred.await(release)
        })
        const gated = FileSystem.FileSystem.of({
          ...fs,
          rename: (from, to) => fs.rename(from, to).pipe(Effect.andThen(operation === "append" ? pause : Effect.void)),
          remove: (path, options) =>
            fs.remove(path, options).pipe(Effect.andThen(operation === "remove" ? pause : Effect.void)),
        })
        yield* withFileCassette(
          directory.path,
          Effect.gen(function* () {
            const store = yield* Service
            const second = { ...interaction, response: { ...interaction.response, body: "second" } }
            const third = { ...interaction, response: { ...interaction.response, body: "third" } }
            yield* store.append("session", interaction)
            gate = true
            const operationFiber = yield* (
              operation === "append" ? store.append("session", second) : store.remove("session")
            ).pipe(Effect.forkChild)
            yield* Deferred.await(committed)
            const interrupt = yield* Fiber.interrupt(operationFiber).pipe(Effect.forkChild({ startImmediately: true }))
            yield* Deferred.succeed(release, undefined)
            yield* Fiber.join(interrupt)
            yield* store.append("session", third)
            expect(yield* store.read("session")).toEqual(
              operation === "append" ? [interaction, second, third] : [third],
            )
          }),
        ).pipe(Effect.provideService(FileSystem.FileSystem, gated))
      }).pipe(Effect.provide(testLayer)),
    )
  }

  it.effect("a failed rename does not leak an uncommitted exchange into the next append", () =>
    Effect.gen(function* () {
      const directory = yield* tempDirectory("cassette-rename-failure-")
      const fs = yield* FileSystem.FileSystem
      let reject = false
      const failing = FileSystem.FileSystem.of({
        ...fs,
        rename: (from, to) =>
          Effect.suspend(() =>
            reject
              ? Effect.fail(
                  PlatformError.systemError({ _tag: "PermissionDenied", module: "FileSystem", method: "rename" }),
                )
              : fs.rename(from, to),
          ),
      })
      yield* withFileCassette(
        directory.path,
        Effect.gen(function* () {
          const store = yield* Service
          const rejected = { ...interaction, response: { ...interaction.response, body: "rejected" } }
          const accepted = { ...interaction, response: { ...interaction.response, body: "accepted" } }
          yield* store.append("session", interaction)
          reject = true
          expect((yield* Effect.flip(store.append("session", rejected)))._tag).toBe("InvalidCassetteError")
          reject = false
          yield* store.append("session", accepted)
          expect(yield* store.read("session")).toEqual([interaction, accepted])
        }),
      ).pipe(Effect.provideService(FileSystem.FileSystem, failing))
    }).pipe(Effect.provide(testLayer)),
  )
})
