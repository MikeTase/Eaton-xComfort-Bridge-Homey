import { BaseDriver } from '../../lib/BaseDriver';
import { XComfortDevice } from '../../lib/types';
import { DEVICE_TYPES } from '../../lib/XComfortProtocol';

module.exports = class WallSwitchDriver extends BaseDriver {
  private async listUnpairedDevices() {
    const devices = await this.getDevicesFromBridge();
    const pairedDevices = this.getPairedDevices(devices);
    this.homey.app?.log?.(
      `[WallSwitchDriver] Returning ${pairedDevices.length} wall switches for pairing`
    );
    return pairedDevices;
  }

  private getPairedDevices(devices: XComfortDevice[]) {
    const rockerDevices = devices
      .filter((device) => {
        const devType = Number(device.devType ?? 0);
        return devType === DEVICE_TYPES.WALL_SWITCH;
      });

    const componentMap = new Map<string, XComfortDevice[]>();
    rockerDevices.forEach((device) => {
      const componentId = device.compId !== undefined ? String(device.compId) : `device:${device.deviceId}`;
      if (!componentMap.has(componentId)) {
        componentMap.set(componentId, []);
      }
      componentMap.get(componentId)!.push(device);
    });

    componentMap.forEach((group) => {
      group.sort((left, right) => Number(left.deviceId) - Number(right.deviceId));
    });

    return rockerDevices.map((device) => {
        const baseName = this.getDisplayBaseName(device, componentMap);
        const roomName = device.roomName;
        const displayName = roomName ? `${roomName} - ${baseName}` : baseName;
        const deviceId = String(device.deviceId);
        const deviceType = device.devType ?? 0;
        return {
          name: displayName,
          data: {
            id: `switch_${deviceId}`,
            deviceId
          },
          settings: {
            deviceType
          }
        };
      });
  }

  private getDisplayBaseName(device: XComfortDevice, componentMap: Map<string, XComfortDevice[]>): string {
    const baseName = device.name || `Device ${device.deviceId}`;
    const componentId = device.compId !== undefined ? String(device.compId) : `device:${device.deviceId}`;
    const group = componentMap.get(componentId) || [];

    if (group.length <= 1) {
      return baseName;
    }

    const channelIndex = group.findIndex((entry) => String(entry.deviceId) === String(device.deviceId));
    if (channelIndex === -1) {
      return baseName;
    }

    return `${baseName} - Button ${channelIndex + 1}`;
  }

  async onPairListDevices() {
    return this.listUnpairedDevices();
  }
}
