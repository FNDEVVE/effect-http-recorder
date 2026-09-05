import { NodeHttpServer } from "@effect/platform-node"
import { NodeFileSystem, NodePath } from "@effect/platform-node-shared"
import { Cause, ConfigProvider, Context, Effect, Exit, FileSystem, Layer, Schema, Scope } from "effect"
import { HttpBody, HttpClient, HttpClientRequest, HttpServer, type HttpServerResponse } from "effect/unstable/http"
import { CassetteSchema, type Interaction } from "../src/cassette/model"
import { Service, fileSystem } from "../src/cassette/store"

export const fromMap = (entries: ReadonlyMap<string, string> | Record<string, string>) =>
  ConfigProvider.layer(ConfigProvider.fromEnvRecord(entries instanceof Map ? Object.fromEntries(entries) : entries))

export const testLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, fromMap({}))

export const tempDirectory = Effect.fn("Test.tempDirectory")(function* (prefix: string) {
  const fs = yield* FileSystem.FileSystem
  return { path: yield* fs.makeTempDirectoryScoped({ prefix }) }
})

export const post = (url: string, body: object) =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const response = yield* http.execute(
      HttpClientRequest.post(url, {
        headers: { "content-type": "application/json" },
        body: HttpBody.text(JSON.stringify(body), "application/json"),
      }),
    )
    return yield* response.text
  })

export const readCassette = Effect.fn("Test.readCassette")(function* (file: string) {
  const fs = yield* FileSystem.FileSystem
  return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(CassetteSchema))(yield* fs.readFileString(file))
})

export const withFileCassette = <A, E, R>(directory: string, effect: Effect.Effect<A, E, R | Service>) =>
  effect.pipe(Effect.provide(fileSystem({ directory })))

export const seedCassetteDirectory = (directory: string, name: string, interactions: ReadonlyArray<Interaction>) =>
  withFileCassette(
    directory,
    Effect.gen(function* () {
      const cassette = yield* Service
      yield* Effect.forEach(interactions, (interaction) => cassette.append(name, interaction))
    }),
  )

export const startServer = <E, R>(app: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>) =>
  Effect.gen(function* () {
    const scope = yield* Effect.acquireRelease(Scope.make(), (scope) => Scope.close(scope, Exit.void))
    const context = yield* Layer.buildWithScope(NodeHttpServer.layerTest, scope)
    const server = Context.get(context, HttpServer.HttpServer)
    yield* server.serve(app).pipe(Scope.provide(scope))
    if (server.address._tag !== "TcpAddress") return yield* Effect.die(new Error("Expected TCP test server"))
    return { url: `http://127.0.0.1:${server.address.port}`, stop: Scope.close(scope, Exit.void) }
  })

export const failureText = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) return ""
  return Cause.prettyErrors(exit.cause).join("\n")
}
