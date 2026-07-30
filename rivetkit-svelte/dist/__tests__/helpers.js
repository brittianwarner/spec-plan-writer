// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createMockConnection() {
    let status = "idle";
    const statusListeners = new Set();
    const errorListeners = new Set();
    const eventListeners = new Map();
    const connection = {
        get connStatus() {
            return status;
        },
        onStatusChange(callback) {
            statusListeners.add(callback);
            return () => statusListeners.delete(callback);
        },
        onError(callback) {
            errorListeners.add(callback);
            return () => errorListeners.delete(callback);
        },
        on(eventName, callback) {
            let listeners = eventListeners.get(eventName);
            if (!listeners) {
                listeners = new Set();
                eventListeners.set(eventName, listeners);
            }
            listeners.add(callback);
            return () => listeners?.delete(callback);
        },
        async dispose() {
            status = "disconnected";
            statusListeners.forEach((listener) => listener(status));
        },
        ping() {
            return "pong";
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    };
    return {
        connection,
        setStatus(next) {
            status = next;
            statusListeners.forEach((listener) => listener(status));
        },
        emitError(message) {
            const error = new Error(message);
            errorListeners.forEach((listener) => listener(error));
        },
        emit(eventName, ...args) {
            eventListeners.get(eventName)?.forEach((listener) => listener(...args));
        },
    };
}
