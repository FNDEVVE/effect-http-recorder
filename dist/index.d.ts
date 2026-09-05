import { layer, layerFetch } from "./http/recorder.js";
import { layerSocket, layerWebSocketConstructor } from "./websocket/recorder.js";
/** HTTP and WebSocket cassette recording and clock anchoring. */
export declare const HttpRecorder: {
    layer: typeof layer;
    layerFetch: typeof layerFetch;
    layerSocket: typeof layerSocket;
    layerWebSocketConstructor: typeof layerWebSocketConstructor;
    hasCassette: (name: string, options?: {
        readonly directory?: string;
    } | undefined) => import("effect/Effect").Effect<boolean, import("./cassette/store.js").InvalidCassetteError, never>;
    removeCassette: (name: string, options?: {
        readonly directory?: string;
    } | undefined) => import("effect/Effect").Effect<void, import("./cassette/store.js").InvalidCassetteError, never>;
    recordedAt: (name: string, options?: {
        readonly directory?: string;
    } | undefined) => import("effect/Effect").Effect<import("effect/DateTime").Utc, import("./cassette/store.js").CassetteNotFoundError | import("./cassette/store.js").InvalidCassetteError | import("./cassette/model.js").MissingRecordedAtError, never>;
    readCassette: (name: string, options?: {
        readonly directory?: string;
    } | undefined) => import("effect/Effect").Effect<{
        readonly version: 1;
        readonly metadata?: {
            readonly [x: string]: import("./api.js").JsonValue;
        } | undefined;
        readonly interactions: readonly ({
            readonly transport: "http";
            readonly request: {
                readonly method: string;
                readonly url: string;
                readonly headers: {
                    readonly [x: string]: string;
                };
                readonly body: string;
            };
            readonly response: {
                readonly status: number;
                readonly headers: {
                    readonly [x: string]: string;
                };
                readonly body: string;
                readonly bodyEncoding?: "base64" | "text" | undefined;
            };
        } | {
            readonly transport: "websocket";
            readonly connection?: {
                readonly sequence: number;
                readonly url: string;
                readonly protocols: readonly string[];
                readonly close: {
                    readonly code: number;
                    readonly reason: string;
                };
            } | undefined;
            readonly events: readonly ({
                readonly direction: "client" | "server";
                readonly kind: "text";
                readonly body: string;
            } | {
                readonly direction: "client" | "server";
                readonly kind: "binary";
                readonly body: string;
                readonly bodyEncoding: "base64";
            })[];
        })[];
    }, import("./cassette/store.js").CassetteNotFoundError | import("./cassette/store.js").InvalidCassetteError, never>;
    setTestClockToRecordedAt: (name: string, options?: {
        readonly directory?: string;
    } | undefined) => import("effect/Effect").Effect<import("effect/DateTime").Utc, import("./cassette/store.js").InvalidCassetteError | import("./cassette/model.js").MissingRecordedAtError, never>;
};
export type { CassetteMetadata, JsonValue, RecorderOptions, RedactOptions, RequestMatcher, RequestSnapshot, SocketRecorderOptions, } from "./api.js";
export type { Cassette, Interaction } from "./cassette/model.js";
export { MissingRecordedAtError } from "./cassette/model.js";
export { CassetteNotFoundError, InvalidCassetteError, UnsafeCassetteError, hasCassette, readCassette, recordedAt, removeCassette, } from "./cassette/store.js";
export * as CassetteService from "./cassette/store.js";
export { setTestClockToRecordedAt } from "./clock.js";
