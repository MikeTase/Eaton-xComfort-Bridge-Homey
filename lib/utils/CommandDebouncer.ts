/**
 * Command Debouncer
 *
 * Leading-edge debounce: the FIRST call in an idle period is sent immediately,
 * so isolated taps (e.g. a single dim adjustment) feel instant. While a command
 * is in flight or within the cool-down window, additional calls are queued and
 * only the most recent one is executed once the window clears. Earlier
 * superseded calls resolve with `undefined` so Homey's capability UI doesn't
 * flash an error/revert.
 *
 * Useful for slider inputs (dimming) to prevent flooding the bridge while
 * staying responsive to single inputs.
 */
export class CommandDebouncer {
    private currentRunId = 0;
    private busyUntil = 0;
    private running = false;
    private stateChangeWaiters: Array<() => void> = [];

    /**
     * Run a command with leading-edge debounce.
     *
     * Behaviour:
     * - If no command has run within `delayMs`, fire `fn` immediately.
     * - Otherwise, wait for the window to clear; if a newer call arrives in
     *   the meantime, this one is superseded and resolves `undefined`.
     *
     * @param fn The async function to execute
     * @param delayMs Cool-down/coalesce window in milliseconds (default: 150ms)
     */
    async run<T>(fn: () => Promise<T>, delayMs = 150): Promise<T | undefined> {
        const myId = ++this.currentRunId;

        while (true) {
            const now = Date.now();
            if (!this.running && now >= this.busyUntil) {
                this.running = true;
                try {
                    return await fn();
                } finally {
                    // Start the cool-down window after the command finishes so
                    // subsequent calls stay coalesced even if bridge I/O is slow.
                    this.running = false;
                    this.busyUntil = Date.now() + delayMs;
                    const waiters = this.stateChangeWaiters;
                    this.stateChangeWaiters = [];
                    waiters.forEach((resolve) => resolve());
                }
            }

            await this.waitForAvailability();

            if (myId !== this.currentRunId) {
                // Superseded by a newer request. Resolve successfully so Homey
                // doesn't bounce the slider value back.
                return undefined;
            }
        }
    }

    private async waitForAvailability(): Promise<void> {
        if (this.running) {
            await new Promise<void>((resolve) => {
                this.stateChangeWaiters.push(resolve);
            });
            return;
        }

        const waitMs = Math.max(0, this.busyUntil - Date.now());
        if (waitMs > 0) {
            await new Promise<void>((resolve) => {
                setTimeout(resolve, waitMs);
            });
        }
    }
}
