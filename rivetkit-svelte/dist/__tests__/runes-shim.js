"use strict";
const effect = ((fn) => fn?.());
effect.root = (fn) => {
    const cleanup = fn();
    return typeof cleanup === "function" ? cleanup : () => { };
};
const state = ((value) => value);
state.raw = (value) => value;
globalThis.$state = state;
globalThis.$effect = effect;
