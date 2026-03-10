import { BaseDevice } from '../../lib/BaseDevice';
import { DEVICE_TYPES } from '../../lib/XComfortProtocol';
import { DeviceStateUpdate } from '../../lib/types';

module.exports = class ActuatorDevice extends BaseDevice {
    private onDeviceUpdate!: (deviceId: string, state: DeviceStateUpdate) => void;
    private safetyTimer: NodeJS.Timeout | null = null;

    // Debounce/Race-condition state
    private pendingSwitchState: boolean | null = null;
    private pendingSwitchTimestamp: number = 0;
    private readonly STATE_UPDATE_GRACE_PERIOD = 3000; // ms

    // Energy tracking
    private energyKwh: number = 0;
    private lastEnergyAt: number | null = null;
    private lastPowerW: number = 0;
    private energyTimer: NodeJS.Timeout | null = null;

    /** Whether this device actually reports power data. */
    private deviceReportsPower: boolean = false;

    async onDeviceReady() {
        await this.restoreEnergyState();

        // Check dimmable setting and remove dim capability if not applicable
        const settings = this.getSettings();
        let isDimmable = settings.dimmable !== false;
        if (settings.deviceType === DEVICE_TYPES.SWITCHING_ACTUATOR) {
            isDimmable = false;
        }
        
        if (!isDimmable && this.hasCapability('dim')) {
            this.log('Device is not dimmable, removing dim capability');
            await this.removeCapability('dim').catch(this.error);
        }

        const resolveDeviceId = (): string | number => {
            const numericId = Number(this.deviceId);
            return Number.isNaN(numericId) ? this.deviceId : numericId;
        };

        this.onDeviceUpdate = (_deviceId: string, state: DeviceStateUpdate) => {
            try {
                const now = Date.now();
                if (typeof state.switch === 'boolean') {
                    let shouldUpdate = true;
                    if (this.pendingSwitchState !== null) {
                        if (state.switch === this.pendingSwitchState) {
                            // Bridge confirmed our command — clear pending immediately
                            // so subsequent physical changes aren't suppressed
                            this.pendingSwitchState = null;
                            if (this.safetyTimer) {
                                clearTimeout(this.safetyTimer);
                                this.safetyTimer = null;
                            }
                        } else if (now - this.pendingSwitchTimestamp < this.STATE_UPDATE_GRACE_PERIOD) {
                            // Contradicting state within grace period — likely an echo
                            // of the old state before our command reached the device
                            shouldUpdate = false;
                        } else {
                            // Grace period expired — accept the actual device state
                            this.pendingSwitchState = null;
                        }
                    }

                    if (shouldUpdate) {
                        this.setCapabilityValue('onoff', state.switch).catch(this.error);
                        if (state.switch && this.hasCapability('dim') && state.dimmvalue === undefined) {
                            this.syncImplicitDimOnState();
                        }
                    }
                }

                if (typeof state.dimmvalue === 'number' && this.hasCapability('dim')) {
                    let shouldUpdateDim = true;
                    const homeyDim = Math.max(0, Math.min(1, state.dimmvalue / 99));

                    if (this.pendingSwitchState === true && homeyDim === 0) {
                        if (now - this.pendingSwitchTimestamp < this.STATE_UPDATE_GRACE_PERIOD) {
                            shouldUpdateDim = false;
                        }
                    }
                    
                    if (shouldUpdateDim) {
                        this.setCapabilityValue('dim', homeyDim).catch(this.error);
                    }
                }

                if (typeof state.power === 'number') {
                    void this.applyPowerMeasurement(state.power);
                }
            } catch (err) {
                this.error(`[Actuator] Error handling deviceUpdate for ${this.deviceId}:`, err);
            }
        };

        this.addManagedStateListener(this.deviceId, this.onDeviceUpdate);
        this.applyDeviceSnapshot();

        this.registerCapabilityListener('onoff', async (value) => {
            if (!this.bridge) return;
            try {
                this.setCapabilityValue('onoff', value).catch(() => {});
                this.setPendingState(value);

                if (this.hasCapability('dim')) {
                    if (!value) {
                        this.setCapabilityValue('dim', 0).catch(() => {});
                    } else {
                        this.syncImplicitDimOnState();
                    }
                }
                
                await this.bridge.switchDevice(resolveDeviceId(), value);
                this.startSafetyTimer(value);
            } catch (err) {
                this.error(`[Actuator] Error sending onoff command for ${this.deviceId}:`, err);
                this.pendingSwitchState = null;
                this.setCapabilityValue('onoff', !value).catch(() => {});
            }
        });

        this.registerCapabilityListener('dim', async (value) => {
            if (!this.bridge) return;
            if (!this.hasCapability('dim')) return;
            try {
                if (value === 0) {
                    this.setCapabilityValue('onoff', false).catch(() => {});
                    this.setPendingState(false);
                    await this.bridge.switchDevice(resolveDeviceId(), false);
                    this.startSafetyTimer(false);
                } else {
                    const dimValue = Math.max(1, Math.round(value * 99));
                    this.setCapabilityValue('onoff', true).catch(() => {});
                    this.setPendingState(true);
                    await this.bridge.dimDevice(resolveDeviceId(), dimValue);
                    this.startSafetyTimer(true);
                }
            } catch (err) {
                this.error(`[Actuator] Error sending dim command for ${this.deviceId}:`, err);
                this.pendingSwitchState = null;
                // Revert dim slider to previous value
                const currentDim = this.getCapabilityValue('dim');
                if (currentDim !== null && currentDim !== value) {
                    this.setCapabilityValue('dim', currentDim).catch(() => {});
                }
                if (value === 0) this.setCapabilityValue('onoff', true).catch(() => {});
            }
        });
    }

    protected onBridgeChanged(): void {
        this.applyDeviceSnapshot();
    }

    private syncImplicitDimOnState(): void {
        const currentDim = this.getCapabilityValue('dim');
        if (typeof currentDim === 'number' && currentDim > 0) {
            return;
        }

        this.setCapabilityValue('dim', 1).catch(this.error);
    }

    private applyDeviceSnapshot(): void {
        const device = this.bridge.getDevice(this.deviceId);
        if (!device || !this.onDeviceUpdate) {
            return;
        }

        const snapshot: DeviceStateUpdate = {};
        if (typeof device.switch === 'boolean') {
            snapshot.switch = device.switch;
        } else if (typeof device.curstate === 'number') {
            snapshot.switch = device.curstate === 1;
        }
        if (typeof device.dimmvalue === 'number') {
            snapshot.dimmvalue = device.dimmvalue;
        }
        if (typeof device.power === 'number') {
            snapshot.power = device.power;
        }

        if (Object.keys(snapshot).length > 0) {
            this.onDeviceUpdate(this.deviceId, snapshot);
        }
    }

    /**
     * Set the pending switch state and timestamp for debounce protection.
     */
    private setPendingState(state: boolean): void {
        this.pendingSwitchState = state;
        this.pendingSwitchTimestamp = Date.now();
    }

    /**
     * Start a safety timer that requests device states if no confirmation is received.
     */
    private startSafetyTimer(expectedState: boolean): void {
        if (this.safetyTimer) clearTimeout(this.safetyTimer);
        const safetyDelay = this.STATE_UPDATE_GRACE_PERIOD + 1500;
        this.safetyTimer = setTimeout(() => {
            if (this.pendingSwitchState === expectedState) {
                this.bridge?.requestDeviceStates?.().catch(() => {});
            }
            this.safetyTimer = null;
        }, safetyDelay);
    }

    // --- Energy Tracking Methods ---

    private async restoreEnergyState(): Promise<void> {
        const storedValue = this.getStoreValue('meterPowerKwh');
        if (typeof storedValue !== 'number' || !Number.isFinite(storedValue) || storedValue <= 0) {
            // No real energy data was ever tracked — clean up any capabilities
            // that were dynamically added for a device that doesn't report power.
            await this.removeStaleEnergyCapabilities();
            return;
        }

        // Device has stored energy history — it genuinely reports power
        this.deviceReportsPower = true;
        this.energyKwh = storedValue;
        await this.ensureEnergyCapability();
        await this.updateCapability('meter_power', this.roundEnergyValue(this.energyKwh));
    }

    /**
     * Remove measure_power and meter_power capabilities from devices that
     * were dynamically granted them but never actually reported power > 0.
     */
    private async removeStaleEnergyCapabilities(): Promise<void> {
        if (this.hasCapability('measure_power')) {
            this.log('Removing stale measure_power capability — device never reported power');
            await this.removeCapability('measure_power').catch(this.error);
        }
        if (this.hasCapability('meter_power')) {
            this.log('Removing stale meter_power capability — device never reported power');
            await this.removeCapability('meter_power').catch(this.error);
        }
    }

    private async ensurePowerCapability(): Promise<void> {
        if (!this.hasCapability('measure_power')) {
            await this.addCapability('measure_power').catch(this.error);
        }
    }

    private async ensureEnergyCapability(): Promise<void> {
        if (!this.hasCapability('meter_power')) {
            await this.addCapability('meter_power').catch(this.error);
        }
    }

    private async applyPowerMeasurement(power: number): Promise<void> {
        // Ignore zero-power from devices that have never reported real power.
        // This prevents adding energy capabilities to non-metering actuators
        // that receive power: 0 in initial discovery or state updates.
        if (!this.deviceReportsPower && power === 0) {
            return;
        }

        // First non-zero power reading confirms this device reports power
        if (!this.deviceReportsPower && power > 0) {
            this.deviceReportsPower = true;
            this.log(`Device reports power (${power}W) — enabling energy tracking`);
        }

        await this.ensurePowerCapability();
        await this.updateCapability('measure_power', power);

        this.integrateEnergy(Date.now());
        this.lastPowerW = power;
        await this.persistEnergyReading();

        if (power > 0) {
            this.startEnergyTimer();
            return;
        }

        this.stopEnergyTimer();
    }

    private integrateEnergy(now: number): void {
        if (this.lastEnergyAt !== null && now > this.lastEnergyAt && this.lastPowerW > 0) {
            const elapsedMs = now - this.lastEnergyAt;
            this.energyKwh += (this.lastPowerW * elapsedMs) / 3600000000;
        }

        this.lastEnergyAt = now;
    }

    private startEnergyTimer(): void {
        if (this.energyTimer) {
            return;
        }

        this.energyTimer = setInterval(() => {
            this.integrateEnergy(Date.now());
            void this.persistEnergyReading();
        }, 60000);
    }

    private stopEnergyTimer(): void {
        if (!this.energyTimer) {
            return;
        }

        clearInterval(this.energyTimer);
        this.energyTimer = null;
    }

    private flushEnergyTracking(): void {
        this.integrateEnergy(Date.now());
        this.stopEnergyTimer();
        void this.persistEnergyReading();
    }

    private async persistEnergyReading(): Promise<void> {
        await this.ensureEnergyCapability();
        const roundedValue = this.roundEnergyValue(this.energyKwh);
        await this.updateCapability('meter_power', roundedValue);
        await this.setStoreValue('meterPowerKwh', roundedValue).catch(this.error);
    }

    private roundEnergyValue(value: number): number {
        return Number(value.toFixed(6));
    }

    onDeleted() {
        this.flushEnergyTracking();
        if (this.safetyTimer) {
            clearTimeout(this.safetyTimer);
            this.safetyTimer = null;
        }
        super.onDeleted();
    }
}
