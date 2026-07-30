/**
 * Shared RivetKit helpers for provider-level setup and mixed reactive/raw usage.
 *
 * These helpers codify the shared-client patterns common in SvelteKit apps:
 * one transport, one RivetKit wrapper, many reactive and raw consumers.
 *
 * @module
 */
import type { ActorOptions, AnyActorRegistry } from "@rivetkit/framework-base";
import type { ActorConn, ActorConnStatus, AnyActorDefinition, Client, ExtractActorsFromRegistry } from "rivetkit/client";
import { type RivetKit, type SvelteRivetKitOptions } from "./rivetkit.svelte.js";
import type { MaybeGetter } from "./internal/types.js";
/** Lazily create and reuse a single RivetKit wrapper for a shared client factory. */
export declare function createSharedRivetKit<Registry extends AnyActorRegistry>(getClient: () => Client<Registry>, opts?: SvelteRivetKitOptions<Registry>): () => RivetKit<Registry>;
/**
 * Merge static actor options with static or reactive params.
 *
 * Useful for auth tokens and Svelte-derived params while keeping actor config
 * assembly declarative and easy to reuse.
 */
export declare function withActorParams<Registry extends AnyActorRegistry, ActorName extends keyof ExtractActorsFromRegistry<Registry> & string>(base: MaybeGetter<ActorOptions<Registry, ActorName>>, params: MaybeGetter<Record<string, unknown> | undefined>): () => ActorOptions<Registry, ActorName>;
export interface ReactiveConnectionSource {
    connect(): ActorConn<AnyActorDefinition>;
}
export interface ReactiveConnection {
    readonly connection: ActorConn<AnyActorDefinition> | null;
    readonly connStatus: ActorConnStatus;
    readonly error: Error | null;
    readonly isConnected: boolean;
    connect(): ActorConn<AnyActorDefinition>;
    disconnect(): Promise<void>;
    dispose(): Promise<void>;
    onEvent(eventName: string, handler: (...args: unknown[]) => void): () => void;
    /**
     * Returns a promise that resolves to `true` when the connection is
     * established, or `false` if the timeout elapses first.
     *
     * Resolves immediately if already connected.
     *
     * @param timeout - Maximum time to wait in milliseconds (default: 30000).
     */
    whenConnected(timeout?: number): Promise<boolean>;
}
/**
 * Create a reactive wrapper around an existing raw Rivet connection source.
 *
 * This is intended for low-level `handle.connect()` consumers that still want a
 * Svelte-friendly `connStatus` / `error` bridge without adopting `useActor`.
 */
export declare function createReactiveConnection(source: ReactiveConnectionSource): ReactiveConnection;
//# sourceMappingURL=shared.svelte.d.ts.map