---
"effect-http-recorder": minor
---

Expose `recordedAt` and `readCassette` helpers, and add `setTestClockToRecordedAt` for deterministic time anchoring with Effect's `TestClock`.

- Cassettes record ISO 8601 UTC timestamps in `metadata.recordedAt` using Effect's clock. The first successful append establishes the timestamp for that recording session.
- Added `setTestClockToRecordedAt` to anchor `TestClock` to a cassette. A missing cassette uses live time; legacy missing metadata and malformed timestamps fail explicitly.
- Exported `MissingRecordedAtError`, `CassetteNotFoundError`, and `InvalidCassetteError` for granular error handling.
