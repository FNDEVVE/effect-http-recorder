import { Schema } from "effect";
export declare const WebSocketEventSchema: Schema.Union<readonly [Schema.Struct<{
    readonly direction: Schema.Literals<readonly ["client", "server"]>;
    readonly kind: Schema.tag<"text">;
    readonly body: Schema.String;
}>, Schema.Struct<{
    readonly direction: Schema.Literals<readonly ["client", "server"]>;
    readonly kind: Schema.tag<"binary">;
    readonly body: Schema.String;
    readonly bodyEncoding: Schema.Literal<"base64">;
}>]>;
export type WebSocketEvent = Schema.Schema.Type<typeof WebSocketEventSchema>;
export declare const WebSocketInteractionSchema: Schema.Struct<{
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
}>;
export interface WebSocketInteraction extends Schema.Schema.Type<typeof WebSocketInteractionSchema> {
}
