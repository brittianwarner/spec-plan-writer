/**
 * @rivetkit/svelte — Svelte 5 runes integration for RivetKit actors.
 *
 * Thin adapter over `@rivetkit/framework-base` that bridges actor state
 * into Svelte 5 reactive primitives (`$state`, `$effect`).
 *
 * @module
 */
import { type ActorOptions, type AnyActorRegistry, type CreateRivetKitOptions } from "@rivetkit/framework-base";
import { type Client, createClient, type ExtractActorsFromRegistry, type ActorConn, type ActorHandle, type ActorConnStatus, type AnyActorDefinition } from "rivetkit/client";
import type { MaybeGetter } from "./internal/types.js";
export type { ActorConnStatus } from "@rivetkit/framework-base";
export { createClient } from "rivetkit/client";
export type { ActorOptions, AnyActorRegistry } from "@rivetkit/framework-base";
/**
 * Options for warming an actor without establishing a WebSocket connection.
 *
 * Only `name` and `key` are required — these identify the actor instance.
 * `createWithInput` is optional and only needed if the actor may not exist yet
 * and requires initialization data.
 *
 * Shared by both {@link RivetKit.warmUp | warmUp} (HTTP resolve, no WS) and
 * {@link RivetKit.preConnect | preConnect} (opens a real WS).
 *
 * @typeParam Registry - The actor registry type.
 * @typeParam ActorName - The specific actor name within the registry.
 */
export interface WarmUpActorOptions<Registry extends AnyActorRegistry = AnyActorRegistry, ActorName extends keyof ExtractActorsFromRegistry<Registry> & string = keyof ExtractActorsFromRegistry<Registry> & string> {
    /** Actor name in the registry. */
    name: ActorName;
    /** Compound key identifying the actor instance. */
    key: string | string[];
    /** If true, resolve only an existing actor and do not create it. */
    noCreate?: boolean;
    /**
     * Datacenter/region to create the actor in if it doesn't exist yet.
     * Existing actors stay in their current region; local dev drivers may ignore it.
     */
    createInRegion?: string;
    /** Optional initialization input (only used if actor doesn't exist yet). */
    createWithInput?: unknown;
}
/**
 * @deprecated Renamed to {@link WarmUpActorOptions}. Kept as an alias for
 * back-compat; will be removed in a future major.
 */
export type PreloadActorOptions<Registry extends AnyActorRegistry = AnyActorRegistry, ActorName extends keyof ExtractActorsFromRegistry<Registry> & string = keyof ExtractActorsFromRegistry<Registry> & string> = WarmUpActorOptions<Registry, ActorName>;
/**
 * Handle returned by {@link RivetKit.preConnect | preConnect}. The caller owns
 * the connection lifecycle — call {@link PreConnectHandle.dispose | dispose} to
 * tear down the WebSocket once it is no longer needed (or once a component has
 * taken over the connection).
 */
export interface PreConnectHandle {
    /** Tear down the pre-opened WebSocket connection. Safe to call more than once. */
    dispose: () => Promise<void>;
}
/**
 * Configuration for action call middleware.
 *
 * When provided to `useActor` or `createReactiveActor` (via `actionDefaults`),
 * every proxied action call is wrapped with timeout, error capture, and
 * reactive loading state tracking.
 *
 * Inspired by TanStack Query's mutation options and Zod's safeParse pattern:
 * - Errors are captured to `lastActionError` reactive state by default
 * - `throwOnError` controls whether the promise also rejects (default: `false`)
 * - Lifecycle callbacks (`onActionStart`, `onActionSuccess`, etc.) fire
 *   at the definition level — always, regardless of component mount state
 */
export interface ActionDefaults {
    /**
     * Timeout in milliseconds for action calls.
     *
     * When an action exceeds this duration, the promise resolves to `undefined`
     * (or rejects if `throwOnError` is enabled) and `lastActionError` is set
     * to a timeout error.
     *
     * Default: none (actions run until the actor responds or the connection
     * drops — Rivet's server-side `actionTimeout` is the ultimate backstop).
     */
    timeout?: number;
    /**
     * Controls whether action errors reject the returned promise.
     *
     * - `false` (default): Errors are captured to `lastActionError` reactive
     *   state. The promise resolves to `undefined`. This is the "safe" mode —
     *   no try/catch needed at the call site.
     * - `true`: Errors are captured to `lastActionError` AND re-thrown.
     *   The caller must handle the rejection.
     * - `(error, actionName) => boolean`: Called per-error to decide.
     *
     * Follows TanStack Query's mutation convention where reactive error state
     * is the primary error channel in UI frameworks.
     */
    throwOnError?: boolean | ((error: Error, actionName: string) => boolean);
    /**
     * Guard against calling actions while disconnected.
     *
     * When `true` (default), actions called while the WebSocket connection is
     * not established will immediately fail with a connection error instead of
     * queuing or hanging.
     */
    guardConnection?: boolean;
    /** Called when any action call starts. */
    onActionStart?: (actionName: string, args: any[]) => void;
    /** Called when an action completes successfully. */
    onActionSuccess?: (actionName: string, data: unknown) => void;
    /** Called when an action fails (timeout, network, or actor error). */
    onActionError?: (error: Error, actionName: string) => void;
    /** Called after an action completes (success or failure). */
    onActionSettled?: (actionName: string) => void;
}
/**
 * Proxied actor methods forwarded from the underlying connection at runtime.
 *
 * rivetkit 2.1.10 introduced deeply nested conditional types inside
 * `ActorConn` that exceed TypeScript's instantiation depth limit when
 * wrapped in `Omit`. This permissive index signature preserves the
 * "call any actor action on the object" DX while avoiding TS2589.
 * All reactive state properties above remain fully typed.
 *
 * **Note:** Actor method calls are untyped at the package level due to
 * this TypeScript constraint. Consumers should use typed client interfaces
 * from their actor registry for type safety at the call site.
 */
type ProxiedActorMethods = Record<string, (...args: any[]) => any>;
/**
 * Reactive action tracking state, available when `actionDefaults` is configured.
 *
 * These properties are `$state`-backed — reads in `$derived`, `$effect`,
 * or template expressions are automatically tracked by Svelte 5.
 */
interface ActionTrackingState {
    /** `true` when any action call is in-flight. */
    readonly isMutating: boolean;
    /** Number of concurrent in-flight action calls. */
    readonly pendingActions: number;
    /** Most recent action error. Cleared on next successful action or {@link resetActionState}. */
    readonly lastActionError: Error | null;
    /** Name of the last action that was called. */
    readonly lastAction: string | null;
    /** Clear `lastActionError` and `lastAction` (return to clean state). */
    resetActionState(): void;
}
/**
 * Reactive actor state returned by {@link RivetKit.useActor | useActor}.
 *
 * All actor actions (e.g. `sendMessage`, `getState`) are available directly
 * on the object via Proxy forwarding to the underlying connection.
 *
 * Every property is backed by Svelte 5 `$state` — reads inside
 * `$derived` / `$effect` / template expressions are automatically tracked.
 *
 * @typeParam Registry - The actor registry type.
 * @typeParam ActorName - The specific actor name within the registry.
 */
export type ActorState<Registry extends AnyActorRegistry = AnyActorRegistry, ActorName extends keyof ExtractActorsFromRegistry<Registry> & string = keyof ExtractActorsFromRegistry<Registry> & string> = {
    /** The active WebSocket connection, or `null` when not connected. */
    readonly connection: ActorConn<AnyActorDefinition> | null;
    /** The actor handle used to create the connection. */
    readonly handle: ActorHandle<AnyActorDefinition> | null;
    /** Current connection lifecycle status (`"idle"` | `"connecting"` | `"connected"` | `"reconnecting"` | `"disconnected"`). */
    readonly connStatus: ActorConnStatus;
    /** Last connection error, or `null`. */
    readonly error: Error | null;
    /** Most recent non-null connection error observed for this actor. */
    readonly lastError: Error | null;
    /** `true` when `connStatus === "connected"`. */
    readonly isConnected: boolean;
    /** `true` once this actor has connected successfully at least once. */
    readonly hasEverConnected: boolean;
    /** Internal hash identifying this actor instance. */
    readonly hash: string;
    /**
     * Subscribe to a named event broadcast by the actor.
     *
     * The subscription is automatically cleaned up when the component unmounts.
     * Must be called during component initialization (alongside `useActor`).
     *
     * @param eventName - The event name to listen for.
     * @param handler - Callback invoked when the event fires.
     */
    onEvent: (eventName: string, handler: (...args: any[]) => void) => void;
    /**
     * Returns a promise that resolves to `true` when the actor connects,
     * or `false` if the timeout elapses first.
     *
     * Resolves immediately if already connected. Eliminates the need for
     * manual `setInterval` polling loops when waiting for connection readiness.
     *
     * @param timeout - Maximum time to wait in milliseconds (default: 30000).
     */
    whenConnected: (timeout?: number) => Promise<boolean>;
} & ActionTrackingState & ProxiedActorMethods;
/**
 * Reactive actor handle returned by {@link RivetKit.createReactiveActor | createReactiveActor}.
 *
 * All actor actions are automatically available as methods via Proxy
 * forwarding to the underlying connection.
 *
 * @typeParam Registry - The actor registry type.
 * @typeParam ActorName - The specific actor name within the registry.
 */
export type ReactiveActorHandle<Registry extends AnyActorRegistry, ActorName extends keyof ExtractActorsFromRegistry<Registry> & string> = {
    /** The active WebSocket connection, or `null` when not connected. */
    readonly connection: ActorConn<AnyActorDefinition> | null;
    /** The actor handle used to create the connection. */
    readonly handle: ActorHandle<AnyActorDefinition> | null;
    /** Current connection lifecycle status. */
    readonly connStatus: ActorConnStatus;
    /** Last connection error, or `null`. */
    readonly error: Error | null;
    /** Most recent non-null connection error observed for this actor. */
    readonly lastError: Error | null;
    /** `true` when `connStatus === "connected"`. */
    readonly isConnected: boolean;
    /** `true` once this actor has connected successfully at least once. */
    readonly hasEverConnected: boolean;
    /** Internal hash identifying this actor instance. */
    readonly hash: string;
    /**
     * Start the connection lifecycle.
     *
     * Framework-base handles ref counting internally — multiple mounts
     * to the same actor share one WebSocket.
     *
     * @returns An unmount function to decrement the ref count.
     */
    mount(): () => void;
    /**
     * Clean up all event subscriptions and the framework-base state subscription.
     * Call this when the reactive actor is no longer needed.
     */
    dispose(): void;
    /**
     * Force a brand-new underlying connection, tearing down the current one even
     * when it is a half-open "zombie" socket still reporting `connected` (NAT/LB
     * idle cull, half-open TCP). Drives framework-base's `enabled` toggle —
     * disabling disposes the live connection and resets the actor to `idle`,
     * re-enabling re-creates from `idle` — so a stale socket is replaced rather
     * than reused (`getParams` re-runs, minting a fresh auth token).
     *
     * A plain `dispose()` + `mount()` cannot do this: framework-base only creates
     * a connection from `idle`, and a zombie still reports `connected`, so the dead
     * socket would be reused. No-op when the actor was never mounted.
     *
     * Event subscriptions registered via {@link onEvent} are automatically
     * re-bound onto the fresh connection.
     */
    reconnect(): void;
    /**
     * Subscribe to an actor broadcast event.
     *
     * Automatically re-binds when the connection changes (e.g. after reconnect).
     *
     * @param eventName - The event name to listen for.
     * @param handler - Callback invoked when the event fires.
     * @returns An unsubscribe function.
     */
    onEvent(eventName: string, handler: (...args: any[]) => void): () => void;
    /**
     * Returns a promise that resolves to `true` when the actor connects,
     * or `false` if the timeout elapses first.
     *
     * Resolves immediately if already connected. Eliminates the need for
     * manual `setInterval` polling loops when waiting for connection readiness.
     *
     * @param timeout - Maximum time to wait in milliseconds (default: 30000).
     */
    whenConnected(timeout?: number): Promise<boolean>;
} & ActionTrackingState & ProxiedActorMethods;
/**
 * The main RivetKit instance — returned by {@link createRivetKit} and
 * {@link createRivetKitWithClient}.
 *
 * Provides two APIs for connecting to actors:
 * - {@link RivetKit.useActor | useActor} — component-scoped, `$effect`-managed lifecycle.
 * - {@link RivetKit.createReactiveActor | createReactiveActor} — manual lifecycle for singletons and ViewModels.
 *
 * @typeParam Registry - The actor registry type.
 */
export interface RivetKit<Registry extends AnyActorRegistry> {
    /**
     * Connect to an actor and receive reactive state with auto-proxied methods.
     *
     * Must be called during component initialization (inside `<script>`).
     * Lifecycle is managed automatically via `$effect`.
     *
     * Accepts a static options object or a `MaybeGetter` thunk for reactive args:
     *
     * @example
     * ```typescript
     * // Static
     * useActor({ name: 'counter', key: ['main'] })
     * // Reactive — re-subscribes when roomId changes
     * useActor(() => ({ name: 'chatRoom', key: [roomId] }))
     * ```
     *
     * @param opts - Actor options or a getter returning actor options.
     * @returns A reactive, proxied object with actor state and methods.
     */
    useActor: <ActorName extends keyof ExtractActorsFromRegistry<Registry> & string>(opts: MaybeGetter<ActorOptions<Registry, ActorName>>) => ActorState<Registry, ActorName>;
    /**
     * Create a reactive actor handle with auto-proxied methods.
     *
     * Safe to call outside components (e.g. in a `.svelte.ts` module for
     * singletons). Lifecycle is manual via `mount()` / `dispose()`.
     * All actor actions are available directly on the returned object.
     *
     * @param opts - Actor options (name, key, params, etc.).
     * @returns A reactive, proxied handle with actor state, methods, and lifecycle controls.
     */
    createReactiveActor: <ActorName extends keyof ExtractActorsFromRegistry<Registry> & string>(opts: ActorOptions<Registry, ActorName>) => ReactiveActorHandle<Registry, ActorName>;
    /**
     * Warm an actor without establishing a WebSocket connection.
     *
     * Sends a single HTTP `PUT /actors` (getOrCreate + resolve) to ensure the
     * actor instance exists and is running. Useful for warming actors on hover
     * to eliminate cold-start latency on subsequent connections — similar to
     * SvelteKit's `data-sveltekit-preload-data` pattern.
     *
     * - **No WebSocket** — only an HTTP resolve call, no persistent connection.
     * - **Deduplicates** — same actor (name + key) is only resolved once per
     *   RivetKit instance. Failed attempts are removed from the dedup set so
     *   retries work.
     * - **Fire-and-forget** — errors are silently caught. Warm-up failure
     *   should never affect user experience.
     *
     * For the heavier tier that opens a real WebSocket ahead of time, see
     * {@link RivetKit.preConnect | preConnect}.
     *
     * @example
     * ```typescript
     * // Warm a document actor on hover
     * rivet.warmUp({ name: 'document', key: ['doc', docId] });
     * ```
     *
     * @param opts - Actor name and key to warm.
     */
    warmUp: <ActorName extends keyof ExtractActorsFromRegistry<Registry> & string>(opts: WarmUpActorOptions<Registry, ActorName>) => void;
    /**
     * @deprecated Renamed to {@link RivetKit.warmUp | warmUp}. Kept as an alias
     * for back-compat; will be removed in a future major.
     */
    preloadActor: <ActorName extends keyof ExtractActorsFromRegistry<Registry> & string>(opts: WarmUpActorOptions<Registry, ActorName>) => void;
    /**
     * Pre-open a real WebSocket connection to an actor ahead of time.
     *
     * The deliberate, heavier tier above {@link RivetKit.warmUp | warmUp}: this
     * opens (and keeps open) an actual connection so a subsequent component mount
     * finds the socket already connected. Use it only for high-intent signals —
     * broad hover should prefer `warmUp`, which costs a single HTTP call.
     *
     * - **Opens a WebSocket** — and keeps it open until you dispose it.
     * - **Caller owns the lifecycle** — you MUST call the returned
     *   `dispose()` when the connection is no longer needed, otherwise the
     *   socket leaks. (Connection sharing means a component that mounts the
     *   same actor reuses this socket.)
     * - **SSR-safe** — a no-op handle is returned during SSR.
     *
     * @example
     * ```typescript
     * const handle = rivet.preConnect({ name: 'chat', key: ['room', id] });
     * // later, once the user navigated away without entering the room:
     * await handle.dispose();
     * ```
     *
     * @param opts - Actor options (name, key, params, etc.).
     * @returns A handle whose `dispose()` tears the connection down.
     */
    preConnect: <ActorName extends keyof ExtractActorsFromRegistry<Registry> & string>(opts: ActorOptions<Registry, ActorName>) => PreConnectHandle;
}
/**
 * Options for creating a RivetKit instance, extending framework-base options
 * with Svelte-specific action middleware defaults.
 */
export interface SvelteRivetKitOptions<Registry extends AnyActorRegistry> extends CreateRivetKitOptions<Registry> {
    /**
     * Default action middleware applied to all actors created by this instance.
     *
     * Per-actor `actionDefaults` (in `useActor`/`createReactiveActor` options)
     * shallow-merge on top of these client-level defaults.
     *
     * @example
     * ```typescript
     * const rivet = createRivetKit<AppRegistry>('http://localhost:3000', {
     *   actionDefaults: {
     *     timeout: 30_000,
     *     onActionError: (err, name) => errorTelemetry(name, err),
     *   },
     * });
     * ```
     */
    actionDefaults?: ActionDefaults;
}
/**
 * Create a RivetKit instance with a new client.
 *
 * @param clientInput - Endpoint URL or client config passed to `createClient()`.
 * @param opts - Optional configuration including action middleware defaults.
 * @returns A {@link RivetKit} instance with `useActor` and `createReactiveActor`.
 *
 * @example
 * ```typescript
 * const rivet = createRivetKit<AppRegistry>('http://localhost:3000');
 *
 * // With client-level action defaults
 * const rivet = createRivetKit<AppRegistry>('http://localhost:3000', {
 *   actionDefaults: { timeout: 30_000, throwOnError: false },
 * });
 * ```
 */
export declare function createRivetKit<Registry extends AnyActorRegistry>(clientInput?: Parameters<typeof createClient<Registry>>[0], opts?: SvelteRivetKitOptions<Registry>): RivetKit<Registry>;
/**
 * Create a RivetKit instance with a pre-existing client.
 *
 * @param client - An existing rivetkit `Client` instance.
 * @param opts - Optional configuration including action middleware defaults.
 * @returns A {@link RivetKit} instance with `useActor` and `createReactiveActor`.
 *
 * @example
 * ```typescript
 * import { createClient } from 'rivetkit/client';
 * const client = createClient<AppRegistry>('http://localhost:3000');
 * const rivet = createRivetKitWithClient<AppRegistry>(client);
 * ```
 */
export declare function createRivetKitWithClient<Registry extends AnyActorRegistry>(client: Client<Registry>, opts?: SvelteRivetKitOptions<Registry>): any;
//# sourceMappingURL=rivetkit.svelte.d.ts.map