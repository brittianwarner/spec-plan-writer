/**
 * Connection Health — Reactive aggregate health for multiple actor connections.
 *
 * Watches N named actor connections and derives an overall health status:
 * - `"connected"` — all actors connected
 * - `"degraded"` — some actors connected, some not
 * - `"offline"` — no actors connected (and none are connecting)
 * - `"connecting"` — no actors connected yet, but at least one is connecting/initializing
 *
 * Works with any object exposing `connStatus` and `error` getters —
 * compatible with both `ReactiveActorHandle` and app-level ViewModels.
 *
 * @example
 * ```typescript
 * const health = createConnectionHealth(() => ({
 *   user: { connStatus: userVM.connectionStatus, error: userVM.error },
 *   notifications: { connStatus: notifsVM.connectionStatus, error: notifsVM.error },
 * }));
 *
 * // Reactive reads
 * health.status    // "connected" | "degraded" | "offline" | "connecting"
 * health.connected // 2
 * health.total     // 2
 * health.actors    // { user: { status: "connected", error: null }, ... }
 * ```
 *
 * @module
 */
// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
/**
 * Create a reactive connection health aggregator.
 *
 * Accepts a getter function that returns a record of named connection sources.
 * The getter is re-evaluated reactively — when any source's `connStatus` or
 * `error` changes, the derived health updates automatically.
 *
 * @param getSources - A getter returning `Record<string, ConnectionSource>`.
 *   Must be a function (not a static object) so that reactive reads on each
 *   source's `connStatus` and `error` happen inside `$derived.by()`, where
 *   Svelte 5 can track them as dependencies.
 *
 * @returns A {@link ConnectionHealth} object with reactive getters.
 *
 * @example
 * ```typescript
 * // With ReactiveActorHandle (from createReactiveActor)
 * const health = createConnectionHealth(() => ({
 *   counter: myReactiveActor,  // has connStatus + error getters
 *   chat: chatReactiveActor,
 * }));
 *
 * // With app-level ViewModels (map to ConnectionSource shape)
 * const health = createConnectionHealth(() => ({
 *   user: { connStatus: userVM.connectionStatus, error: userVM.error },
 *   org: { connStatus: orgVM.connectionStatus, error: orgVM.error },
 * }));
 * ```
 */
export function createConnectionHealth(getSources) {
    // $derived.by() is required here because the computation is a multi-statement
    // block (loop, conditionals). $derived only accepts a single expression.
    // Svelte tracks all reactive reads inside the callback — connStatus and error
    // on each source are read here, so any change re-runs this derivation.
    const _health = $derived.by(() => {
        const sources = getSources();
        // Object.keys() returns string[] — the cast to K[] is safe as long as
        // getSources() returns exactly the keys declared in K.
        const keys = Object.keys(sources);
        const total = keys.length;
        const actors = {};
        const unhealthy = [];
        let connectedCount = 0;
        let connectingCount = 0;
        for (const key of keys) {
            const src = sources[key];
            const isConnected = src.connStatus === "connected";
            const isConnecting = src.connStatus === "connecting" || src.connStatus === "reconnecting";
            actors[key] = {
                connected: isConnected,
                status: src.connStatus,
                error: src.error,
            };
            if (isConnected) {
                connectedCount++;
            }
            else {
                unhealthy.push(key);
                if (isConnecting)
                    connectingCount++;
            }
        }
        let status;
        if (connectedCount === total && total > 0) {
            status = "connected";
        }
        else if (connectedCount > 0) {
            status = "degraded";
        }
        else if (connectingCount > 0 || total === 0) {
            // No actors connected yet but some are in-progress, or no sources
            // registered at all (treat empty registry as "not ready yet").
            status = "connecting";
        }
        else {
            status = "offline";
        }
        return { status, connected: connectedCount, total, actors, unhealthy };
    });
    // Return an object with getters so destructuring preserves reactivity.
    return {
        get status() {
            return _health.status;
        },
        get connected() {
            return _health.connected;
        },
        get total() {
            return _health.total;
        },
        get actors() {
            return _health.actors;
        },
        get unhealthy() {
            return _health.unhealthy;
        },
    };
}
