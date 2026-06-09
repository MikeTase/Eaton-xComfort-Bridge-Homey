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
    const deviceMap = new Map<string, XComfortDevice>(
      devices.map((device) => [this.getDeviceMapKey(device), device]),
    );
    const rockerDevices = devices
      .filter((device) => {
        const devType = Number(device.devType ?? 0);
        const compType = typeof device.compType === 'number' ? device.compType : undefined;
        if (!(devType === DEVICE_TYPES.WALL_SWITCH || isSupportedWallSwitchComponentType(compType))) {
          return false;
        }

        return !this.isRcTouchVirtualRocker(device, deviceMap);
      });

    const componentMap = new Map<string, XComfortDevice[]>();
    rockerDevices.forEach((device) => {
      const componentId = this.getComponentMapKey(device);
      if (!componentMap.has(componentId)) {
        componentMap.set(componentId, []);
      }
      componentMap.get(componentId)!.push(device);
    });

    componentMap.forEach((group) => {
      group.sort((left, right) => Number(left.deviceId) - Number(right.deviceId));
    });

    const candidates = rockerDevices.map((device) => {
        const baseName = this.getDisplayBaseName(device, componentMap, deviceMap);
        const roomName = device.roomName;
        const displayName = this.getDisplayNameWithBridge(roomName ? `${roomName} - ${baseName}` : baseName, device);
        const deviceType = device.devType ?? 0;
        const componentId = device.compId !== undefined ? String(device.compId) : undefined;
        const buttonNumber = this.getButtonNumber(device, componentMap);
        const componentModel = getComponentModelName(device.compType) || 'Wall Switch';
        return {
          name: displayName,
          data: {
            ...this.getBridgeDeviceData('switch', device),
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

    return this.filterUnpairedPairingDevices(candidates);
  }

  private getDisplayBaseName(
    device: XComfortDevice,
    componentMap: Map<string, XComfortDevice[]>,
    deviceMap: Map<string, XComfortDevice>,
  ): string {
    const componentName = device.componentName || device.name || `Device ${device.deviceId}`;
    const componentId = this.getComponentMapKey(device);
    const group = componentMap.get(componentId) || [];
    const channelCount = getButtonChannelCount(device.compType);
    const controlledSuffix = this.getControlledDeviceSuffix(device, deviceMap);

    if (group.length <= 1 && channelCount <= 1) {
      return `${componentName}${controlledSuffix}`;
    }

    const buttonNumber = this.getButtonNumber(device, componentMap);
    if (!buttonNumber) {
      return `${componentName}${controlledSuffix}`;
    }

    return `${componentName} - Button ${buttonNumber}${controlledSuffix}`;
  }

  private getControlledDeviceSuffix(
    device: XComfortDevice,
    deviceMap: Map<string, XComfortDevice>,
  ): string {
    const controlIds = Array.isArray(device.controlId) ? device.controlId : [];
    const controlledNames = controlIds
      .map((id) => deviceMap.get(`${this.getItemBridgeId(device) || ''}:${String(id)}`)?.name)
      .filter((name): name is string => typeof name === 'string' && name.length > 0);

    if (!controlledNames.length) {
      return '';
    }

    const uniqueNames = Array.from(new Set(controlledNames)).slice(0, 3);
    const suffix = controlledNames.length > uniqueNames.length ? ', ...' : '';
    return ` (${uniqueNames.join(', ')}${suffix})`;
  }

  private getButtonNumber(device: XComfortDevice, componentMap: Map<string, XComfortDevice[]>): number | null {
    const componentId = this.getComponentMapKey(device);
    const group = componentMap.get(componentId) || [];
    const channelIndex = group.findIndex((entry) => String(entry.deviceId) === String(device.deviceId));
    if (channelIndex === -1) {
      return null;
    }

    return channelIndex + 1;
  }

  private isRcTouchVirtualRocker(
    device: XComfortDevice,
    deviceMap: Map<string, XComfortDevice>,
  ): boolean {
    const numericId = Number(device.deviceId);
    if (Number.isNaN(numericId)) {
      return false;
    }

    const rcTouchDevice = deviceMap.get(`${this.getItemBridgeId(device) || ''}:${numericId - 1}`);
    return Number(rcTouchDevice?.devType ?? 0) === DEVICE_TYPES.RC_TOUCH;
  }

  private getDeviceMapKey(device: XComfortDevice): string {
    return `${this.getItemBridgeId(device) || ''}:${device.deviceId}`;
  }

  private getComponentMapKey(device: XComfortDevice): string {
    return `${this.getItemBridgeId(device) || ''}:${device.compId !== undefined ? String(device.compId) : `device:${device.deviceId}`}`;
  }

  async onPairListDevices() {
    return this.listUnpairedDevices();
  }
}
