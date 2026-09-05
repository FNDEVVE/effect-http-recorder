import { Layer } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import * as CassetteService from "../cassette/store.js";
import type { RecorderOptions } from "../api.js";
import { type Redactor } from "../redaction/redactor.js";
import { defaultMatcher, type RequestMatcher } from "./matching.js";
import type { CassetteMetadata } from "../cassette/model.js";
export { defaultMatcher };
export type RecordReplayMode = "auto" | "record" | "replay" | "passthrough";
export interface RecordReplayOptions {
    readonly mode?: RecordReplayMode;
    readonly directory?: string;
    readonly metadata?: CassetteMetadata;
    readonly redactor?: Redactor;
    readonly match?: RequestMatcher;
}
export declare const redactedErrorRequest: (request: HttpClientRequest.HttpClientRequest, redactedUrl?: string) => HttpClientRequest.HttpClientRequest;
export declare const recordingLayer: (name: string, options?: Omit<RecordReplayOptions, "directory">) => Layer.Layer<HttpClient.HttpClient, CassetteService.CassetteNotFoundError | CassetteService.InvalidCassetteError, HttpClient.HttpClient | CassetteService.Service>;
export declare const cassetteLayer: (name: string, options?: RecordReplayOptions) => Layer.Layer<HttpClient.HttpClient, CassetteService.CassetteNotFoundError | CassetteService.InvalidCassetteError, never>;
/**
 * Wraps a provided `HttpClient` with cassette recording and replay.
 *
 * Locally, a missing cassette is recorded from the real service. Existing
 * cassettes are replayed, and `CI=true` makes a missing cassette fail.
 */
export declare const layer: (name: string, options?: RecorderOptions) => Layer.Layer<HttpClient.HttpClient, CassetteService.CassetteNotFoundError | CassetteService.InvalidCassetteError, HttpClient.HttpClient>;
/** Provides a fetch-backed `HttpClient` with cassette recording and replay. */
export declare const layerFetch: (name: string, options?: RecorderOptions) => Layer.Layer<HttpClient.HttpClient, CassetteService.CassetteNotFoundError | CassetteService.InvalidCassetteError, never>;
