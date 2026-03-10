/// <reference path="../../homey.d.ts" />
import { BaseDevice } from '../../lib/BaseDevice';
import type { XComfortBridge } from '../../lib/connection/XComfortBridge';
import { BridgeInfo, BridgeStatus } from '../../lib/types';

module.exports = class BridgeDiagnosticsDevice extends BaseDevice {
  private onBridgeStatus?: (status: BridgeStatus) => void;
  private onBridgeInfo?: (info: BridgeInfo) => void;

  async onDeviceReady() {
    await this.applyCapabilityProfile();

    this.onBridgeStatus = (status: BridgeStatus) => {
      this.updateFromStatus(status);
    };
    this.onBridgeInfo = (info: BridgeInfo) => {
      void this.updateFromInfo(info);
    };

    this.bridge.on('bridge_status', this.onBridgeStatus);
    this.bridge.on('bridge_info', this.onBridgeInfo);

    const lastStatus = this.bridge.getLastBridgeStatus?.();
    if (lastStatus) {
      this.updateFromStatus(lastStatus);
    }

    const lastInfo = this.bridge.getLastBridgeInfo?.();
    if (lastInfo) {
      await this.updateFromInfo(lastInfo);
    }
  }

  private async applyCapabilityProfile() {
    const kind = String(this.getData()?.kind || '');
    const desiredCaps = new Set<string>();
    const options: Array<{ cap: string; opts: Record<string, unknown> }> = [];

    if (kind === 'temp') {
      desiredCaps.add('measure_temperature');
    } else if (kind === 'power') {
      desiredCaps.add('measure_power');
    } else if (kind === 'heat') {
      desiredCaps.add('alarm_heat');
      options.push({ cap: 'alarm_heat', opts: { title: { en: 'Heating Active' } } });
    } else if (kind === 'cool') {
      desiredCaps.add('alarm_generic.cooling');
      options.push({ cap: 'alarm_generic.cooling', opts: { title: { en: 'Cooling Active' } } });
    } else if (kind === 'lights_loads') {
      desiredCaps.add('onoff');
      desiredCaps.add('alarm_generic');
      options.push({ cap: 'onoff', opts: { title: { en: 'Lights On' } } });
      options.push({ cap: 'alarm_generic', opts: { title: { en: 'Active Loads' } } });
    } else if (kind === 'openings') {
      desiredCaps.add('alarm_contact.windows');
      desiredCaps.add('alarm_contact.doors');
      options.push({ cap: 'alarm_contact.windows', opts: { title: { en: 'Open Windows' } } });
      options.push({ cap: 'alarm_contact.doors', opts: { title: { en: 'Open Doors' } } });
    } else if (kind === 'presence') {
      desiredCaps.add('alarm_motion');
      options.push({ cap: 'alarm_motion', opts: { title: { en: 'Presence Detected' } } });
    }

    const current = new Set(this.getCapabilities());

    for (const cap of current) {
      if (!desiredCaps.has(cap)) {
        await this.removeCapability(cap).catch(() => {});
      }
    }
    for (const cap of desiredCaps) {
      if (!current.has(cap)) {
        await this.addCapability(cap).catch(() => {});
      }
    }

    for (const { cap, opts } of options) {
      if (this.hasCapability(cap)) {
        await this.setCapabilityOptions(cap, opts).catch(() => {});
      }
    }
  }

  private updateFromStatus(status: BridgeStatus) {
    const toBool = (value?: number) => (value !== undefined ? value > 0 : undefined);

    if (typeof status.tempOutside === 'number' && this.hasCapability('measure_temperature')) {
      this.setCapabilityValue('measure_temperature', status.tempOutside).catch(this.error);
    }
    if (typeof status.power === 'number' && this.hasCapability('measure_power')) {
      this.setCapabilityValue('measure_power', status.power).catch(this.error);
    }

    const heatingOn = toBool(status.heatingOn);
    if (heatingOn !== undefined && this.hasCapability('alarm_heat')) {
      this.setCapabilityValue('alarm_heat', heatingOn).catch(this.error);
    }

    const coolingOn = toBool(status.coolingOn);
    if (coolingOn !== undefined && this.hasCapability('alarm_generic.cooling')) {
      this.setCapabilityValue('alarm_generic.cooling', coolingOn).catch(this.error);
    }

    const lightsOn = toBool(status.lightsOn);
    if (lightsOn !== undefined && this.hasCapability('onoff')) {
      this.setCapabilityValue('onoff', lightsOn).catch(this.error);
    }

    const loadsOn = toBool(status.loadsOn);
    if (loadsOn !== undefined && this.hasCapability('alarm_generic')) {
      this.setCapabilityValue('alarm_generic', loadsOn).catch(this.error);
    }

    const windowsOpen = toBool(status.windowsOpen);
    if (windowsOpen !== undefined && this.hasCapability('alarm_contact.windows')) {
      this.setCapabilityValue('alarm_contact.windows', windowsOpen).catch(this.error);
    }

    const doorsOpen = toBool(status.doorsOpen);
    if (doorsOpen !== undefined && this.hasCapability('alarm_contact.doors')) {
      this.setCapabilityValue('alarm_contact.doors', doorsOpen).catch(this.error);
    }

    const presence = toBool(status.presence);
    if (presence !== undefined && this.hasCapability('alarm_motion')) {
      this.setCapabilityValue('alarm_motion', presence).catch(this.error);
    }
  }

  private async updateFromInfo(info: BridgeInfo): Promise<void> {
    const nextSettings = {
      bridge_name: info.name || '-',
      bridge_id: info.id || '-',
      bridge_model: info.bridgeModel || '-',
      bridge_firmware: info.firmwareVersion || '-',
      bridge_ip: info.ipAddress || '-',
      bridge_scenes: typeof info.homeScenesCount === 'number' ? String(info.homeScenesCount) : '-',
    };

    const currentSettings = this.getSettings() as Record<string, unknown>;
    const hasChanges = Object.entries(nextSettings).some(([key, value]) => currentSettings[key] !== value);
    if (!hasChanges) {
      return;
    }

    await this.setSettings(nextSettings).catch(this.error);
  }

  onDeleted() {
    if (this.bridge && this.onBridgeStatus) {
      this.bridge.removeListener('bridge_status', this.onBridgeStatus);
    }
    if (this.bridge && this.onBridgeInfo) {
      this.bridge.removeListener('bridge_info', this.onBridgeInfo);
    }
    super.onDeleted();
  }

  protected onBridgeChanged(newBridge: XComfortBridge, oldBridge: XComfortBridge): void {
    if (this.onBridgeStatus) {
      oldBridge.removeListener('bridge_status', this.onBridgeStatus);
      newBridge.on('bridge_status', this.onBridgeStatus);
    }
    if (this.onBridgeInfo) {
      oldBridge.removeListener('bridge_info', this.onBridgeInfo);
      newBridge.on('bridge_info', this.onBridgeInfo);
    }
    const lastStatus = newBridge.getLastBridgeStatus?.();
    if (lastStatus) {
      this.updateFromStatus(lastStatus);
    }
    const lastInfo = newBridge.getLastBridgeInfo?.();
    if (lastInfo) {
      void this.updateFromInfo(lastInfo);
    }
  }
};
