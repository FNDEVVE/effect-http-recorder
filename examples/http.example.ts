import { it } from "@effect/vitest"
import { Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { HttpRecorder } from "effect-http-recorder"

const getTodo = Effect.gen(function* () {
  const http = yield* HttpClient.HttpClient
  const response = yield* http.execute(HttpClientRequest.get("https://jsonplaceholder.typicode.com/todos/1"))
  return yield* response.json
})

it.effect("replays an HTTP response", () =>
  getTodo.pipe(Effect.provide(HttpRecorder.http("examples/todo")), Effect.asVoid),
)
