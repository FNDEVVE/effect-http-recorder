import { assert, it } from "@effect/vitest"
import { Config, Context, Effect, Layer, Option, Random, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { HttpRecorder } from "effect-http-recorder"

const Repository = Schema.Struct({
  name: Schema.String,
  full_name: Schema.String,
  owner: Schema.Struct({
    login: Schema.String,
  }),
})

class GitHub extends Context.Service<GitHub>()("example/GitHub", {
  make: Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    const token = yield* Config.option(Config.redacted("GITHUB_TOKEN"))
    const http = client.pipe(
      HttpClient.filterStatusOk,
      HttpClient.mapRequest((request) => {
        const authenticated = Option.match(token, {
          onNone: () => request,
          onSome: (token) => request.pipe(HttpClientRequest.bearerToken(token)),
        })
        return authenticated.pipe(HttpClientRequest.prependUrl("https://api.github.com"))
      }),
    )

    const getRepository = Effect.fn("GitHub.getRepository")(function* (owner: string, name: string) {
      const response = yield* http.execute(HttpClientRequest.get(`/repos/${owner}/${name}`))
      return yield* HttpClientResponse.schemaBodyJson(Repository)(response)
    })

    return { getRepository } as const
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)
}

it.live(
  "loads multiple repositories through the GitHub service",
  () =>
    Effect.gen(function* () {
      const github = yield* GitHub
      const getRepository = (owner: string, name: string) =>
        Effect.gen(function* () {
          yield* Effect.sleep(yield* Random.nextIntBetween(0, 50))
          return yield* github.getRepository(owner, name)
        })

      const [effect, typescript] = yield* Effect.all(
        [getRepository("Effect-TS", "effect"), getRepository("microsoft", "TypeScript")],
        { concurrency: "unbounded" },
      )

      assert.strictEqual(effect.name, "effect")
      assert.strictEqual(effect.full_name, "Effect-TS/effect")
      assert.strictEqual(effect.owner.login, "Effect-TS")

      assert.strictEqual(typescript.name, "TypeScript")
      assert.strictEqual(typescript.full_name, "microsoft/TypeScript")
      assert.strictEqual(typescript.owner.login, "microsoft")
    }).pipe(
      Effect.provide(
        GitHub.layer.pipe(
          Layer.provide(
            HttpRecorder.layer("github-effect-repository", {
              directory: "examples/recordings",
            }),
          ),
        ),
      ),
    ),
  30_000,
)
