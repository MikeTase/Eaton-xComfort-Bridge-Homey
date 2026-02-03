import Homey from 'homey';
import { XComfortBridge } from '../../lib/connection/XComfortBridge';

module.exports = class RoomDriver extends Homey.Driver {
    async onPairListDevices() {
        const app = this.homey.app as any;
        const bridge = app.bridge as XComfortBridge;

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
