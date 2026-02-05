import * as Homey from 'homey';
import { BaseDevice } from '../../lib/BaseDevice'; // Ensure BaseDevice is imported even if not used directly for side effects? No.
import { XComfortBridge } from '../../lib/connection/XComfortBridge';

// Define the shape of our specific App class
interface XComfortApp extends Homey.App {
    bridge: XComfortBridge | null;
}

module.exports = class RoomDriver extends Homey.Driver {
    async onPairListDevices() {
        // Cast using the interface for type safety
        const app = this.homey.app as unknown as XComfortApp;
        const bridge = app.bridge;

        if (!bridge) {
            throw new Error('Bridge not connected. Please configure settings first.');
        }

        const rooms = bridge.getRooms();
        
        // Filter rooms that actually have devices?
        const roomsWithDevices = rooms.filter(r => r.devices && r.devices.length > 0);

        return roomsWithDevices.map(room => ({
            name: room.name,
            data: {
                id: `room_${room.roomId}`, // Unique device ID
                roomId: room.roomId
            },
            settings: {
                deviceCount: room.devices ? room.devices.length : 0
            }
        }));
    }
}
