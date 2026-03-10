import { BaseDriver } from '../../lib/BaseDriver';
import { XComfortDevice, XComfortRoom } from '../../lib/types';
import { DEVICE_TYPES } from '../../lib/XComfortProtocol';
import { resolveThermostatRoomId } from '../../lib/utils/resolveThermostatRoomId';

module.exports = class ThermostatDriver extends BaseDriver {
  private async listUnpairedDevices() {
    const devices = await this.getDevicesFromBridge();
    const rooms = this.getBridge().getRooms();
    const formattedDevices = this.formatForPairing(devices, rooms);
    return formattedDevices;
  }

  private formatForPairing(devices: XComfortDevice[], rooms: XComfortRoom[]) {
    const seenIds = new Set<string>();
    
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
      const roomId = resolveThermostatRoomId(device, rooms);
      
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
  
  async onPairListDevices() {
      return this.listUnpairedDevices();
  }
};
