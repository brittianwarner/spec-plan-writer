/**
 * @rivetkit/svelte — Svelte 5 runes integration for RivetKit actors.
 *
 * Thin adapter over `@rivetkit/framework-base` that bridges actor state
 * into Svelte 5 reactive primitives (`$state`, `$effect`).
 *
 * @module
 */
import { createRivetKit as createVanillaRivetKit, } from "@rivetkit/framework-base";
import { createClient, } from "rivetkit/client";
import { BROWSER, DEV } from "esm-env";
import { extract } from "./internal/extract.js";
export { createClient } from "rivetkit/client";
// Precomputed, immutable consumer-own knownProps Sets — these contain
// only the props that live on the consumer's `inner` object (mount,
// dispose, onEvent). Reactive state props are switched inline in the
// proxy.get trap, so they don't need to be in the Set.
const USE_ACTOR_OWN_PROPS = new Set(["onEvent"]);
const REACTIVE_ACTOR_OWN_PROPS = new Set([
    "mount",
    "dispose",
    "onEvent",
    "reconnect",
]);
// ---------------------------------------------------------------------------
// Proxy helper — wraps a getter-based inner object so unknown props
// forward to the live actor connection. Used by both useActor and
// createReactiveActor. Closure-based $state avoids the Proxy + private
// field incompatibility that exists with Svelte 5 class-field $state.
//
// When an interceptAction function is provided (built from actionDefaults),
// every proxied method call is wrapped with it — enabling timeout, error
// capture, and reactive loading state tracking without manual wrapping.
// ---------------------------------------------------------------------------
// The per-actor proxy is now built inside `createActorCoreState.createProxy`
// so its `get` trap reads `_connection` directly without going through an
// indirection function. This eliminates a function-call frame on every
// `actor.someProp` access.
// ---------------------------------------------------------------------------
// Action defaults merge helper
// ---------------------------------------------------------------------------
/**
 * Shallow-merge client-level and actor-level action defaults.
 * Actor-level values override client-level. `undefined` at actor level
 * does NOT clear a client-level value (use explicit `null` convention
 * if clearing is needed in the future).
 */
function mergeActionDefaults(clientLevel, actorLevel) {
    if (!clientLevel && !actorLevel)
        return undefined;
    if (!clientLevel)
        return actorLevel;
    if (!actorLevel)
        return clientLevel;
    return { ...clientLevel, ...actorLevel };
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
export function createRivetKit(clientInput, opts) {
    return createRivetKitWithClient(createClient(clientInput), opts);
}
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
export function createRivetKitWithClient(client, opts = {}) {
    // Internal implementations erase the ActorName generic. The deeply nested
    // conditional types inside ActorConn (rivetkit 2.1.10) exceed TypeScript's
    // instantiation depth when evaluated in generic function bodies. The public
    // RivetKit<Registry> interface provides full type safety to consumers.
    const { actionDefaults: clientActionDefaults, ...frameworkOpts } = opts;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { getOrCreateActor } = createVanillaRivetKit(client, frameworkOpts);
    // -------------------------------------------------------------------
    // Action interceptor builder — creates a closure-based interceptor
    // that captures $state variables for reactive action tracking.
    //
    // The interceptor is called by proxyWithConnection for every forwarded
    // action call, providing: timeout, error capture to $state, loading
    // tracking, and lifecycle callbacks — without manual wrapping.
    // -------------------------------------------------------------------
    // Note: buildInterceptor was inlined into createActorCoreState so the
    // interceptor closes directly over the $state variables. Eliminates 6
    // getter/setter function calls per action and lets us collapse the promise
    // chain from .then().catch().finally() (3 ticks) into .then(ok, err) (1 tick).
    // -------------------------------------------------------------------
    // Shared actor core state — extracted from useActor and
    // createReactiveActor to eliminate the ~200-line duplication of
    // $state declarations, interceptor wiring, reactive getters,
    // applyState, and whenConnected.
    //
    // Returns a publicState prototype object (getter-based) and internal
    // helpers. Consumers use Object.create(core.publicState) to extend
    // with lifecycle-specific methods (onEvent, mount, dispose).
    // -------------------------------------------------------------------
    function createActorCoreState(actorActionDefaults, onConnectionChange) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let _connection = $state.raw(null);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let _handle = $state.raw(null);
        let _connStatus = $state("idle");
        let _error = $state.raw(null);
        let _lastError = $state.raw(null);
        let _hasEverConnected = $state(false);
        let _hash = $state("");
        // Action tracking state (active when actionDefaults is configured)
        let _isMutating = $state(false);
        let _pendingActions = $state(0);
        let _lastActionError = $state.raw(null);
        let _lastAction = $state(null);
        // Non-reactive mirrors for action dispatch. Proxy-forwarded methods are
        // often invoked from effects; reading these mirrors avoids subscribing the
        // caller to connection/pending state while still keeping public getters
        // reactive through the `$state` slots above.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let connectionValue = null;
        let connStatusValue = "idle";
        let pendingActionsValue = 0;
        // whenConnected callback set — fired by applyState when connected.
        // Each callback accepts a boolean: true = connected, false = cancelled/disposed.
        const _onConnectedCallbacks = new Set();
        // Resolve action defaults: actor-level overrides client-level
        const resolvedDefaults = mergeActionDefaults(clientActionDefaults, actorActionDefaults);
        // Inlined interceptor — closes over $state variables directly, avoiding
        // 6 getter/setter calls per action invocation. Collapses the promise
        // chain to a single `.then(onSuccess, onError)` (1 microtask tick instead
        // of 3) when no `finally`-style hook is needed.
        let interceptAction;
        if (resolvedDefaults) {
            const defaults = resolvedDefaults;
            const guardOn = defaults.guardConnection !== false;
            const hasTimeout = defaults.timeout != null && defaults.timeout > 0;
            const onStart = defaults.onActionStart;
            const onSuccess = defaults.onActionSuccess;
            const onError = defaults.onActionError;
            const onSettled = defaults.onActionSettled;
            const throwMode = defaults.throwOnError;
            const throwIsFn = typeof throwMode === "function";
            interceptAction = (actionName, 
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            args, 
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            call) => {
                const shouldThrowError = (err) => throwIsFn
                    ? throwMode(err, actionName)
                    : throwMode === true;
                const settleFailure = (error, timeoutId) => {
                    const err = error instanceof Error ? error : new Error(String(error));
                    _lastActionError = err;
                    if (onError)
                        onError(err, actionName);
                    if (timeoutId !== undefined)
                        clearTimeout(timeoutId);
                    const newPending = Math.max(0, pendingActionsValue - 1);
                    pendingActionsValue = newPending;
                    _pendingActions = newPending;
                    _isMutating = newPending > 0;
                    if (onSettled)
                        onSettled(actionName);
                    if (shouldThrowError(err))
                        return Promise.reject(err);
                    return undefined;
                };
                // Fast guard — fail before any pending-count bookkeeping.
                if (guardOn && (!connectionValue || connStatusValue !== "connected")) {
                    const notYet = connStatusValue === "idle" || connStatusValue === "connecting";
                    const err = Object.assign(new Error(`Action "${actionName}" called while ${notYet ? "not yet connected" : "disconnected"}`), {
                        code: notYet ? "ACTOR_NOT_YET_CONNECTED" : "ACTOR_DISCONNECTED",
                        connStatus: connStatusValue,
                    });
                    _lastActionError = err;
                    _lastAction = actionName;
                    if (onError)
                        onError(err, actionName);
                    if (onSettled)
                        onSettled(actionName);
                    return shouldThrowError(err)
                        ? Promise.reject(err)
                        : Promise.resolve(undefined);
                }
                // Track pending actions — direct $state writes, no setter dispatch.
                pendingActionsValue = pendingActionsValue + 1;
                _pendingActions = pendingActionsValue;
                _isMutating = true;
                _lastAction = actionName;
                if (onStart)
                    onStart(actionName, args);
                let callPromise;
                try {
                    callPromise = Promise.resolve(call());
                }
                catch (error) {
                    return Promise.resolve(settleFailure(error));
                }
                // Manual race against timeout. This avoids both `Promise.race`
                // (which adds an aggregator and at least one extra Promise
                // allocation) and the unhandled-rejection suppression
                // `callPromise.catch(noop)` that the race version needed for the
                // case where the timeout wins. Direct .then on callPromise inside
                // our deferred handles both resolution paths cleanly.
                //
                // We keep setTimeout registration EAGER (not behind a
                // queueMicrotask) so vitest's `vi.useFakeTimers()` +
                // `vi.advanceTimersByTime()` test pattern still works — the
                // timer must be visible to fake-timer advancement at the call
                // site, not on the next microtask.
                let raced;
                let timeoutId;
                if (hasTimeout) {
                    const ms = defaults.timeout;
                    raced = new Promise((resolve, reject) => {
                        let settled = false;
                        timeoutId = setTimeout(() => {
                            if (settled)
                                return;
                            settled = true;
                            reject(new Error(`Action "${actionName}" timed out after ${ms}ms`));
                        }, ms);
                        callPromise.then((val) => {
                            if (settled)
                                return;
                            settled = true;
                            clearTimeout(timeoutId);
                            resolve(val);
                        }, (err) => {
                            if (settled)
                                return;
                            settled = true;
                            clearTimeout(timeoutId);
                            reject(err);
                        });
                    });
                }
                else {
                    raced = callPromise;
                }
                // Single `.then(onSuccess, onError)` = 1 microtask tick. We inline the
                // cleanup into both branches instead of using `.finally()` (which would
                // chain another promise).
                return raced.then((result) => {
                    _lastActionError = null;
                    if (onSuccess)
                        onSuccess(actionName, result);
                    if (timeoutId !== undefined)
                        clearTimeout(timeoutId);
                    const newPending = Math.max(0, pendingActionsValue - 1);
                    pendingActionsValue = newPending;
                    _pendingActions = newPending;
                    _isMutating = newPending > 0;
                    if (onSettled)
                        onSettled(actionName);
                    return result;
                }, (error) => settleFailure(error, timeoutId));
            };
        }
        // Whether anyone is watching for connection changes. `useActor` never
        // passes one; `createReactiveActor` does for event-listener rebinding.
        // Branching once here avoids reading `_connection` and calling the
        // callback path on every subscribe push from useActor.
        const watchConnChange = onConnectionChange !== undefined;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        function applyState(val) {
            if (!val)
                return;
            const prevConn = watchConnChange ? connectionValue : null;
            const nextConn = val.connection;
            const nextStatus = val.connStatus;
            const nextError = val.error;
            connectionValue = nextConn;
            connStatusValue = nextStatus;
            _connection = nextConn;
            _handle = val.handle;
            _connStatus = nextStatus;
            _error = nextError;
            // Only write `_lastError` when we actually have a new error to record.
            // Saves a read-modify-write on every state push where val.error is null,
            // which is the common case once a connection is healthy.
            if (nextError != null)
                _lastError = nextError;
            // `_hasEverConnected` is a monotonic latch — once true, never reverts.
            // Skipping the read+coalesce after the first connection means later
            // reconnects don't keep re-triggering the $state setter.
            if (!_hasEverConnected && nextStatus === "connected") {
                _hasEverConnected = true;
            }
            // Skip the `?? ""` allocation when hash is already a string.
            _hash = val.hash != null ? val.hash : "";
            // Notify connection change listeners (used by createReactiveActor
            // to rebind event listeners on reconnect). Gated by `watchConnChange`
            // so the `useActor` path avoids the branch + identity compare on
            // every push.
            if (watchConnChange && prevConn !== nextConn) {
                onConnectionChange(prevConn, nextConn);
            }
            // Resolve pending whenConnected promises.
            // Snapshot first: a callback may synchronously call whenConnected(),
            // re-adding to the set. Clearing before iteration prevents the new
            // entry from being lost.
            if (nextStatus === "connected" && _onConnectedCallbacks.size > 0) {
                const snapshot = [..._onConnectedCallbacks];
                _onConnectedCallbacks.clear();
                for (const cb of snapshot)
                    cb(true);
            }
        }
        /**
         * Promise-based ready signal. Resolves to `true` when the actor
         * connects, or `false` if the timeout elapses first.
         *
         * Resolves immediately if already connected.
         */
        function whenConnected(timeout = 30_000) {
            if (connStatusValue === "connected")
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
        }
        /**
         * Cancel all pending whenConnected promises, resolving each with `false`.
         * Called during dispose() / effect cleanup to prevent leaked timers.
         */
        function cancelPendingConnections() {
            if (_onConnectedCallbacks.size === 0)
                return;
            const snapshot = [..._onConnectedCallbacks];
            _onConnectedCallbacks.clear();
            for (const cb of snapshot)
                cb(false);
        }
        // Stable, per-actor references to the two state-mutating helpers.
        // Hoisted out of `publicState` so the proxy.get switch can return them
        // without re-binding on every read.
        function resetActionState() {
            _lastActionError = null;
            _lastAction = null;
        }
        // Inline proxy factory — closes over every `$state` slot directly, so
        // each `actor.someProp` read becomes a single switch jump + signal read.
        // This collapses three former dispatch hops (proxy.get → target[prop] →
        // prototype getter call → $state read) into one. `inner` only carries
        // consumer-specific own props (`mount`, `dispose`, `onEvent`).
        function createProxy(inner, ownKnownProps) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let cachedConn = null;
            // Map (not Object.create(null)) — measured ~9% faster for the
            // single-actor cached-method read path. The keys arrive from outside,
            // so the cache's hidden class is unstable; Map's monomorphic
            // `get(key)` outperforms property-access dict-mode lookup here.
            let cachedMethods = new Map();
            return new Proxy(inner, {
                get(target, prop, receiver) {
                    if (typeof prop !== "string") {
                        return Reflect.get(target, prop, receiver);
                    }
                    // Hot path: inline reactive state reads. Order roughly matches
                    // observed access frequency — connStatus/isConnected/connection
                    // dominate template re-reads.
                    switch (prop) {
                        case "connStatus":
                            return _connStatus;
                        case "isConnected":
                            return _connStatus === "connected";
                        case "connection":
                            return _connection;
                        case "isMutating":
                            return _isMutating;
                        case "error":
                            return _error;
                        case "lastError":
                            return _lastError;
                        case "handle":
                            return _handle;
                        case "hasEverConnected":
                            return _hasEverConnected;
                        case "hash":
                            return _hash;
                        case "pendingActions":
                            return _pendingActions;
                        case "lastActionError":
                            return _lastActionError;
                        case "lastAction":
                            return _lastAction;
                        case "resetActionState":
                            return resetActionState;
                        case "whenConnected":
                            return whenConnected;
                    }
                    // Consumer-specific own props (mount/dispose/onEvent)
                    if (ownKnownProps.has(prop)) {
                        return target[prop];
                    }
                    const conn = connectionValue;
                    if (conn) {
                        if (conn !== cachedConn) {
                            cachedConn = conn;
                            cachedMethods = new Map();
                        }
                        const cached = cachedMethods.get(prop);
                        if (cached !== undefined)
                            return cached;
                        const val = conn[prop];
                        if (typeof val !== "function")
                            return val;
                        // Invoke via Reflect.apply — never `val.apply(...)`.
                        // Rivet's actor connection is a Proxy whose `get` trap treats every
                        // unknown property as a nested action path (`snapshot.apply` etc.),
                        // so reading `.apply` does not yield Function.prototype.apply and
                        // the call hangs until the client action timeout.
                        //
                        // We use a closure rather than `Function.prototype.bind`:
                        // measured ~30% faster for cached-method invocation. V8 inlines
                        // small arrow closures aggressively at hot call sites, but bound
                        // functions take a slower dispatch path.
                        const bound = interceptAction
                            ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                (...args) => interceptAction(prop, args, () => Reflect.apply(val, conn, args))
                            : // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                (...args) => Reflect.apply(val, conn, args);
                        cachedMethods.set(prop, bound);
                        return bound;
                    }
                    if (interceptAction) {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        return (...args) => interceptAction(prop, args, () => Promise.reject(new Error(`Action "${prop}" called while disconnected`)));
                    }
                    return undefined;
                },
            });
        }
        return {
            applyState,
            cancelPendingConnections,
            getConnection: () => _connection,
            interceptAction,
            createProxy,
        };
    }
    // -------------------------------------------------------------------
    // useActor — component-scoped, $effect-managed lifecycle
    //
    // Accepts static options or a MaybeGetter thunk for reactive args.
    // Returns a Proxy that forwards unknown props to the actor connection,
    // giving flat access to actor methods (e.g. actor.sendMessage()).
    //
    // When actionDefaults is provided (at actor or client level), every
    // proxied action call is wrapped with the interceptor for timeout,
    // error capture, and reactive loading state.
    // -------------------------------------------------------------------
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function useActor(optsOrGetter) {
        // Resolve action defaults from the initial options (not reactive —
        // actionDefaults are structural config, not per-render state).
        const initialOpts = extract(optsOrGetter);
        const core = createActorCoreState(initialOpts?.actionDefaults);
        $effect(() => {
            const actorOpts = extract(optsOrGetter);
            // Strip actionDefaults before passing to framework-base
            // (it doesn't know about our Svelte-specific extension)
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { actionDefaults: _ad, ...baseOpts } = actorOpts ?? {};
            const { mount, state: derived } = getOrCreateActor(baseOpts);
            const unmount = mount();
            core.applyState(derived.state);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const unsub = derived.subscribe(({ currentVal }) => core.applyState(currentVal));
            return () => {
                unsub();
                unmount();
                core.cancelPendingConnections();
            };
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        function onEvent(eventName, handler) {
            $effect(() => {
                const conn = core.getConnection();
                if (!conn)
                    return;
                return conn.on(eventName, handler);
            });
        }
        // Reactive state is served by core.createProxy's inline switch, so the
        // inner object only carries the consumer-owned `onEvent` method.
        const inner = { onEvent };
        return core.createProxy(inner, USE_ACTOR_OWN_PROPS);
    }
    // -------------------------------------------------------------------
    // warmUp — fire-and-forget actor warm-up via resolve()
    // -------------------------------------------------------------------
    /**
     * Set of actor hashes that have already been warmed (or are in-flight).
     * Keyed by a length-prefixed actor identity tuple so compound keys containing
     * separators cannot suppress unrelated warm-ups.
     */
    const _warmed = new Set();
    function warmUpHash(name, keyArray, noCreate, createInRegion, createWithInput) {
        let hash = `${name.length}:${name}`;
        for (const part of keyArray) {
            hash += `|${part.length}:${part}`;
        }
        if (noCreate)
            hash += "|noCreate";
        if (createInRegion !== undefined) {
            hash += `|region:${createInRegion.length}:${createInRegion}`;
        }
        return createWithInput === undefined
            ? hash
            : `${hash}|input:${JSON.stringify(createWithInput)}`;
    }
    function warmUp(opts) {
        if (!BROWSER)
            return;
        const keyArray = Array.isArray(opts.key) ? opts.key : [opts.key];
        const hash = warmUpHash(opts.name, keyArray, opts.noCreate, opts.createInRegion, opts.createWithInput);
        if (_warmed.has(hash))
            return;
        _warmed.add(hash);
        const accessor = client[opts.name
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ];
        const handle = opts.noCreate
            ? accessor.get(keyArray)
            : accessor.getOrCreate(keyArray, {
                ...(opts.createInRegion !== undefined
                    ? { createInRegion: opts.createInRegion }
                    : {}),
                ...(opts.createWithInput !== undefined
                    ? { createWithInput: opts.createWithInput }
                    : {}),
            });
        handle.resolve().catch(() => {
            _warmed.delete(hash);
        });
    }
    // -------------------------------------------------------------------
    // createReactiveActor — manual lifecycle, Proxy-forwarded methods
    //
    // When actionDefaults is provided (at actor or client level), every
    // proxied action call is wrapped with the interceptor for timeout,
    // error capture, and reactive loading state.
    // -------------------------------------------------------------------
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function createReactiveActor(actorOpts) {
        const _eventListeners = new Set();
        // Create core state with connection-change callback for event rebinding
        const core = createActorCoreState(actorOpts?.actionDefaults, (_prevConn, newConn) => {
            for (const listener of _eventListeners) {
                if (listener.unsubscribe)
                    listener.unsubscribe();
                if (newConn) {
                    listener.unsubscribe = newConn.on(listener.event, listener.handler);
                }
            }
        });
        // Strip actionDefaults before passing to framework-base
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { actionDefaults: _ad, ...baseOpts } = actorOpts ?? {};
        let frameworkMount = null;
        let unsubscribeDerived = null;
        const activeUnmounts = new Set();
        function ensureFrameworkActor() {
            if (frameworkMount)
                return;
            const { mount, state: derived } = getOrCreateActor(baseOpts);
            frameworkMount = mount;
            core.applyState(derived.state);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            unsubscribeDerived = derived.subscribe(({ currentVal }) => core.applyState(currentVal));
        }
        // Reactive state is served by core.createProxy's inline switch, so the
        // inner object only carries the consumer-owned lifecycle methods.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inner = {};
        inner.mount = () => {
            if (DEV && !BROWSER) {
                console.warn("[@rivetkit/svelte] createReactiveActor.mount() called during SSR. " +
                    "Mount should only be called in browser lifecycle (onMount, $effect, etc.).");
            }
            ensureFrameworkActor();
            const frameworkUnmount = frameworkMount();
            let called = false;
            const release = () => {
                if (called)
                    return;
                called = true;
                activeUnmounts.delete(release);
                frameworkUnmount();
            };
            activeUnmounts.add(release);
            return release;
        };
        inner.dispose = () => {
            const unmounts = [...activeUnmounts];
            activeUnmounts.clear();
            for (const unmount of unmounts)
                unmount();
            unsubscribeDerived?.();
            unsubscribeDerived = null;
            frameworkMount = null;
            core.cancelPendingConnections();
            for (const listener of _eventListeners) {
                if (listener.unsubscribe)
                    listener.unsubscribe();
                listener.unsubscribe = undefined;
            }
            _eventListeners.clear();
        };
        inner.reconnect = () => {
            // Nothing mounted yet → the first mount() will open a fresh connection
            // anyway, so there is nothing to replace.
            if (!frameworkMount)
                return;
            // Force framework-base to drop the current (possibly zombie) connection and
            // build a brand-new one through its own enabled→disabled→enabled machinery.
            // Disabling makes framework-base's effect call `connection.dispose()` and
            // reset the actor to "idle"; re-enabling re-creates from "idle". The hash
            // ignores `enabled`, so both calls target the SAME actor entry.
            //
            // Ordering: framework-base defers each opts change with `queueMicrotask`,
            // and @tanstack/store flushes `setState` SYNCHRONOUSLY — so by the time the
            // re-enable microtask runs, the disable has fully propagated (connection
            // disposed, status "idle"). queueMicrotask FIFO — not timer ordering — is
            // what guarantees the re-enable observes "idle" and triggers create().
            getOrCreateActor({ ...baseOpts, enabled: false });
            queueMicrotask(() => {
                // Skip if the handle was disposed while the disable was in flight.
                if (!frameworkMount)
                    return;
                getOrCreateActor({ ...baseOpts, enabled: true });
            });
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        inner.onEvent = (eventName, handler) => {
            const listener = { event: eventName, handler };
            const conn = core.getConnection();
            if (conn) {
                listener.unsubscribe = conn.on(eventName, handler);
            }
            _eventListeners.add(listener);
            return () => {
                if (listener.unsubscribe)
                    listener.unsubscribe();
                _eventListeners.delete(listener);
            };
        };
        return core.createProxy(inner, REACTIVE_ACTOR_OWN_PROPS);
    }
    // -------------------------------------------------------------------
    // preConnect — open a real WebSocket ahead of time (caller-disposed)
    // -------------------------------------------------------------------
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function preConnect(actorOpts) {
        // SSR-safe: no socket to open on the server. Return an inert handle so
        // call sites can `await handle.dispose()` unconditionally.
        if (!BROWSER)
            return { dispose: async () => { } };
        const handle = createReactiveActor(actorOpts);
        const unmount = handle.mount();
        let disposed = false;
        return {
            dispose: async () => {
                if (disposed)
                    return;
                disposed = true;
                unmount();
                handle.dispose();
            },
        };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return {
        useActor,
        createReactiveActor,
        warmUp,
        // Deprecated alias retained for back-compat with pre-rename call sites.
        preloadActor: warmUp,
        preConnect,
    };
}
