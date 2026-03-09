import { BaseDriver } from '../../lib/BaseDriver';
import { getButtonChannelCount, getComponentModelName, isSupportedWallSwitchComponentType } from '../../lib/XComfortComponents';
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
        const compType = typeof device.compType === 'number' ? device.compType : undefined;
        return devType === DEVICE_TYPES.WALL_SWITCH || isSupportedWallSwitchComponentType(compType);
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
        const componentId = device.compId !== undefined ? String(device.compId) : undefined;
        const buttonNumber = this.getButtonNumber(device, componentMap);
        const componentModel = getComponentModelName(device.compType) || 'Wall Switch';
        return {
          name: displayName,
          data: {
            id: `switch_${deviceId}`,
            deviceId,
            ...(componentId ? { componentId } : {}),
            ...(buttonNumber ? { buttonNumber } : {}),
            ...(typeof device.compType === 'number' ? { compType: device.compType } : {}),
            componentModel,
          },
          settings: {
            deviceType
          }
        };
      });
  }

  private getDisplayBaseName(device: XComfortDevice, componentMap: Map<string, XComfortDevice[]>): string {
    const componentName = device.componentName || device.name || `Device ${device.deviceId}`;
    const componentId = device.compId !== undefined ? String(device.compId) : `device:${device.deviceId}`;
    const group = componentMap.get(componentId) || [];
    const channelCount = getButtonChannelCount(device.compType);

    if (group.length <= 1 && channelCount <= 1) {
      return componentName;
    }

    const buttonNumber = this.getButtonNumber(device, componentMap);
    if (!buttonNumber) {
      return componentName;
    }

    return `${componentName} - Button ${buttonNumber}`;
  }

  private getButtonNumber(device: XComfortDevice, componentMap: Map<string, XComfortDevice[]>): number | null {
    const componentId = device.compId !== undefined ? String(device.compId) : `device:${device.deviceId}`;
    const group = componentMap.get(componentId) || [];
    const channelIndex = group.findIndex((entry) => String(entry.deviceId) === String(device.deviceId));
    if (channelIndex === -1) {
      return null;
    }

    return channelIndex + 1;
  }

  async onPairListDevices() {
    return this.listUnpairedDevices();
  }
}
