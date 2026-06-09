import { BaseDriver } from '../../lib/BaseDriver';
import { COMPONENT_TYPES, DEVICE_TYPES } from '../../lib/XComfortProtocol';
import type { BridgeStatus, XComfortDevice } from '../../lib/types';
import {
  getClassificationSettings,
  getDisplayName,
  isEnergyMeterDevice,
} from '../../lib/utils/deviceClassification';

module.exports = class EnergyMeterDriver extends BaseDriver {
  async onPairListDevices() {
    const entries = this.getBridgeEntries();
    const multiBridge = entries.length > 1;
    const bridgeCandidates = entries.flatMap((entry) => this.formatBridgeEnergyCandidates(entry, multiBridge));

    const devices = await this.getDevicesFromBridge();
    const deviceCandidates = this.formatDeviceMetersForPairing(devices);

    return this.filterUnpairedPairingDevices([...bridgeCandidates, ...deviceCandidates]);
  }

  private formatBridgeEnergyCandidates(
    entry: { id: string; name: string; bridge: { getLastBridgeStatus(): BridgeStatus | null } },
    multiBridge: boolean,
  ) {
    const status = entry.bridge.getLastBridgeStatus();
    const candidates: Array<{
      name: string;
      data: Record<string, unknown>;
      settings: Record<string, unknown>;
    }> = [];

    const meters = Array.isArray(status?.energyMeters) && status.energyMeters.length > 0
      ? status.energyMeters
      : [{ meterId: this.resolveMeterId(status), name: 'Energy Meter' }];

    meters.forEach((meter, index) => {
      const meterId = this.resolveEnergyRecordId(meter, `main_${index + 1}`);
      const meterName = this.resolveEnergyRecordName(meter, index === 0 ? 'Energy Meter' : `Energy Meter ${index + 1}`);
      const displayName = multiBridge ? `${entry.name} - ${meterName}` : meterName;
      candidates.push({
        name: displayName,
        data: {
          id: this.sanitizePairingId(`${entry.id}_energy_meter_${meterId}`),
          deviceId: `energy_meter_${meterId}`,
          bridgeId: entry.id,
          meterId,
          meterKind: 'meter',
        },
        settings: {
          bridgeName: entry.name,
          meterId,
          meterKind: 'meter',
        },
      });
    });

    const loads = Array.isArray(status?.energyLoads) ? status.energyLoads : [];
    loads.forEach((load, index) => {
      const loadId = this.resolveEnergyRecordId(load, `load_${index + 1}`);
      const loadName = this.resolveEnergyRecordName(load, `Energy Load ${index + 1}`);
      const displayName = multiBridge ? `${entry.name} - ${loadName}` : loadName;
      candidates.push({
        name: displayName,
        data: {
          id: this.sanitizePairingId(`${entry.id}_energy_load_${loadId}`),
          deviceId: `energy_load_${loadId}`,
          bridgeId: entry.id,
          meterId: loadId,
          loadId,
          meterKind: 'load',
        },
        settings: {
          bridgeName: entry.name,
          meterId: loadId,
          loadId,
          meterKind: 'load',
        },
      });
    });

    return candidates;
  }

  private resolveMeterId(status: BridgeStatus | null): string {
    const meterId = status?.meterId;
    if (typeof meterId === 'string' && meterId.length > 0) {
      return meterId;
    }
    if (typeof meterId === 'number') {
      return String(meterId);
    }
    return 'main';
  }

  private resolveEnergyRecordId(record: Record<string, unknown>, fallback: string): string {
    const value = record.meterId
      ?? record.energyMeterId
      ?? record.loadId
      ?? record.energyLoadId
      ?? record.id
      ?? record.deviceId
      ?? record.channel
      ?? fallback;
    return String(value || fallback);
  }

  private resolveEnergyRecordName(record: Record<string, unknown>, fallback: string): string {
    const value = record.name
      ?? record.label
      ?? record.displayName
      ?? record.description
      ?? record.loadName
      ?? record.meterName
      ?? fallback;
    return String(value || fallback);
  }

  private sanitizePairingId(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'energy_meter';
  }

  private formatDeviceMetersForPairing(devices: XComfortDevice[]) {
    const seenIds = new Set<string>();

    return devices
      .filter((device) => {
        const deviceId = String(device.deviceId || '');
        const uniqueId = `${this.getItemBridgeId(device) || ''}:${deviceId}`;
        if (!deviceId || seenIds.has(uniqueId)) {
          return false;
        }

        const bridge = this.getBridge(this.getItemBridgeId(device));
        const component = device.compId !== undefined ? bridge.getComponent(String(device.compId)) : undefined;
        if (!this.isDedicatedEnergyDevice(device, component?.compType)) {
          return false;
        }

        seenIds.add(uniqueId);
        return true;
      })
      .map((device) => {
        const bridge = this.getBridge(this.getItemBridgeId(device));
        const component = device.compId !== undefined ? bridge.getComponent(String(device.compId)) : undefined;
        return {
          name: this.getDisplayNameWithBridge(getDisplayName(device, 'Energy Meter'), device),
          data: {
            ...this.getBridgeDeviceData('energy_meter', device),
            meterId: String(device.deviceId),
            ...(device.compId !== undefined ? { componentId: String(device.compId) } : {}),
          },
          settings: getClassificationSettings(device, component),
        };
      });
  }

  private isDedicatedEnergyDevice(device: XComfortDevice, componentType?: number): boolean {
    const compType = Number(device.compType ?? componentType ?? 0);
    if (compType === COMPONENT_TYPES.ENERGY_METER || compType === COMPONENT_TYPES.IMPULSE_INPUT) {
      return true;
    }

    const devType = Number(device.devType ?? 0);
    if (devType === DEVICE_TYPES.ENERGY_METER) {
      return true;
    }

    if (devType === DEVICE_TYPES.SWITCHING_ACTUATOR || devType === DEVICE_TYPES.DIMMING_ACTUATOR) {
      return false;
    }

    const bridge = this.getBridge(this.getItemBridgeId(device));
    const component = device.compId !== undefined ? bridge.getComponent(String(device.compId)) : undefined;
    return isEnergyMeterDevice(device, component);
  }
};
