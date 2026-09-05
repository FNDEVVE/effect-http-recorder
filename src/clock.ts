import { DateTime, Effect } from "effect"
import { TestClock } from "effect/testing"
import { recordedAt } from "./cassette/store.js"

/**
 * Anchors Effect's `TestClock` to the recorded time of a cassette.
 *
 * If the cassette exists and has a recorded timestamp, `TestClock` is set to that timestamp.
 * If the cassette does not exist (e.g. initial recording pass before the cassette file is written),
 * it falls back to the live clock so the recording run proceeds with real/current time.
 * If the cassette is invalid or missing `recordedAt`, this fails with `InvalidCassetteError` or `MissingRecordedAtError`.
 */
export const setTestClockToRecordedAt = Effect.fn("effect-http-recorder/setTestClockToRecordedAt")(function* (
  name: string,
  options?: { readonly directory?: string },
) {
  const at = yield* recordedAt(name, options).pipe(
    Effect.catchTag("CassetteNotFoundError", () => TestClock.withLive(DateTime.now)),
  )
  yield* TestClock.setTime(DateTime.toEpochMillis(at))
  return at
})
