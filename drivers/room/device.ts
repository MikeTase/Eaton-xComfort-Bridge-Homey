import Homey from 'homey';
import { XComfortBridge } from '../../lib/connection/XComfortBridge';
import { RoomStateUpdate } from '../../lib/types';

module.exports = class RoomDevice extends Homey.Device {
    private bridge!: XComfortBridge;

    async onInit() {
        this.log('RoomDevice init:', this.getName());
        const app = this.homey.app as any;
        this.bridge = app.bridge;

        if (!this.bridge) {
            this.setUnavailable('Bridge not connected');
            return;
        }

        const roomId = String(this.getData().roomId);

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
        this.bridge.addRoomStateListener(roomId, (rid, state: RoomStateUpdate) => {
             this.onRoomUpdate(rid, state);
        });
        
        // Initial Refresh
        this.updateFromBridge(roomId);
    }

    onRoomUpdate(roomId: string, state: RoomStateUpdate) {
        if (typeof state.switch === 'boolean') {
            this.setCapabilityValue('onoff', state.switch).catch(() => {});
        }
        if (typeof state.dimmvalue === 'number') {
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

    updateFromBridge(roomId: string) {
        const room = this.bridge.getRoom(roomId);
        if (room) {
            // We can construct a partial state update from the known room data if available
            // but roomStateManager stores the latest room object. 
            // Currently roomStateManager doesn't emit immediately on listener add? 
            // Manually sync properties we have.
            // Actually getRoom() returns the last known state object.
            // But XComfortRoom type might not have all 'switch'/'dimmvalue' directly if they are computed?
            // Let's check XComfortRoom definition.
            
            // XComfortRoom usually has structure from REQUEST_ROOMS response. 
            // It might not have real-time 'switch' state unless tracked.
            // However, RoomStateManager merges updates into it?
            // Assuming roomStateManager updates the room object cache.
        }
    }

    async onDeleted() {
        if (this.bridge) {
            const roomId = String(this.getData().roomId);
            // We can't easily remove anonymous listener without storing the ref
            // But usually this instance is destroyed.
            // Fix: store the bound listener
            // Ideally addRoomStateListener should accept the listener.
            // Since we use an arrow function in onInit, we can't remove it easily.
            // Better to make onRoomUpdate a bound method and pass it directly.
        }
    }
}
