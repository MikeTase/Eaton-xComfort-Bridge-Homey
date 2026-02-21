import { BaseDriver } from '../../lib/BaseDriver';
import { XComfortDevice } from '../../lib/types';

module.exports = class ActuatorDriver extends BaseDriver {
  private async listUnpairedDevices() {
    const devices = await this.getDevicesFromBridge();
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
      const roomName = device.roomName;
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
