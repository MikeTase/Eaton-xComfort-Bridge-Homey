import * as Homey from 'homey';
import { XComfortBridge } from '../../lib/connection/XComfortBridge';
import { RoomStateUpdate } from '../../lib/types';

module.exports = class RoomDevice extends Homey.Device {
    private bridge!: XComfortBridge;
    private onRoomUpdateListener?: (roomId: string, state: RoomStateUpdate) => void;
    private onDevicesLoadedListener?: () => void;
    private supportsDim: boolean = true;

    async onInit() {
        this.log('RoomDevice init:', this.getName());
        const app = this.homey.app as any;
        this.bridge = app.bridge;

        if (!this.bridge) {
            this.setUnavailable('Bridge not connected');
            return;
        }

        const roomId = String(this.getData().roomId);
        this.updateDimSupport(roomId);

        this.onDevicesLoadedListener = () => {
            this.updateDimSupport(roomId);
        };
        this.bridge.on('devices_loaded', this.onDevicesLoadedListener);

        // Register capability listeners
        this.registerCapabilityListener('onoff', async (value) => {
            if (!this.bridge) return;
            try {
                // Optimistic UI update
                this.setCapabilityValue('onoff', value).catch(() => {});
                await this.bridge.controlRoom(roomId, 'switch', value);
            } catch (err) {
                this.error(`Error controlling room ${roomId} onoff:`, err);
                // Revert
                this.setCapabilityValue('onoff', !value).catch(() => {});
                throw err;
            }
        });

        this.registerCapabilityListener('dim', async (value) => {
            if (!this.bridge) return;
            if (!this.supportsDim) {
                this.log(`Room ${roomId} does not support dimming`);
                return;
            }
            try {
                // Dim 0 usually means off in UI logic, but let's pass it
                // Logic: 0 sends switch OFF usually, but controlRoom handles 'dimm'
                // If value is 0, we can invoke switch OFF or dimm 0
                if (value === 0) {
                     this.setCapabilityValue('onoff', false).catch(() => {});
                     await this.bridge.controlRoom(roomId, 'switch', false);
                } else {
                     this.setCapabilityValue('onoff', true).catch(() => {});
                     const xcomfortVal = Math.round(value * 99);
                     await this.bridge.controlRoom(roomId, 'dimm', xcomfortVal);
                }
            } catch (err) {
                this.error(`Error controlling room ${roomId} dim:`, err);
                throw err;
            }
        });

        // Listen for state updates
        this.onRoomUpdateListener = (rid, state: RoomStateUpdate) => {
            this.onRoomUpdate(rid, state);
        };
        this.bridge.addRoomStateListener(roomId, this.onRoomUpdateListener);
    }

    onRoomUpdate(roomId: string, state: RoomStateUpdate) {
        if (typeof state.switch === 'boolean') {
            this.setCapabilityValue('onoff', state.switch).catch(() => {});
        }
        if (typeof state.dimmvalue === 'number' && this.hasCapability('dim')) {
            const dim = Math.max(0, Math.min(1, state.dimmvalue / 99));
            this.setCapabilityValue('dim', dim).catch(() => {});
        }
        if (typeof state.power === 'number') {
            this.setCapabilityValue('meter_power', state.power).catch(() => {});
        }
        if (typeof state.windowsOpen === 'number') {
             this.setCapabilityValue('alarm_contact.windows', state.windowsOpen > 0).catch(() => {});
        }
        if (typeof state.doorsOpen === 'number') {
             this.setCapabilityValue('alarm_contact.doors', state.doorsOpen > 0).catch(() => {});
        }
        if (typeof state.presence === 'number') {
             this.setCapabilityValue('alarm_motion', state.presence > 0).catch(() => {});
        }
    }

    async onDeleted() {
        if (this.bridge) {
            const roomId = String(this.getData().roomId);
            if (this.onRoomUpdateListener) {
                this.bridge.removeRoomStateListener(roomId, this.onRoomUpdateListener);
                this.onRoomUpdateListener = undefined;
            }
            if (this.onDevicesLoadedListener) {
                this.bridge.removeListener('devices_loaded', this.onDevicesLoadedListener);
                this.onDevicesLoadedListener = undefined;
            }
        }
    }

    private updateDimSupport(roomId: string) {
        const room = this.bridge.getRoom(roomId);
        if (!room || !Array.isArray(room.devices)) {
            return;
        }

        const supports = room.devices.some((devId) => {
            const device = this.bridge.getDevice(String(devId));
            return device?.dimmable === true || device?.devType === 101;
        });

        this.supportsDim = supports;

        if (!supports && this.hasCapability('dim')) {
            this.removeCapability('dim').catch(this.error);
        }
    }
}
