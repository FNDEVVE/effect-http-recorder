import { Effect, Schema } from "effect";
import type { JsonValue } from "../api.js";
export type { CassetteMetadata, JsonValue } from "../api.js";
export declare const CassetteMetadataSchema: Schema.$Record<Schema.String, Schema.suspend<Schema.Codec<JsonValue, JsonValue, never, never>>>;
export declare const InteractionSchema: Schema.toTaggedUnion<"transport", readonly [Schema.Struct<{
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
}>, Schema.Struct<{
    readonly transport: Schema.tag<"websocket">;
    readonly connection: Schema.optional<Schema.Struct<{
        readonly sequence: Schema.Number;
        readonly url: Schema.String;
        readonly protocols: Schema.$Array<Schema.String>;
        readonly close: Schema.Struct<{
            readonly code: Schema.Number;
            readonly reason: Schema.String;
        }>;
    }>>;
    readonly events: Schema.$Array<Schema.Union<readonly [Schema.Struct<{
        readonly direction: Schema.Literals<readonly ["client", "server"]>;
        readonly kind: Schema.tag<"text">;
        readonly body: Schema.String;
    }>, Schema.Struct<{
        readonly direction: Schema.Literals<readonly ["client", "server"]>;
        readonly kind: Schema.tag<"binary">;
        readonly body: Schema.String;
        readonly bodyEncoding: Schema.Literal<"base64">;
    }>]>>;
}>]>;
export type Interaction = Schema.Schema.Type<typeof InteractionSchema>;
export declare const isHttpInteraction: (u: unknown) => u is {
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
};
export declare const isWebSocketInteraction: (u: unknown) => u is {
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
};
export declare const httpInteractions: (interactions: ReadonlyArray<Interaction>) => {
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
}[];
export declare const webSocketInteractions: (interactions: ReadonlyArray<Interaction>) => {
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
}[];
export declare const CassetteSchema: Schema.Struct<{
    readonly version: Schema.Literal<1>;
    readonly metadata: Schema.optionalKey<Schema.$Record<Schema.String, Schema.suspend<Schema.Codec<JsonValue, JsonValue, never, never>>>>;
    readonly interactions: Schema.$Array<Schema.toTaggedUnion<"transport", readonly [Schema.Struct<{
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
    }>, Schema.Struct<{
        readonly transport: Schema.tag<"websocket">;
        readonly connection: Schema.optional<Schema.Struct<{
            readonly sequence: Schema.Number;
            readonly url: Schema.String;
            readonly protocols: Schema.$Array<Schema.String>;
            readonly close: Schema.Struct<{
                readonly code: Schema.Number;
                readonly reason: Schema.String;
            }>;
        }>>;
        readonly events: Schema.$Array<Schema.Union<readonly [Schema.Struct<{
            readonly direction: Schema.Literals<readonly ["client", "server"]>;
            readonly kind: Schema.tag<"text">;
            readonly body: Schema.String;
        }>, Schema.Struct<{
            readonly direction: Schema.Literals<readonly ["client", "server"]>;
            readonly kind: Schema.tag<"binary">;
            readonly body: Schema.String;
            readonly bodyEncoding: Schema.Literal<"base64">;
        }>]>>;
    }>]>>;
}>;
export type Cassette = Schema.Schema.Type<typeof CassetteSchema>;
export declare const decodeCassette: (input: unknown, options?: import("effect/SchemaAST").ParseOptions) => Effect.Effect<{
    readonly version: 1;
    readonly metadata?: {
        readonly [x: string]: JsonValue;
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
}, Schema.SchemaError, never>;
export declare const encodeCassette: (input: {
    readonly version: 1;
    readonly metadata?: {
        readonly [x: string]: JsonValue;
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
}, options?: import("effect/SchemaAST").ParseOptions) => Effect.Effect<{
    readonly version: 1;
    readonly metadata?: {
        readonly [x: string]: JsonValue;
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
}, Schema.SchemaError, never>;
export declare const RecordedAt: Schema.DateTimeUtcFromString;
declare const MissingRecordedAtError_base: Schema.Class<MissingRecordedAtError, Schema.TaggedStruct<"MissingRecordedAtError", {
    readonly cassetteName: Schema.String;
}>, import("effect/Cause").YieldableError>;
export declare class MissingRecordedAtError extends MissingRecordedAtError_base {
    get message(): string;
}
export declare const getRecordedAt: (cassette: {
    readonly version: 1;
    readonly metadata?: {
        readonly [x: string]: JsonValue;
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
}) => Effect.Effect<import("effect/Option").Option<import("effect/DateTime").Utc>, Schema.SchemaError, never>;
export * as CassetteModel from "./model.js";
