import { BaseDevice } from '../../lib/BaseDevice';
import { DEVICE_TYPES } from '../../lib/XComfortProtocol';
import { DeviceStateUpdate, InfoEntry } from '../../lib/types';
import { parseInfoMetadata } from '../../lib/utils/parseInfoMetadata';

type DimBelowMinBehavior = 'switch_off' | 'clamp_to_min';
type DimmingProfile = 'linear' | 'led_safe';

interface ActuatorSettings {
    deviceType?: number;
    dimmable?: boolean;
    dimming_min_level?: number;
    dimming_default_on_level?: number;
    dimming_below_min_behavior?: DimBelowMinBehavior;
    dimming_profile?: DimmingProfile;
}

class ActuatorDevice extends BaseDevice {
    private onDeviceUpdate!: (deviceId: string, state: DeviceStateUpdate) => void;
    private safetyTimer: NodeJS.Timeout | null = null;

    // Debounce/Race-condition state
    private pendingSwitchState: boolean | null = null;
    private pendingSwitchTimestamp: number = 0;
    private readonly STATE_UPDATE_GRACE_PERIOD = 3000; // ms

    // Energy tracking — live capability update on every sample, throttled persist.
    private energy = this.createEnergyTracker();

    /** Whether this device actually reports power data. */
    private deviceReportsPower: boolean = false;

    async onDeviceReady() {
        await this.restoreEnergyState();

        // Check dimmable setting and remove dim capability if not applicable
        const settings = this.getSettings() as ActuatorSettings;
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
                        void this.updateCapability('onoff', state.switch);
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
                        void this.updateCapability('dim', homeyDim);
                    }
                }

                if (typeof state.power === 'number') {
                    void this.applyPowerMeasurement(state.power);
                }
                if (state.metadata) {
                    void this.applySensorMetadata(state.metadata);
                    if (typeof state.metadata.power === 'number') {
                        void this.applyPowerMeasurement(state.metadata.power);
                    }
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
                const currentState = this.getCapabilityValue('onoff');
                if (currentState === value && this.pendingSwitchState === null) {
                    if (!value && this.hasCapability('dim')) {
                        this.setCapabilityValue('dim', 0).catch(() => {});
                    }
                    return;
                }

                this.setCapabilityValue('onoff', value).catch(() => {});
                this.setPendingState(value);

                if (this.hasCapability('dim')) {
                    if (!value) {
                        this.setCapabilityValue('dim', 0).catch(() => {});
                    } else {
                        this.syncImplicitDimOnState();
                    }
                }

                const bridge = this.bridge;
                const defaultOnDim = this.getDefaultOnDimLevel();
                const command = value && this.hasCapability('dim') && defaultOnDim < 1
                    ? bridge.dimDevice(resolveDeviceId(), this.dimLevelToProtocol(defaultOnDim))
                    : bridge.switchDevice(resolveDeviceId(), value);

                void command
                    .then(() => this.startSafetyTimer(value))
                    .catch((err) => {
                        this.error(`[Actuator] Error sending onoff command for ${this.deviceId}:`, err);
                        this.pendingSwitchState = null;
                        this.setCapabilityValue('onoff', !value).catch(() => {});
                    });
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
                const requestedDim = this.normalizeRequestedDimLevel(value);

                if (requestedDim === 0) {
                    this.setCapabilityValue('onoff', false).catch(() => {});
                    this.setPendingState(false);
                    const bridge = this.bridge;
                    void bridge.switchDevice(resolveDeviceId(), false)
                        .then(() => this.startSafetyTimer(false))
                        .catch((err) => {
                            this.error(`[Actuator] Error sending dim command for ${this.deviceId}:`, err);
                            this.pendingSwitchState = null;
                            const currentDim = this.getCapabilityValue('dim');
                            if (currentDim !== null && currentDim !== value) {
                                this.setCapabilityValue('dim', currentDim).catch(() => {});
                            }
                            this.setCapabilityValue('onoff', true).catch(() => {});
                        });
                } else {
                    if (requestedDim !== value) {
                        this.setCapabilityValue('dim', requestedDim).catch(() => {});
                    }
                    const dimValue = this.dimLevelToProtocol(requestedDim);
                    this.setCapabilityValue('onoff', true).catch(() => {});
                    this.setPendingState(true);
                    const bridge = this.bridge;
                    void bridge.dimDevice(resolveDeviceId(), dimValue)
                        .then(() => this.startSafetyTimer(true))
                        .catch((err) => {
                            this.error(`[Actuator] Error sending dim command for ${this.deviceId}:`, err);
                            this.pendingSwitchState = null;
                            const currentDim = this.getCapabilityValue('dim');
                            if (currentDim !== null && currentDim !== value) {
                                this.setCapabilityValue('dim', currentDim).catch(() => {});
                            }
                        });
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

    async onSettings({ newSettings, changedKeys }: { newSettings: ActuatorSettings; changedKeys: string[] }): Promise<void> {
        if (changedKeys.includes('dimmable')) {
            const isDimmable = newSettings.dimmable !== false
                && newSettings.deviceType !== DEVICE_TYPES.SWITCHING_ACTUATOR;
            if (isDimmable && !this.hasCapability('dim')) {
                await this.addCapability('dim').catch(this.error);
            } else if (!isDimmable && this.hasCapability('dim')) {
                await this.removeCapability('dim').catch(this.error);
            }
        }

        if (!this.hasCapability('dim')) {
            return;
        }

        if (
            changedKeys.includes('dimming_min_level')
            || changedKeys.includes('dimming_default_on_level')
            || changedKeys.includes('dimming_below_min_behavior')
        ) {
            const currentDim = this.getCapabilityValue('dim');
            if (typeof currentDim === 'number' && currentDim > 0) {
                const normalized = this.normalizeRequestedDimLevel(currentDim);
                if (normalized !== currentDim) {
                    await this.setCapabilityValue('dim', normalized).catch(this.error);
                }
            }
        }
    }

    private syncImplicitDimOnState(): void {
        const currentDim = this.getCapabilityValue('dim');
        if (typeof currentDim === 'number' && currentDim > 0) {
            return;
        }

        this.setCapabilityValue('dim', this.getDefaultOnDimLevel()).catch(this.error);
    }

    private normalizeRequestedDimLevel(value: number): number {
        const dim = Math.max(0, Math.min(1, value));
        if (dim <= 0) {
            return 0;
        }

        const minimum = this.getMinimumDimLevel();
        if (dim >= minimum) {
            return dim;
        }

        return this.getBelowMinBehavior() === 'clamp_to_min' ? minimum : 0;
    }

    private dimLevelToProtocol(value: number): number {
        const normalized = this.normalizeRequestedDimLevel(value);
        const profiled = this.applyDimmingProfile(normalized);
        return Math.max(1, Math.min(99, Math.round(profiled * 99)));
    }

    private applyDimmingProfile(value: number): number {
        if (value <= 0 || value >= 1 || this.getDimmingProfile() !== 'led_safe') {
            return value;
        }

        const minimum = this.getMinimumDimLevel();
        if (value <= minimum || minimum >= 1) {
            return value;
        }

        const normalized = (value - minimum) / (1 - minimum);
        return minimum + (Math.pow(normalized, 0.8) * (1 - minimum));
    }

    private getMinimumDimLevel(): number {
        return this.getPercentSetting('dimming_min_level', 1);
    }

    private getDefaultOnDimLevel(): number {
        return Math.max(this.getMinimumDimLevel(), this.getPercentSetting('dimming_default_on_level', 100));
    }

    private getBelowMinBehavior(): DimBelowMinBehavior {
        const settings = this.getSettings() as ActuatorSettings;
        return settings.dimming_below_min_behavior === 'clamp_to_min' ? 'clamp_to_min' : 'switch_off';
    }

    private getDimmingProfile(): DimmingProfile {
        const settings = this.getSettings() as ActuatorSettings;
        return settings.dimming_profile === 'led_safe' ? 'led_safe' : 'linear';
    }

    private getPercentSetting(key: keyof ActuatorSettings, fallback: number): number {
        const settings = this.getSettings() as ActuatorSettings;
        const rawValue = settings[key];
        const numericValue = typeof rawValue === 'number' ? rawValue : Number(rawValue);
        const percent = Number.isFinite(numericValue) ? numericValue : fallback;
        return Math.max(1, Math.min(100, percent)) / 100;
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
        if (Array.isArray(device.info)) {
            const metadata = parseInfoMetadata(device.info as InfoEntry[]);
            if (Object.keys(metadata).length > 0) {
                snapshot.metadata = metadata;
                if (typeof metadata.power === 'number' && snapshot.power === undefined) {
                    snapshot.power = metadata.power;
                }
            }
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
        const restored = await this.restorePersistedEnergy(this.energy);
        if (!restored) {
            // No real energy data was ever tracked — clean up any capabilities
            // that were dynamically added for a device that doesn't report power.
            await this.removeStaleEnergyCapabilities();
            return;
        }

        // Device has stored energy history — it genuinely reports power
        this.deviceReportsPower = true;
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

        await this.ensureDeviceCapability('measure_power');
        await this.updateCapability('measure_power', power);
        await this.energy.applyPower(power);
    }

    /** Reset the cumulative energy meter to zero (used by the Flow action). */
    public async resetEnergyMeter(): Promise<void> {
        await this.energy.reset();
    }

    async onDeleted(): Promise<void> {
        await this.energy.flush();
        if (this.safetyTimer) {
            clearTimeout(this.safetyTimer);
            this.safetyTimer = null;
        }
        super.onDeleted();
    }

    async onUninit(): Promise<void> {
        // Flush so the throttled energy persist doesn't lose up to 30s of
        // accumulated kWh on every app update/restart.
        await this.energy.flush();
        if (this.safetyTimer) {
            clearTimeout(this.safetyTimer);
            this.safetyTimer = null;
        }
        await super.onUninit();
    }
}

export default ActuatorDevice;
module.exports = ActuatorDevice;
