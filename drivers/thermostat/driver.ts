import * as Homey from 'homey';
import { BaseDriver } from '../../lib/BaseDriver';
import { XComfortDevice } from '../../lib/types';
import { DEVICE_TYPES } from '../../lib/XComfortProtocol';

module.exports = class ThermostatDriver extends BaseDriver {
  private async listUnpairedDevices() {
    const devices = await this.getDevicesFromBridge();
    const formattedDevices = this.formatForPairing(devices);
    return formattedDevices;
  }

  private formatForPairing(devices: XComfortDevice[]) {
    const seenIds = new Set<string>();
    
    const filtered = devices.filter((device) => {
      const devType = device.devType ?? 0;
      const id = device.deviceId;
      
      if (!id || seenIds.has(id)) return false;
      seenIds.add(id);

      return (
          devType === DEVICE_TYPES.HEATING_ACTUATOR ||
          devType === DEVICE_TYPES.HEATING_VALVE ||
          devType === DEVICE_TYPES.RC_TOUCH ||
          devType === DEVICE_TYPES.TEMP_HUMIDITY_SENSOR
      );
    });

    return filtered.map((device) => {
      const baseName = device.name || `Device ${device.deviceId}`;
      const roomName = (device as any).roomName; 
      const displayName = roomName ? `${roomName} - ${baseName}` : baseName;
      
      const deviceId = device.deviceId;
      const deviceType = device.devType ?? 0;
      
      return {
        name: displayName,
        data: {
          id: `thermostat_${deviceId}`,
          deviceId: deviceId
        },
        settings: {
          deviceType
        }
      };
    });
  }
  
  onPair(session: Homey.PairSession) {
      session.setHandler('list_devices', async () => {
          return this.listUnpairedDevices();
      });
  }
};
