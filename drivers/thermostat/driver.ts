import * as Homey from 'homey';
import { XComfortBridge } from '../../lib/connection/XComfortBridge';
import { XComfortDevice } from '../../lib/types';
import { DEVICE_TYPES } from '../../lib/XComfortProtocol';

interface XComfortApp extends Homey.App {
    bridge: XComfortBridge | null;
}

module.exports = class ThermostatDriver extends Homey.Driver {
  private async listUnpairedDevices() {
    const app = this.homey.app as XComfortApp;
    const bridge = app.bridge;
    
    if (!bridge) {
      throw new Error('Bridge not connected. Please configure settings first.');
    }

    let devices: XComfortDevice[] = bridge.getDevices();

    if (!devices || devices.length === 0) {
      devices = await new Promise<XComfortDevice[]>((resolve) => {
        let isResolved = false;
        let timeoutTimer: NodeJS.Timeout;

        const cleanup = () => {
             if (timeoutTimer) clearTimeout(timeoutTimer);
             bridge.removeListener('devices_loaded', onLoaded);
        };

        const finish = (loaded: XComfortDevice[]) => {
          if (isResolved) return;
          isResolved = true;
          cleanup();
          resolve(loaded || bridge.getDevices() || []);
        };

        const onLoaded = (loadedDevices: XComfortDevice[]) => finish(loadedDevices);

        bridge.once('devices_loaded', onLoaded);

        timeoutTimer = setTimeout(() => {
          finish(bridge.getDevices() || []);
        }, 15000);
      });
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
