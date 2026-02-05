import { BaseDevice } from '../../lib/BaseDevice';
import { DeviceStateUpdate } from '../../lib/types';

module.exports = class ActuatorDevice extends BaseDevice {
    private onDeviceUpdate!: (deviceId: string, state: DeviceStateUpdate) => void;

    async onInit() {
        try {
            await super.onInit();
        } catch (e) {
            return; // Bridge missing
        }

        // Check dimmable setting and remove dim capability if not applicable
        const settings = this.getSettings();
        // Check explicit flag OR check deviceType (100 = switch, 101 = dim)
        // If deviceType is 100, force non-dimmable even if settings said true previously
        let isDimmable = settings.dimmable !== false;
        if (settings.deviceType === 100) {
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

        // Debounce/Race-condition handling
        let pendingSwitchState: boolean | null = null;
        let pendingSwitchTimestamp: number = 0;
        let safetyTimer: NodeJS.Timeout | null = null;
        const STATE_UPDATE_GRACE_PERIOD = 3000; // ms

        this.onDeviceUpdate = (deviceId: string, state: DeviceStateUpdate) => {
            try {
                const now = Date.now();
                if (typeof state.switch === 'boolean') {
                    let shouldUpdate = true;
                    if (pendingSwitchState !== null) {
                        if (state.switch === pendingSwitchState) {
                             // State confirmed - Cancel safety check
                             if (safetyTimer) {
                                 clearTimeout(safetyTimer);
                                 safetyTimer = null;
                             }

                             // Don't clear pendingSwitchState yet to protect against subsequent ghost echoes
                             if (now - pendingSwitchTimestamp >= STATE_UPDATE_GRACE_PERIOD) {
                                pendingSwitchState = null;
                             }
                        } else {
                            if (now - pendingSwitchTimestamp < STATE_UPDATE_GRACE_PERIOD) {
                                // Ignore update, it contradicts our recent command and is likely old state
                                shouldUpdate = false;
                            } else {
                                // Timeout expired, accept valid external change
                                pendingSwitchState = null;
                            }
                        }
                    }

                    if (shouldUpdate) {
                        this.setCapabilityValue('onoff', state.switch).catch(console.error);
                    }
                }

                if (typeof state.dimmvalue === 'number' && this.hasCapability('dim')) {
                    let shouldUpdateDim = true;
                    const homeyDim = Math.max(0, Math.min(1, state.dimmvalue / 99));

                    // If we are expecting ON, and we get dim=0, this is likely an echo of the previous OFF state
                    if (pendingSwitchState === true && homeyDim === 0) {
                        if (now - pendingSwitchTimestamp < STATE_UPDATE_GRACE_PERIOD) {
                            shouldUpdateDim = false;
                        }
                    }
                    
                    if (shouldUpdateDim) {
                        this.setCapabilityValue('dim', homeyDim).catch(console.error);
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
                // Optimistic UI update
                this.setCapabilityValue('onoff', value).catch(() => {});
                
                // Set pending state to prevent race conditions
                pendingSwitchState = value;
                pendingSwitchTimestamp = Date.now();

                if (!value && this.hasCapability('dim')) {
                    this.setCapabilityValue('dim', 0).catch(() => {});
                }
                
                // switchDevice uses the 1/0 logic internally now
                await this.bridge.switchDevice(resolveDeviceId(), value, (sendTime?: number) => {
                    void sendTime;
                });

                // Safety: Verify state after delay if no confirmation received
                if (safetyTimer) clearTimeout(safetyTimer);
                const safetyDelay = STATE_UPDATE_GRACE_PERIOD + 1500; // 3.5s
                safetyTimer = setTimeout(() => {
                    if (pendingSwitchState === value) {
                        // Still pending? We might have lost the packet or the update.
                        if (this.bridge && this.bridge.requestDeviceStates) {
                            this.bridge.requestDeviceStates().catch(() => {});
                        }
                    }
                    safetyTimer = null;
                }, safetyDelay);
            } catch (err) {
                console.error(`[Actuator] Error sending onoff command for ${this.getData().deviceId}:`, err);
                pendingSwitchState = null; // Reset on error
                this.setCapabilityValue('onoff', !value).catch(() => {}); // Revert UI
            }
        });

        this.registerCapabilityListener('dim', async (value) => {
            if (!this.bridge) return;
            if (!this.hasCapability('dim')) return;
            try {
                if (value === 0) {
                    this.setCapabilityValue('onoff', false).catch(() => {});
                    
                     // Set pending state (dim 0 -> off)
                    pendingSwitchState = false;
                    pendingSwitchTimestamp = Date.now();
                    
                    await this.bridge.switchDevice(resolveDeviceId(), false, (sendTime?: number) => {
                        void sendTime;
                    });

                    if (safetyTimer) clearTimeout(safetyTimer);
                    const safetyDelay = STATE_UPDATE_GRACE_PERIOD + 1500;
                    safetyTimer = setTimeout(() => {
                         if (pendingSwitchState === false) {
                            if (this.bridge && this.bridge.requestDeviceStates) {
                                this.bridge.requestDeviceStates().catch(() => {});
                            }
                         }
                         safetyTimer = null;
                    }, safetyDelay);
                } else {
                    const dimValue = Math.max(1, Math.round(value * 99));
                    this.setCapabilityValue('onoff', true).catch(() => {});

                    // Set pending state (dim > 0 -> on)
                    pendingSwitchState = true;
                    pendingSwitchTimestamp = Date.now();

                    await this.bridge.dimDevice(resolveDeviceId(), dimValue, (sendTime?: number) => {
                        void sendTime;
                    });

                    if (safetyTimer) clearTimeout(safetyTimer);
                    const safetyDelay = STATE_UPDATE_GRACE_PERIOD + 1500;
                    safetyTimer = setTimeout(() => {
                         if (pendingSwitchState === true) {
                            if (this.bridge && this.bridge.requestDeviceStates) {
                                this.bridge.requestDeviceStates().catch(() => {});
                            }
                         }
                         safetyTimer = null;
                    }, safetyDelay);
                }
            } catch (err) {
                this.error(`[Actuator] Error sending dim command for ${this.getData().deviceId}:`, err);
                pendingSwitchState = null;
                // Revert is harder for dimming (need previous value), but we can try reverting onoff if that was the intent
                if (value === 0) this.setCapabilityValue('onoff', true).catch(() => {});
            }
        });
    }

    onDeleted() {
        if (this.bridge && this.onDeviceUpdate) {
            this.bridge.removeDeviceStateListener(String(this.getData().deviceId), this.onDeviceUpdate);
            this.log('ActuatorDevice listener removed');
        }
    }
}
