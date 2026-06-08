export class Semaphore {
    private permits: number;
    private queue: Array<{
        resolve: (value: void | PromiseLike<void>) => void;
        reject: (reason?: unknown) => void;
    }> = [];

    constructor(permits: number = 1) {
        this.permits = permits;
    }

    async acquire(): Promise<void> {
        if (this.permits > 0) {
            this.permits--;
            return;
        }

        return new Promise<void>((resolve, reject) => {
            this.queue.push({ resolve, reject });
        });
    }

    release(): void {
        if (this.queue.length > 0) {
            const waiter = this.queue.shift();
            if (waiter) waiter.resolve();
        } else {
            this.permits++;
        }
    }

    /**
     * Drain all queued waiters by rejecting them.
     * This prevents orphaned promises without granting extra permits.
     */
    drain(reason: Error = new Error('Semaphore drained')): void {
        while (this.queue.length > 0) {
            const waiter = this.queue.shift();
            if (waiter) waiter.reject(reason);
        }
    }
}
