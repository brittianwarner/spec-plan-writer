export type Status = "idle" | "connecting" | "connected" | "disconnected";
export declare function createMockConnection(): {
    connection: any;
    setStatus(next: Status): void;
    emitError(message: string): void;
    emit(eventName: string, ...args: unknown[]): void;
};
//# sourceMappingURL=helpers.d.ts.map