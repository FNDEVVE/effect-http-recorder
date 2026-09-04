import { Layer } from "effect";
import { HttpClient } from "effect/unstable/http";
import { Socket } from "effect/unstable/socket";
import { Api } from "./api.js";
/** HTTP and WebSocket cassette recording. */
export declare const HttpRecorder: {
    readonly layer: (name: string, options?: Api.RecorderOptions) => Layer.Layer<HttpClient.HttpClient, never, HttpClient.HttpClient>;
    readonly layerFetch: (name: string, options?: Api.RecorderOptions) => Layer.Layer<HttpClient.HttpClient>;
    readonly layerSocket: (name: string, options?: Api.SocketRecorderOptions) => Layer.Layer<Socket.Socket, never, Socket.Socket>;
    readonly layerWebSocketConstructor: (name: string, options?: Api.SocketRecorderOptions) => Layer.Layer<Socket.WebSocketConstructor, never, Socket.WebSocketConstructor>;
    readonly hasCassetteSync: (name: string, options?: {
        readonly directory?: string;
    }) => boolean;
    readonly removeCassetteSync: (name: string, options?: {
        readonly directory?: string;
    }) => void;
};
export declare namespace HttpRecorder {
    /** Additional JSON metadata stored with a cassette. */
    type JsonValue = Api.JsonValue;
    /** Additional JSON metadata stored with a cassette. */
    type CassetteMetadata = Api.CassetteMetadata;
    /** Recorder configuration. */
    type RecorderOptions = Api.RecorderOptions;
    /** Additive redaction and header-preservation policy. */
    type RedactOptions = Api.RedactOptions;
    /** Returns whether an incoming HTTP request matches a recorded request. */
    type RequestMatcher = Api.RequestMatcher;
    /** The normalized HTTP request representation used for matching. */
    type RequestSnapshot = Api.RequestSnapshot;
    /** Recorder configuration for Effect socket and WebSocket layers. */
    type SocketRecorderOptions = Api.SocketRecorderOptions;
}
