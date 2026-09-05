#!/usr/bin/env bun
import { BunRuntime, BunServices } from "@effect/platform-bun"
import { Effect, FileSystem, Path, Schema } from "effect"
import { pack, projectDirectory, run } from "./pack.js"

const Package = Schema.fromJsonString(
  Schema.Struct({
    name: Schema.String,
    peerDependencies: Schema.Struct({ effect: Schema.String }),
    dependencies: Schema.Struct({ "@effect/platform-node-shared": Schema.String }),
    devDependencies: Schema.Struct({
      typescript: Schema.String,
      "@effect/platform-node": Schema.String,
      "@types/node": Schema.String,
    }),
  }),
)

export const verifyPackage = Effect.fn("Tooling.verifyPackage")(function* (archive: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const cwd = yield* projectDirectory
  const pkg = yield* fs
    .readFileString(path.join(cwd, "package.json"))
    .pipe(Effect.flatMap(Schema.decodeEffect(Package)))
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: "http-recorder-consumer-" })
  yield* fs.writeFileString(
    path.join(directory, "package.json"),
    JSON.stringify({
      name: "http-recorder-consumer",
      private: true,
      type: "module",
      overrides: { "@effect/platform-node-shared": pkg.dependencies["@effect/platform-node-shared"] },
    }),
  )
  yield* fs.writeFileString(
    path.join(directory, "consumer.ts"),
    `import { strict as assert } from "node:assert"
import { createRequire } from "node:module"
import { HttpRecorder, CassetteNotFoundError, InvalidCassetteError, MissingRecordedAtError, type RecorderOptions, type SocketRecorderOptions, type CassetteMetadata } from ${JSON.stringify(pkg.name)}
import { NodeRuntime, NodeServices, NodeSocket } from "@effect/platform-node"
import { Clock, DateTime, Effect, FileSystem, Layer } from "effect"
import { TestClock } from "effect/testing"
import { FetchHttpClient, HttpClient } from "effect/unstable/http"
import { Socket } from "effect/unstable/socket"

const options: RecorderOptions = { directory: "recordings", match: (a, b) => a.url === b.url, redact: { jsonFields: ["access_token"] } }
const socketOptions: SocketRecorderOptions = { directory: "recordings" }
const metadata = { recordedAt: "2025-01-01T00:00:00.000Z" } satisfies CassetteMetadata
const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  yield* fs.makeDirectory("recordings")
  yield* fs.writeFileString("recordings/consumer.json", JSON.stringify({ version: 1, metadata, interactions: [{
    transport: "http", request: { method: "GET", url: "https://example.test/", headers: {}, body: "" },
    response: { status: 200, headers: {}, body: "packaged replay" },
  }] }))
  yield* fs.writeFileString("recordings/socket.json", JSON.stringify({ version: 1, metadata, interactions: [] }))
  assert.equal(yield* HttpRecorder.hasCassette("consumer", options), true)
  assert.equal(DateTime.toEpochMillis(yield* HttpRecorder.recordedAt("consumer", options)), Date.parse(metadata.recordedAt))
  assert.equal((yield* HttpRecorder.readCassette("consumer", options)).interactions.length, 1)
  yield* Effect.gen(function* () {
    yield* HttpRecorder.setTestClockToRecordedAt("consumer", options)
    assert.equal(yield* Clock.currentTimeMillis, Date.parse("2025-01-01T00:00:00.000Z"))
  }).pipe(Effect.provide(TestClock.layer()))
  const request = HttpClient.get("https://example.test/").pipe(Effect.flatMap((response) => response.text))
  assert.equal(yield* request.pipe(Effect.provide(HttpRecorder.layerFetch("consumer", options))), "packaged replay")
  assert.equal(yield* request.pipe(Effect.provide(HttpRecorder.layer("consumer", options).pipe(Layer.provide(FetchHttpClient.layer)))), "packaged replay")
  yield* Socket.Socket.pipe(Effect.provide(HttpRecorder.layerSocket("socket", socketOptions).pipe(Layer.provide(NodeSocket.layerWebSocket("wss://example.test")))))
  yield* Socket.WebSocketConstructor.pipe(Effect.provide(HttpRecorder.layerWebSocketConstructor("socket", socketOptions).pipe(Layer.provide(NodeSocket.layerWebSocketConstructor))))
  yield* HttpRecorder.removeCassette("consumer", options)
  assert.equal(yield* HttpRecorder.hasCassette("consumer", options), false)
  yield* HttpRecorder.readCassette("consumer", options).pipe(Effect.match({ onSuccess: () => assert.fail("missing cassette succeeded"), onFailure: (error) => assert.ok(error instanceof CassetteNotFoundError) }))
  yield* HttpRecorder.hasCassette("../unsafe", options).pipe(Effect.match({ onSuccess: () => assert.fail("unsafe name succeeded"), onFailure: (error) => assert.ok(error instanceof InvalidCassetteError) }))
  yield* fs.writeFileString("recordings/legacy.json", JSON.stringify({ version: 1, interactions: [] }))
  yield* HttpRecorder.recordedAt("legacy", options).pipe(Effect.match({ onSuccess: () => assert.fail("missing timestamp succeeded"), onFailure: (error) => assert.ok(error instanceof MissingRecordedAtError) }))
  const require = createRequire(import.meta.url)
  assert.throws(() => require.resolve(${JSON.stringify(`${pkg.name}/http/recorder`)}))
  yield* fs.remove("recordings", { recursive: true })
})

NodeRuntime.runMain(program.pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
`,
  )
  yield* fs.writeFileString(
    path.join(directory, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        outDir: "compiled",
        lib: ["ES2022", "DOM", "ESNext.Disposable"],
        types: ["node"],
      },
      include: ["consumer.ts"],
    }),
  )
  yield* run(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      archive,
      `typescript@${pkg.devDependencies.typescript}`,
      `effect@${pkg.peerDependencies.effect}`,
      `@effect/platform-node@${pkg.devDependencies["@effect/platform-node"]}`,
      `@types/node@${pkg.devDependencies["@types/node"]}`,
    ],
    directory,
  )
  yield* run("npm", ["ls", "effect", "@effect/platform-node-shared", "--all"], directory)
  yield* run(path.join(directory, "node_modules", ".bin", "tsc"), [], directory)
  yield* run("node", [path.join(directory, "compiled", "consumer.js")], directory)
  yield* run("bun", [path.join(directory, "compiled", "consumer.js")], directory)
})

if (import.meta.main) {
  BunRuntime.runMain(pack().pipe(Effect.flatMap(verifyPackage), Effect.scoped, Effect.provide(BunServices.layer)))
}
