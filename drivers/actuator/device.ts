import { BaseDevice } from '../../lib/BaseDevice';
import type { XComfortBridge } from '../../lib/connection/XComfortBridge';
import { DEVICE_TYPES } from '../../lib/XComfortProtocol';
import { DeviceStateUpdate } from '../../lib/types';

module.exports = class ActuatorDevice extends BaseDevice {
    private onDeviceUpdate!: (deviceId: string, state: DeviceStateUpdate) => void;
    private safetyTimer: NodeJS.Timeout | null = null;

    // Debounce/Race-condition state
    private pendingSwitchState: boolean | null = null;
    private pendingSwitchTimestamp: number = 0;
    private readonly STATE_UPDATE_GRACE_PERIOD = 3000; // ms

    async onInit() {
        try {
            await super.onInit();
        } catch (e) {
            return; // Bridge missing
        }

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
            const rawId = this.getData().deviceId as unknown;
            const numericId = Number(rawId);
            return Number.isNaN(numericId) ? String(rawId) : numericId;
        };

        this.onDeviceUpdate = (_deviceId: string, state: DeviceStateUpdate) => {
            try {
                const now = Date.now();
                if (typeof state.switch === 'boolean') {
                    let shouldUpdate = true;
                    if (this.pendingSwitchState !== null) {
                        if (state.switch === this.pendingSwitchState) {
                             if (this.safetyTimer) {
                                 clearTimeout(this.safetyTimer);
                                 this.safetyTimer = null;
                             }
                             if (now - this.pendingSwitchTimestamp >= this.STATE_UPDATE_GRACE_PERIOD) {
                                this.pendingSwitchState = null;
                             }
                        } else {
                            if (now - this.pendingSwitchTimestamp < this.STATE_UPDATE_GRACE_PERIOD) {
                                shouldUpdate = false;
                            } else {
                                this.pendingSwitchState = null;
                            }
                        }
                    }

                    if (shouldUpdate) {
                        this.setCapabilityValue('onoff', state.switch).catch(this.error);
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
            } catch (err) {
                this.error(`[Actuator] Error handling deviceUpdate for ${this.getData().deviceId}:`, err);
            }
        };

        this.bridge.addDeviceStateListener(String(this.getData().deviceId), this.onDeviceUpdate);

        this.registerCapabilityListener('onoff', async (value) => {
            if (!this.bridge) return;
            try {
                this.setCapabilityValue('onoff', value).catch(() => {});
                this.setPendingState(value);

                if (!value && this.hasCapability('dim')) {
                    this.setCapabilityValue('dim', 0).catch(() => {});
                }
                
                await this.bridge.switchDevice(resolveDeviceId(), value);
                this.startSafetyTimer(value);
            } catch (err) {
                this.error(`[Actuator] Error sending onoff command for ${this.getData().deviceId}:`, err);
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
                this.error(`[Actuator] Error sending dim command for ${this.getData().deviceId}:`, err);
                this.pendingSwitchState = null;
                if (value === 0) this.setCapabilityValue('onoff', true).catch(() => {});
            }
        });
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

    protected onBridgeChanged(newBridge: XComfortBridge, oldBridge: XComfortBridge): void {
        if (this.onDeviceUpdate) {
            oldBridge.removeDeviceStateListener(String(this.getData().deviceId), this.onDeviceUpdate);
            newBridge.addDeviceStateListener(String(this.getData().deviceId), this.onDeviceUpdate);
        }
    }

    onDeleted() {
        if (this.safetyTimer) {
            clearTimeout(this.safetyTimer);
            this.safetyTimer = null;
        }
        if (this.bridge && this.onDeviceUpdate) {
            this.bridge.removeDeviceStateListener(String(this.getData().deviceId), this.onDeviceUpdate);
            this.log('ActuatorDevice listener removed');
        }
        super.onDeleted();
    }
}
