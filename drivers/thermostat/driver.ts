import { BaseDriver } from '../../lib/BaseDriver';
import { XComfortDevice } from '../../lib/types';
import { DEVICE_TYPES } from '../../lib/XComfortProtocol';

module.exports = class ThermostatDriver extends BaseDriver {
  private async listUnpairedDevices() {
    const devices = await this.getDevicesFromBridge();
    const rooms = this.getBridge().getRooms();
    const formattedDevices = this.formatForPairing(devices, rooms);
    return formattedDevices;
  }

  private formatForPairing(devices: XComfortDevice[], rooms: Array<{ roomId: string; name: string }>) {
    const seenIds = new Set<string>();
    const roomNameMap = new Map<string, string[]>();

    rooms.forEach((room) => {
      const normalizedName = room.name.trim().toLowerCase();
      if (!roomNameMap.has(normalizedName)) {
        roomNameMap.set(normalizedName, []);
      }
      roomNameMap.get(normalizedName)!.push(room.roomId);
    });
    
    const filtered = devices.filter((device) => {
      const devType = device.devType ?? 0;
      const id = device.deviceId;
      
      if (!id || seenIds.has(id)) return false;
      seenIds.add(id);

      return (
          devType === DEVICE_TYPES.HEATING_ACTUATOR ||
          devType === DEVICE_TYPES.HEATING_VALVE ||
          devType === DEVICE_TYPES.RC_TOUCH
      );
    });

    return filtered.map((device) => {
      const baseName = device.name || `Device ${device.deviceId}`;
      const roomName = device.roomName;
      const displayName = roomName ? `${roomName} - ${baseName}` : baseName;
      
      const deviceId = device.deviceId;
      const deviceType = device.devType ?? 0;
      const roomId = this.resolveRoomId(device, roomNameMap);
      
      return {
        name: displayName,
        data: {
          id: `thermostat_${deviceId}`,
          deviceId: deviceId,
          ...(roomId ? { roomId } : {})
        },
        settings: {
          deviceType
        }
      };
    });
  }

  private resolveRoomId(device: XComfortDevice, roomNameMap: Map<string, string[]>): string | undefined {
    if (typeof device.roomId === 'string' && device.roomId.length > 0) {
      return device.roomId;
    }

    const roomName = typeof device.roomName === 'string' ? device.roomName.trim().toLowerCase() : '';
    if (!roomName) {
      return undefined;
    }

    const matches = roomNameMap.get(roomName);
    if (!matches || matches.length !== 1) {
      return undefined;
    }

    return matches[0];
  }
  
  async onPairListDevices() {
      return this.listUnpairedDevices();
  }
};
