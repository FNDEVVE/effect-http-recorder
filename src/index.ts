import { hasCassette, readCassette, recordedAt, removeCassette } from "./cassette/store.js"
import { setTestClockToRecordedAt } from "./clock.js"
import { layer, layerFetch } from "./http/recorder.js"
import { layerSocket, layerWebSocketConstructor } from "./websocket/recorder.js"

/** HTTP and WebSocket cassette recording and clock anchoring. */
export const HttpRecorder = {
  layer,
  layerFetch,
  layerSocket,
  layerWebSocketConstructor,
  hasCassette,
  removeCassette,
  recordedAt,
  readCassette,
  setTestClockToRecordedAt,
}

export type {
  CassetteMetadata,
  JsonValue,
  RecorderOptions,
  RedactOptions,
  RequestMatcher,
  RequestSnapshot,
  SocketRecorderOptions,
} from "./api.js"
export type { Cassette, Interaction } from "./cassette/model.js"
export { MissingRecordedAtError } from "./cassette/model.js"
export {
  CassetteNotFoundError,
  InvalidCassetteError,
  UnsafeCassetteError,
  hasCassette,
  readCassette,
  recordedAt,
  removeCassette,
} from "./cassette/store.js"
export * as CassetteService from "./cassette/store.js"
export { setTestClockToRecordedAt } from "./clock.js"
