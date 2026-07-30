/**
 * Svelte context helpers for sharing a RivetKit instance through the
 * component tree.
 *
 * Follows the type-safe context pattern established by runed and bits-ui.
 *
 * @module
 */
import type { AnyActorRegistry, CreateRivetKitOptions } from "@rivetkit/framework-base";
import { type RivetKit, createClient } from "./rivetkit.svelte.js";
import type { Client } from "rivetkit/client";
export interface RivetContext<Registry extends AnyActorRegistry> {
    set(rivet: RivetKit<Registry>): RivetKit<Registry>;
    get(): RivetKit<Registry>;
    has(): boolean;
    setup(clientInput?: Parameters<typeof createClient<Registry>>[0], opts?: CreateRivetKitOptions<Registry>): RivetKit<Registry>;
    setupWithClient(client: Client<Registry>, opts?: CreateRivetKitOptions<Registry>): RivetKit<Registry>;
}
export declare function createRivetContext<Registry extends AnyActorRegistry>(name?: string): RivetContext<Registry>;
//# sourceMappingURL=context.d.ts.map