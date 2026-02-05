import * as Homey from 'homey';
import { BaseDriver } from '../../lib/BaseDriver';
import { XComfortBridge } from '../../lib/connection/XComfortBridge';

// Define the shape of our specific App class
interface XComfortApp extends Homey.App {
    bridge: XComfortBridge | null;
}

module.exports = class RoomDriver extends BaseDriver {
    async onPairListDevices() {
        const bridge = this.getBridge();
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
