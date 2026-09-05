import { Schema } from "effect";
export declare const RequestSnapshotSchema: Schema.Struct<{
    readonly method: Schema.String;
    readonly url: Schema.String;
    readonly headers: Schema.$Record<Schema.String, Schema.String>;
    readonly body: Schema.String;
}>;
export type { RequestSnapshot } from "../api.js";
export declare const ResponseSnapshotSchema: Schema.Struct<{
    readonly status: Schema.Number;
    readonly headers: Schema.$Record<Schema.String, Schema.String>;
    readonly body: Schema.String;
    readonly bodyEncoding: Schema.optional<Schema.Literals<readonly ["text", "base64"]>>;
}>;
export interface ResponseSnapshot extends Schema.Schema.Type<typeof ResponseSnapshotSchema> {
}
export declare const HttpInteractionSchema: Schema.Struct<{
    readonly transport: Schema.tag<"http">;
    readonly request: Schema.Struct<{
        readonly method: Schema.String;
        readonly url: Schema.String;
        readonly headers: Schema.$Record<Schema.String, Schema.String>;
        readonly body: Schema.String;
    }>;
    readonly response: Schema.Struct<{
        readonly status: Schema.Number;
        readonly headers: Schema.$Record<Schema.String, Schema.String>;
        readonly body: Schema.String;
        readonly bodyEncoding: Schema.optional<Schema.Literals<readonly ["text", "base64"]>>;
    }>;
}>;
export interface HttpInteraction extends Schema.Schema.Type<typeof HttpInteractionSchema> {
}
export * as HttpModel from "./model.js";
