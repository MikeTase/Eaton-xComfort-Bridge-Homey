/**
 * Energy Tracker
 *
 * Reusable accumulator for cumulative kWh from a stream of instantaneous power
 * (W) samples. Encapsulates the per-device energy tracking logic that was
 * previously duplicated across actuator and thermostat devices.
 *
 * Behaviour:
 *   - kWh integration uses the previous power sample over the elapsed time
 *     (left Riemann sum). The first sample arms the integrator.
 *   - A background timer keeps integrating while power > 0 so kWh advances
 *     even without new updates from the bridge.
 *   - The live value is emitted via `onTick` on every change (cheap — used to
 *     update the Homey capability). Persistence is delegated to a separate,
 *     THROTTLED `onPersist` callback so we don't write to the device store on
 *     every power sample (which can arrive several times per second). The
 *     persisted value is always flushed on `flush()` and `reset()`.
 */
export interface EnergyTrackerOptions {
    /** Background integration interval. Default 60s. */
    tickMs?: number;
    /** Minimum interval between throttled `onPersist` calls. Default 30s. */
    persistMs?: number;
    /** Throttled persistence callback (e.g. write to the Homey device store). */
    onPersist?: (kwh: number) => Promise<void> | void;
}

export class EnergyTracker {
    private kwh: number = 0;
    private lastAt: number | null = null;
    private lastPowerW: number = 0;
    private timer: NodeJS.Timeout | null = null;
    private lastPersistAt: number = 0;

    private readonly tickMs: number;
    private readonly persistMs: number;
    private readonly onPersist?: (kwh: number) => Promise<void> | void;

    /**
     * @param onTick          Called whenever kWh changes — receives the new rounded
     *                        value (6 decimals) so callers can update the capability.
     * @param optionsOrTickMs Either an options object, or (for backwards
     *                        compatibility) a number interpreted as `tickMs`.
     */
    constructor(
        private readonly onTick: (kwh: number) => Promise<void> | void,
        optionsOrTickMs: number | EnergyTrackerOptions = {},
    ) {
        if (typeof optionsOrTickMs === 'number') {
            this.tickMs = optionsOrTickMs;
            this.persistMs = 30000;
        } else {
            this.tickMs = optionsOrTickMs.tickMs ?? 60000;
            this.persistMs = optionsOrTickMs.persistMs ?? 30000;
            this.onPersist = optionsOrTickMs.onPersist;
        }
    }

    /** Restore a previously persisted reading (e.g. from Homey store). */
    restore(kwh: number): void {
        if (Number.isFinite(kwh) && kwh > 0) {
            this.kwh = kwh;
        }
    }

    /** Current rounded kWh value (6 decimals — matches legacy behaviour). */
    getKwh(): number {
        return EnergyTracker.round(this.kwh);
    }

    /**
     * Apply a new instantaneous power sample (W). Integrates the previous
     * sample over the elapsed time, then arms the next interval.
     * Returns the new rounded kWh value for convenience.
     */
    async applyPower(powerW: number): Promise<number> {
        const now = Date.now();
        this.integrate(now);
        this.lastPowerW = Math.max(0, powerW);

        await this.emit();

        if (this.lastPowerW > 0) {
            this.startTimer();
        } else {
            this.stopTimer();
        }
        return EnergyTracker.round(this.kwh);
    }

    /**
     * Stop background integration and force a final persist so any pending kWh
     * gets written. Safe to call from onDeleted().
     */
    async flush(): Promise<void> {
        this.integrate(Date.now());
        this.stopTimer();
        await this.emit(true);
    }

    /**
     * Reset the cumulative reading to zero, emit the new value and force a
     * persist so the store reflects the reset immediately. Integration of
     * future samples continues from now.
     */
    async reset(): Promise<void> {
        this.kwh = 0;
        this.lastAt = Date.now();
        await this.emit(true);
    }

    /**
     * Emit the current value: always call `onTick` (live capability update),
     * and call the throttled `onPersist` if enough time has passed (or when
     * `force` is set, e.g. on flush/reset).
     */
    private async emit(force: boolean = false): Promise<void> {
        const rounded = EnergyTracker.round(this.kwh);
        await this.onTick(rounded);

        if (!this.onPersist) {
            return;
        }
        const now = Date.now();
        if (force || now - this.lastPersistAt >= this.persistMs) {
            this.lastPersistAt = now;
            await this.onPersist(rounded);
        }
    }

    private integrate(now: number): void {
        if (this.lastAt !== null && now > this.lastAt && this.lastPowerW > 0) {
            const elapsedMs = now - this.lastAt;
            // power(W) * ms / (3600 * 1000 * 1000) = kWh
            this.kwh += (this.lastPowerW * elapsedMs) / 3600000000;
        }
        this.lastAt = now;
    }

    private startTimer(): void {
        if (this.timer) return;
        this.timer = setInterval(() => {
            this.integrate(Date.now());
            void this.emit();
        }, this.tickMs);
    }

    private stopTimer(): void {
        if (!this.timer) return;
        clearInterval(this.timer);
        this.timer = null;
    }

    private static round(value: number): number {
        return Number(value.toFixed(6));
    }
}
