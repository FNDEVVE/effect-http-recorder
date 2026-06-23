import { HttpClient } from "effect/unstable/http"
import { Socket } from "effect/unstable/socket"
import { Layer } from "effect"
import { Api } from "./api.js"
import { http } from "./http/recorder.js"
import { socket } from "./websocket/recorder.js"

/** HTTP and WebSocket cassette recording. */
export const HttpRecorder: {
  readonly http: (name: string, options?: Api.RecorderOptions) => Layer.Layer<HttpClient.HttpClient>
  readonly socket: (
    name: string,
    options?: Api.SocketRecorderOptions,
  ) => Layer.Layer<Socket.Socket, never, Socket.Socket>
} = { http, socket }

export namespace HttpRecorder {
  /** Additional JSON metadata stored with a cassette. */
  export type JsonValue = Api.JsonValue
  /** Additional JSON metadata stored with a cassette. */
  export type CassetteMetadata = Api.CassetteMetadata
  /** Recorder configuration. */
  export type RecorderOptions = Api.RecorderOptions
  /** Additive redaction and header-preservation policy. */
  export type RedactOptions = Api.RedactOptions
  /** Returns whether an incoming HTTP request matches a recorded request. */
  export type RequestMatcher = Api.RequestMatcher
  /** The normalized HTTP request representation used for matching. */
  export type RequestSnapshot = Api.RequestSnapshot
  /** Recorder configuration for a provided Effect WebSocket service. */
  export type SocketRecorderOptions = Api.SocketRecorderOptions
}
