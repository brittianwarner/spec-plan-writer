declare const effect: {
    (fn?: () => unknown): unknown;
    root: (fn: () => void | (() => void)) => () => void;
};
declare const state: typeof $state;
//# sourceMappingURL=runes-shim.d.ts.map