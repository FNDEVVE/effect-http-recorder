import { assert, it } from "@effect/vitest"
import { Config, Context, Effect, Layer, Option, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { HttpRecorder } from "effect-http-recorder"

const Completion = Schema.Struct({
  choices: Schema.Array(
    Schema.Struct({
      message: Schema.Struct({
        content: Schema.String,
      }),
    }),
  ),
})

class OpenAI extends Context.Service<OpenAI>()("example/OpenAI", {
  make: Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    const apiKey = yield* Config.option(Config.redacted("OPENAI_API_KEY"))
    const http = client.pipe(
      HttpClient.filterStatusOk,
      HttpClient.mapRequest((request) => {
        const authenticated = Option.match(apiKey, {
          onNone: () => request,
          onSome: (apiKey) => request.pipe(HttpClientRequest.bearerToken(apiKey)),
        })
        return authenticated.pipe(HttpClientRequest.prependUrl("https://api.openai.com"))
      }),
    )

    const complete = Effect.fn("OpenAI.complete")(function* (prompt: string) {
      const request = yield* HttpClientRequest.post("/v1/chat/completions").pipe(
        HttpClientRequest.bodyJson({
          model: "gpt-4.1-nano",
          messages: [{ role: "user", content: prompt }],
          temperature: 0,
          max_completion_tokens: 20,
        }),
      )
      const response = yield* http.execute(request)
      const completion = yield* HttpClientResponse.schemaBodyJson(Completion)(response)
      const content = completion.choices[0]?.message.content
      return content === undefined ? yield* Effect.die("OpenAI returned no completion") : content
    })

    return { complete } as const
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)
}

it.live(
  "records an OpenAI completion",
  () =>
    Effect.gen(function* () {
      const openai = yield* OpenAI
      const completion = yield* openai.complete("Reply with exactly: cassettes make tests fast")

      assert.strictEqual(completion, "cassettes make tests fast")
    }).pipe(
      Effect.provide(
        OpenAI.layer.pipe(
          Layer.provide(
            HttpRecorder.layerFetch("openai-completion", {
              directory: "examples/recordings",
            }),
          ),
        ),
      ),
    ),
  30_000,
)
