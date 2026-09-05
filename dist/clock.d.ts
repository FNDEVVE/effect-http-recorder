import { DateTime, Effect } from "effect";
/**
 * Anchors Effect's `TestClock` to the recorded time of a cassette.
 *
 * If the cassette exists and has a recorded timestamp, `TestClock` is set to that timestamp.
 * If the cassette does not exist (e.g. initial recording pass before the cassette file is written),
 * it falls back to the live clock so the recording run proceeds with real/current time.
 * If the cassette is invalid or missing `recordedAt`, this fails with `InvalidCassetteError` or `MissingRecordedAtError`.
 */
export declare const setTestClockToRecordedAt: (name: string, options?: {
    readonly directory?: string;
} | undefined) => Effect.Effect<DateTime.Utc, import("./cassette/store.js").InvalidCassetteError | import("./cassette/model.js").MissingRecordedAtError, never>;
