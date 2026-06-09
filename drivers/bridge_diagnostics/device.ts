import { BaseDevice } from '../../lib/BaseDevice';
import type { XComfortBridge } from '../../lib/connection/XComfortBridge';
import { BridgeInfo, BridgeStatus } from '../../lib/types';
import { EnergyTracker } from '../../lib/utils/EnergyTracker';

module.exports = class BridgeDiagnosticsDevice extends BaseDevice {
  private onBridgeStatus?: (status: BridgeStatus) => void;
  private onBridgeInfo?: (info: BridgeInfo) => void;
  private energy = new EnergyTracker(async (kwh) => {
    if (!this.isPowerDiagnostic()) {
      return;
    }
    await this.ensureCapability('meter_power');
    await this.updateCapability('meter_power', kwh);
    await this.setStoreValue('bridgeMeterPowerKwh', kwh).catch(this.error);
  });

  async onDeviceReady() {
    await this.applyCapabilityProfile();
    await this.restoreEnergyState();

    this.onBridgeStatus = (status: BridgeStatus) => {
      void this.updateFromStatus(status);
    };
    this.onBridgeInfo = (info: BridgeInfo) => {
      void this.updateFromInfo(info);
    };

    this.bridge.on('bridge_status', this.onBridgeStatus);
    this.bridge.on('bridge_info', this.onBridgeInfo);

    const lastStatus = this.bridge.getLastBridgeStatus?.();
    if (lastStatus) {
      await this.updateFromStatus(lastStatus);
    }

    const lastInfo = this.bridge.getLastBridgeInfo?.();
    if (lastInfo) {
      await this.updateFromInfo(lastInfo);
    }

    if (this.isRemoteAccessDiagnostic()) {
      this.registerCapabilityListener('onoff', async (value) => {
        if (!this.bridge) {
          throw new Error('Bridge offline');
        }

        await this.bridge.setRemoteAccess(Boolean(value));
      });
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
      desiredCaps.add('meter_power');
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
    } else if (kind === 'remote_access') {
      desiredCaps.add('onoff');
      options.push({ cap: 'onoff', opts: { title: { en: 'Remote Access Allowed' } } });
    } else if (kind === 'remote_online') {
      desiredCaps.add('alarm_generic');
      options.push({ cap: 'alarm_generic', opts: { title: { en: 'Remote Access Online' } } });
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

  private async restoreEnergyState(): Promise<void> {
    if (!this.isPowerDiagnostic()) {
      return;
    }

    await this.ensureCapability('meter_power');
    const storedValue = this.getStoreValue('bridgeMeterPowerKwh');
    if (typeof storedValue === 'number' && Number.isFinite(storedValue) && storedValue > 0) {
      this.energy.restore(storedValue);
    }
    await this.updateCapability('meter_power', this.energy.getKwh());
  }

  private async updateFromStatus(status: BridgeStatus): Promise<void> {
    const toBool = (value?: number) => (value !== undefined ? value > 0 : undefined);

    if (typeof status.tempOutside === 'number' && this.hasCapability('measure_temperature')) {
      this.setCapabilityValue('measure_temperature', status.tempOutside).catch(this.error);
    }
    if (typeof status.power === 'number' && this.hasCapability('measure_power')) {
      await this.setCapabilityValue('measure_power', status.power).catch(this.error);
      await this.energy.applyPower(status.power);
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
    if (typeof info.remoteAllowed === 'boolean' && this.isRemoteAccessDiagnostic() && this.hasCapability('onoff')) {
      await this.setCapabilityValue('onoff', info.remoteAllowed).catch(this.error);
    }

    if (typeof info.remoteOnline === 'boolean' && this.isRemoteOnlineDiagnostic() && this.hasCapability('alarm_generic')) {
      await this.setCapabilityValue('alarm_generic', info.remoteOnline).catch(this.error);
    }

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

  async onDeleted(): Promise<void> {
    if (this.isPowerDiagnostic()) {
      await this.energy.flush();
    }
    if (this.bridge && this.onBridgeStatus) {
      this.bridge.removeListener('bridge_status', this.onBridgeStatus);
    }
    if (this.bridge && this.onBridgeInfo) {
      this.bridge.removeListener('bridge_info', this.onBridgeInfo);
    }
    super.onDeleted();
  }

  async onUninit(): Promise<void> {
    if (this.isPowerDiagnostic()) {
      await this.energy.flush();
    }
    if (this.bridge && this.onBridgeStatus) {
      this.bridge.removeListener('bridge_status', this.onBridgeStatus);
    }
    if (this.bridge && this.onBridgeInfo) {
      this.bridge.removeListener('bridge_info', this.onBridgeInfo);
    }
    await super.onUninit();
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
      void this.updateFromStatus(lastStatus);
    }
    const lastInfo = newBridge.getLastBridgeInfo?.();
    if (lastInfo) {
      void this.updateFromInfo(lastInfo);
    }
  }

  private isPowerDiagnostic(): boolean {
    return String(this.getData()?.kind || '') === 'power';
  }

  private isRemoteAccessDiagnostic(): boolean {
    return String(this.getData()?.kind || '') === 'remote_access';
  }

  private isRemoteOnlineDiagnostic(): boolean {
    return String(this.getData()?.kind || '') === 'remote_online';
  }

  private async ensureCapability(capabilityId: string): Promise<void> {
    if (!this.hasCapability(capabilityId)) {
      await this.addCapability(capabilityId).catch(this.error);
    }
  }
};
