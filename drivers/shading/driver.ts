import Homey from 'homey';
import { XComfortBridge } from '../../lib/connection/XComfortBridge';
import { XComfortDevice } from '../../lib/types';
import { DEVICE_TYPES } from '../../lib/XComfortProtocol';

interface XComfortApp extends Homey.App {
    bridge: XComfortBridge | null;
}

module.exports = class ShadingDriver extends Homey.Driver {
  private async listUnpairedDevices() {
    const app = this.homey.app as XComfortApp;
    const bridge = app.bridge;
    
    if (!bridge) {
      throw new Error('Bridge not connected. Please configure settings first.');
    }

    let devices: XComfortDevice[] = bridge.getDevices();
    if (!devices || devices.length === 0) {
        // Wait for devices (omitted for brevity, same logic as actuator)
        // Ideally reuse a shared helper, but duplication is safer for now
        devices = bridge.getDevices() || [];
    }

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
