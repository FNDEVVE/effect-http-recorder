import { Config, Effect } from "effect"
import { HttpRecorder } from "effect-http-recorder"
import { beforeAll } from "vitest"

beforeAll(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      const recording = yield* Config.boolean("RECORD_EXAMPLES").pipe(Config.withDefault(false))
      if (recording) return
      for (const name of ["github-effect-repository", "openai-completion", "websocket-chat"]) {
        if (!(yield* HttpRecorder.hasCassette(name, { directory: "examples/recordings" }))) {
          return yield* Effect.fail(
            new Error(`Missing example cassette ${name}; use bun run record:examples to record explicitly`),
          )
        }
      }
    }),
  ),
)
