/**
 * Svelte context helpers for sharing a RivetKit instance through the
 * component tree.
 *
 * Follows the type-safe context pattern established by runed and bits-ui.
 *
 * @module
 */
import { createContext, hasContext, setContext } from "svelte";
import { createRivetKit, createRivetKitWithClient } from "./rivetkit.svelte.js";
export function createRivetContext(name = "RivetKit") {
    const markerKey = Symbol(name);
    const [unsafeGetContext, unsafeSetContext] = createContext();
    function has() {
        return hasContext(markerKey);
    }
    function get() {
        if (!has()) {
            throw new Error(`Context "${name}" not found. Create an app-local Rivet context and call ${name}.set(...) or ${name}.setup(...) in a parent layout.`);
        }
        return unsafeGetContext();
    }
    function set(rivet) {
        setContext(markerKey, true);
        return unsafeSetContext(rivet);
    }
    function setup(clientInput, opts) {
        return set(createRivetKit(clientInput, opts));
    }
    function setupWithClient(client, opts) {
        return set(createRivetKitWithClient(client, opts));
    }
    return {
        set,
        get,
        has,
        setup,
        setupWithClient,
    };
}
