/**
 * Shared RivetKit helpers for provider-level setup and mixed reactive/raw usage.
 *
 * These helpers codify the shared-client patterns common in SvelteKit apps:
 * one transport, one RivetKit wrapper, many reactive and raw consumers.
 *
 * @module
 */
import { createRivetKitWithClient, } from "./rivetkit.svelte.js";
import { extract } from "./internal/extract.js";
/** Lazily create and reuse a single RivetKit wrapper for a shared client factory. */
export function createSharedRivetKit(getClient, opts) {
    let rivet;
    return () => {
        if (!rivet) {
            rivet = createRivetKitWithClient(getClient(), opts);
        }
        return rivet;
    };
}
/**
 * Merge static actor options with static or reactive params.
 *
 * Useful for auth tokens and Svelte-derived params while keeping actor config
 * assembly declarative and easy to reuse.
 */
export function withActorParams(base, params) {
    return () => {
        const resolvedBase = extract(base);
        const resolvedParams = extract(params);
        const mergedParams = {
            ...(resolvedBase.params ?? {}),
            ...(resolvedParams ?? {}),
        };
        return {
            ...resolvedBase,
            ...(Object.keys(mergedParams).length > 0 ? { params: mergedParams } : {}),
        };
    };
}
/**
 * Create a reactive wrapper around an existing raw Rivet connection source.
 *
 * This is intended for low-level `handle.connect()` consumers that still want a
 * Svelte-friendly `connStatus` / `error` bridge without adopting `useActor`.
 */
export function createReactiveConnection(source) {
    let _connection = $state.raw(null);
    let _connStatus = $state("idle");
    let _error = $state.raw(null);
    const listeners = new Set();
    const _onConnectedCallbacks = new Set();
    /** Cancel all pending whenConnected promises, resolving each with the given value. */
    function cancelPendingConnections(connected) {
        if (_onConnectedCallbacks.size === 0)
            return;
        const snapshot = [..._onConnectedCallbacks];
        _onConnectedCallbacks.clear();
        for (const cb of snapshot)
            cb(connected);
    }
    let cleanupStatus = null;
    let cleanupError = null;
    function bindConnection(conn) {
        cleanupStatus?.();
        cleanupError?.();
        _connection = conn;
        _connStatus = conn.connStatus;
        _error = null;
        cleanupStatus = conn.onStatusChange((status) => {
            _connStatus = status;
            if (status === "connected") {
                _error = null;
                cancelPendingConnections(true);
            }
        });
        cleanupError = conn.onError((error) => {
            _error = error instanceof Error ? error : new Error(String(error));
        });
        for (const listener of listeners) {
            listener.unsubscribe?.();
            listener.unsubscribe = conn.on(listener.eventName, listener.handler);
        }
    }
    function connect() {
        if (_connection)
            return _connection;
        const conn = source.connect();
        bindConnection(conn);
        return conn;
    }
    async function disconnect() {
        const conn = _connection;
        if (!conn)
            return;
        cleanupStatus?.();
        cleanupStatus = null;
        cleanupError?.();
        cleanupError = null;
        // Cancel any pending whenConnected promises before tearing down
        cancelPendingConnections(false);
        for (const listener of listeners) {
            listener.unsubscribe?.();
            listener.unsubscribe = undefined;
        }
        await conn.dispose();
        _connection = null;
        _connStatus = "disconnected";
    }
    return {
        get connection() {
            return _connection;
        },
        get connStatus() {
            return _connStatus;
        },
        get error() {
            return _error;
        },
        get isConnected() {
            return _connStatus === "connected";
        },
        connect,
        disconnect,
        dispose() {
            return disconnect();
        },
        whenConnected(timeout = 30_000) {
            if (_connStatus === "connected")
                return Promise.resolve(true);
            return new Promise((resolve) => {
                let settled = false;
                const cb = (connected) => {
                    if (settled)
                        return;
                    settled = true;
                    clearTimeout(timeoutId);
                    _onConnectedCallbacks.delete(cb);
                    resolve(connected);
                };
                _onConnectedCallbacks.add(cb);
                const timeoutId = setTimeout(() => {
                    if (settled)
                        return;
                    settled = true;
                    _onConnectedCallbacks.delete(cb);
                    resolve(false);
                }, timeout);
            });
        },
        onEvent(eventName, handler) {
            const listener = { eventName, handler };
            listeners.add(listener);
            if (_connection) {
                // Cast: the actor action surface has grown large enough that
                // rivetkit's generic `on` overload resolution hits TypeScript's
                // recursion limit. The runtime shape is correct (string name,
                // handler callback) — we just erase the deep union at the type
                // boundary.
                listener.unsubscribe = _connection.on(eventName, handler);
            }
            return () => {
                listener.unsubscribe?.();
                listeners.delete(listener);
            };
        },
    };
}
