import { BaseDriver } from '../../lib/BaseDriver';
import { XComfortRoom } from '../../lib/types';

module.exports = class RoomSensorDriver extends BaseDriver {
  async onPairListDevices() {
    const rooms = await this.getRoomsFromBridge();
    return this.formatForPairing(rooms);
  }

  private formatForPairing(rooms: XComfortRoom[]) {
    const seenIds = new Set<string>();

    return rooms
      .filter((room) => {
        const roomId = String(room.roomId || '');
        if (!roomId || seenIds.has(roomId)) {
          return false;
        }

        if (!this.supportsRoom(room)) {
          return false;
        }

        seenIds.add(roomId);
        return true;
      })
      .map((room) => ({
        name: room.name || `Room ${room.roomId}`,
        data: {
          id: `room_sensor_${room.roomId}`,
          roomId: String(room.roomId),
        },
      }));
  }

  private supportsRoom(room: XComfortRoom): boolean {
    const raw = room.raw || {};

    return (
      typeof room.temp === 'number'
      || typeof room.humidity === 'number'
      || typeof room.power === 'number'
      || typeof room.valve === 'number'
      || typeof room.currentMode === 'number'
      || typeof room.mode === 'number'
      || typeof room.lightsOn === 'number'
      || typeof room.windowsOpen === 'number'
      || typeof room.doorsOpen === 'number'
      || typeof room.temperatureOnly === 'boolean'
      || typeof raw.temp === 'number'
      || typeof raw.humidity === 'number'
      || typeof raw.power === 'number'
      || typeof raw.valve === 'number'
      || typeof raw.currentMode === 'number'
      || typeof raw.mode === 'number'
      || typeof raw.lightsOn === 'number'
      || typeof raw.windowsOpen === 'number'
      || typeof raw.doorsOpen === 'number'
      || typeof raw.temperatureOnly === 'boolean'
    );
  }
};
