import * as Homey from 'homey';
import { BaseDriver } from '../../lib/BaseDriver';
import { XComfortDevice } from '../../lib/types';
import { DEVICE_TYPES } from '../../lib/XComfortProtocol';

module.exports = class ShadingDriver extends BaseDriver {
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

      return devType === DEVICE_TYPES.SHADING_ACTUATOR;
    });

    return filtered.map((device) => {
      const baseName = device.name || `Shading ${device.deviceId}`;
      const deviceId = device.deviceId;
      
      return {
        name: baseName,
        data: {
          id: `shading_${deviceId}`,
          deviceId: deviceId
        },
        settings: {
          shRuntime: device.shRuntime
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
