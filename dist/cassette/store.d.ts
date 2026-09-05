import { Context, DateTime, Effect, FileSystem, Layer, Path, Schema } from "effect";
import { MissingRecordedAtError, type Cassette, type CassetteMetadata, type Interaction } from "./model.js";
export { MissingRecordedAtError } from "./model.js";
declare const CassetteNotFoundError_base: Schema.Class<CassetteNotFoundError, Schema.TaggedStruct<"CassetteNotFoundError", {
    readonly cassetteName: Schema.String;
}>, import("effect/Cause").YieldableError>;
export declare class CassetteNotFoundError extends CassetteNotFoundError_base {
    get message(): string;
}
declare const InvalidCassetteError_base: Schema.Class<InvalidCassetteError, Schema.TaggedStruct<"InvalidCassetteError", {
    readonly cassetteName: Schema.String;
    readonly description: Schema.String;
}>, import("effect/Cause").YieldableError>;
export declare class InvalidCassetteError extends InvalidCassetteError_base {
    get message(): string;
}
declare const UnsafeCassetteError_base: Schema.Class<UnsafeCassetteError, Schema.TaggedStruct<"UnsafeCassetteError", {
    readonly cassetteName: Schema.String;
    readonly findings: Schema.$Array<Schema.Struct<{
        readonly path: Schema.String;
        readonly reason: Schema.String;
    }>>;
}>, import("effect/Cause").YieldableError>;
export declare class UnsafeCassetteError extends UnsafeCassetteError_base {
    get message(): string;
}
export interface Interface {
    readonly read: (name: string) => Effect.Effect<ReadonlyArray<Interaction>, CassetteNotFoundError | InvalidCassetteError>;
    readonly readCassette: (name: string) => Effect.Effect<Cassette, CassetteNotFoundError | InvalidCassetteError>;
    readonly recordedAt: (name: string) => Effect.Effect<DateTime.Utc, CassetteNotFoundError | InvalidCassetteError | MissingRecordedAtError>;
    readonly append: (name: string, interaction: Interaction, metadata?: CassetteMetadata) => Effect.Effect<void, UnsafeCassetteError | InvalidCassetteError>;
    readonly exists: (name: string) => Effect.Effect<boolean, InvalidCassetteError>;
    readonly remove: (name: string) => Effect.Effect<void, InvalidCassetteError>;
    readonly list: () => Effect.Effect<ReadonlyArray<string>, InvalidCassetteError>;
}
declare const Service_base: Context.ServiceClass<Service, "effect-http-recorder/Cassette", Interface>;
export declare class Service extends Service_base {
}
export declare const fileSystem: (options?: {
    readonly directory?: string;
}) => Layer.Layer<Service, never, FileSystem.FileSystem | Path.Path>;
export declare const memory: (initial?: Record<string, ReadonlyArray<Interaction>>) => Layer.Layer<Service>;
export declare const recordedAt: (name: string, options?: {
    readonly directory?: string;
} | undefined) => Effect.Effect<DateTime.Utc, CassetteNotFoundError | InvalidCassetteError | MissingRecordedAtError, never>;
export declare const readCassette: (name: string, options?: {
    readonly directory?: string;
} | undefined) => Effect.Effect<{
    readonly version: 1;
    readonly metadata?: {
        readonly [x: string]: import("./model.js").JsonValue;
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
}, CassetteNotFoundError | InvalidCassetteError, never>;
export declare const hasCassette: (name: string, options?: {
    readonly directory?: string;
} | undefined) => Effect.Effect<boolean, InvalidCassetteError, never>;
export declare const removeCassette: (name: string, options?: {
    readonly directory?: string;
} | undefined) => Effect.Effect<void, InvalidCassetteError, never>;
