import { assert, it } from "@effect/vitest"
import { Context, Effect, Layer, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { HttpRecorder } from "effect-http-recorder"

const Repository = Schema.Struct({
  name: Schema.String,
  full_name: Schema.String,
  owner: Schema.Struct({
    login: Schema.String,
  }),
})

const makeGitHub = Effect.gen(function* () {
  const http = (yield* HttpClient.HttpClient).pipe(
    HttpClient.filterStatusOk,
    HttpClient.mapRequest(HttpClientRequest.prependUrl("https://api.github.com")),
  )

  const getRepository = Effect.fn("GitHub.getRepository")(function* (owner: string, name: string) {
    const response = yield* http.execute(HttpClientRequest.get(`/repos/${owner}/${name}`))
    return yield* HttpClientResponse.schemaBodyJson(Repository)(response)
  })

  return { getRepository } as const
})

class GitHub extends Context.Service<GitHub, Effect.Success<typeof makeGitHub>>()("example/GitHub") {}

const GitHubLive = Layer.effect(GitHub, makeGitHub)

it.effect("loads an Effect repository through the GitHub service", () =>
  Effect.gen(function* () {
    const github = yield* GitHub
    const repository = yield* github.getRepository("Effect-TS", "effect")

    assert.strictEqual(repository.name, "effect")
    assert.strictEqual(repository.full_name, "Effect-TS/effect")
    assert.strictEqual(repository.owner.login, "Effect-TS")
  }).pipe(Effect.provide(GitHubLive.pipe(Layer.provide(HttpRecorder.layer("examples/github-effect-repository"))))),
)
