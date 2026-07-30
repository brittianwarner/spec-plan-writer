export { createRivetKit, createRivetKitWithClient, createClient, type RivetKit, type ActorState, type ReactiveActorHandle, type ActorConnStatus, type ActorOptions, type AnyActorRegistry, type WarmUpActorOptions, type PreConnectHandle, type PreloadActorOptions, type ActionDefaults, type SvelteRivetKitOptions, } from "./rivetkit.svelte.js";
export { createRivetContext, type RivetContext } from "./context.js";
export { createSharedRivetKit, withActorParams, createReactiveConnection, type ReactiveConnection, type ReactiveConnectionSource, } from "./shared.svelte.js";
export { createConnectionHealth, type ConnectionSource, type ConnectionHealth, type ActorHealth, type HealthStatus, } from "./connection-health.svelte.js";
export { isActorError, actorErrorCode, actorErrorMessage, getActionError, type ActionErrorInfo, } from "./errors.js";
export type { Getter, MaybeGetter } from "./internal/types.js";
export { extract } from "./internal/extract.js";
//# sourceMappingURL=index.d.ts.map