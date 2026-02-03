import Homey from 'homey';
import { XComfortBridge } from '../../lib/connection/XComfortBridge';
import { XComfortDevice } from '../../lib/types';

// Define the interface for our specific App
interface XComfortApp extends Homey.App {
    bridge: XComfortBridge | null;
}

module.exports = class ActuatorDriver extends Homey.Driver {
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

        // If not authenticated yet, we might need to wait for connection first
        // We set a safety timeout.
        timeoutTimer = setTimeout(() => {
          finish(bridge.getDevices() || []);
        }, 15000);
      });
    }

    const formattedDevices = this.formatForPairing(devices);
    this.homey.app?.log?.(
      `[ActuatorDriver] Returning ${formattedDevices.length} dimmable/switching devices for pairing`
    );
    return formattedDevices;
  }

  private formatForPairing(devices: XComfortDevice[]) {
    // Only include actuators / loads with valid, unique deviceId
    const seenIds = new Set<string>();
    
    // Filter for Switching (100) and Dimming (101) Actuators
    const filtered = devices.filter((device) => {
      // Prioritize explicit devType, fallback to checking other props if needed
      // XComfortDevice interface defines devType as optional number
      const devType = device.devType ?? 0;
      const id = device.deviceId;
      
      if (!id || seenIds.has(id)) return false;
      seenIds.add(id);

      return devType === 100 || devType === 101;
    });

    return filtered.map((device) => {
      const baseName = device.name || `Device ${device.deviceId}`;
      // Use room name if available (not in XComfortDevice type explicitly but might exist in runtime)
      const roomName = (device as any).roomName; 
      const displayName = roomName ? `${roomName} - ${baseName}` : baseName;
      
      const deviceId = device.deviceId;
      const deviceType = device.devType ?? 0;

      // devType 100 = Switching, 101 = Dimming
      // Only trust 'dimmable' flag or specific type
      const dimmable = device.dimmable === true || deviceType === 101;
      
      return {
        name: displayName,
        data: {
          id: `actuator_${deviceId}`,
          deviceId: deviceId
        },
        settings: {
          deviceType,
          dimmable
        }
      };
    });
  }

  async onPairListDevices() {
    return this.listUnpairedDevices();
  }
}
