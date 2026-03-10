/**
 * Command Debouncer
 * 
 * Ensures only the latest command in a rapid sequence is executed.
 * Useful for slider inputs (dimming) to prevent flooding the bridge.
 */
export class CommandDebouncer {
    private currentRunId = 0;

    /**
     * Run a command with debounce logic.
     * If another command is requested globally for this debouncer instance within the delay window,
     * the previous command will be rejected with 'Command superseded'.
     * 
     * @param fn The async function to execute
     * @param delayMs Delay in milliseconds to wait for settling (default: 150ms)
     */
    async run<T>(fn: () => Promise<T>, delayMs = 150): Promise<T | undefined> {
        const myId = ++this.currentRunId;
        
        await new Promise(resolve => setTimeout(resolve, delayMs));

        if (myId !== this.currentRunId) {
            // Command superseded by newer request
            // Resolve successfully to prevent UI errors/reverts in Homey
            return undefined;
        }

        return fn();
    }
}
