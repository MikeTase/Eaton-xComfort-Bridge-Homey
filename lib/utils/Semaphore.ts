export class Semaphore {
    private permits: number;
    private queue: Array<(value: void | PromiseLike<void>) => void> = [];

    constructor(permits: number = 1) {
        this.permits = permits;
    }

    async acquire(): Promise<void> {
        if (this.permits > 0) {
            this.permits--;
            return;
        }

        return new Promise<void>((resolve) => {
            this.queue.push(resolve);
        });
    }

    release(): void {
        if (this.queue.length > 0) {
            const resolve = this.queue.shift();
            if (resolve) resolve();
        } else {
            this.permits++;
        }
    }
}
