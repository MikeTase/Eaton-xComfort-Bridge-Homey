/// <reference path="../../homey.d.ts" />
import * as Homey from 'homey';
import { XComfortBridge } from '../../lib/connection/XComfortBridge';
import { BridgeStatus } from '../../lib/types';

interface XComfortApp extends Homey.App {
  bridge: XComfortBridge | null;
}

module.exports = class BridgeDiagnosticsDevice extends Homey.Device {
  private bridge: XComfortBridge | null = null;
  private onBridgeStatus?: (status: BridgeStatus) => void;

  async onInit() {
    this.log('BridgeDiagnosticsDevice init:', this.getName());

    this.bridge = (this.homey.app as XComfortApp).bridge;
    if (!this.bridge) {
      this.setUnavailable('Bridge not connected');
      return;
    }

    this.setAvailable();

    await this.applyCapabilityProfile();

    this.onBridgeStatus = (status: BridgeStatus) => {
      this.updateFromStatus(status);
    };

    this.bridge.on('bridge_status', this.onBridgeStatus);

    const last = this.bridge.getLastBridgeStatus?.();
    if (last) {
      this.updateFromStatus(last);
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
    if (coolingOn !== undefined && this.hasCapability('alarm_cooling')) {
      this.setCapabilityValue('alarm_cooling', coolingOn).catch(this.error);
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

  onDeleted() {
    if (this.bridge && this.onBridgeStatus) {
      this.bridge.removeListener('bridge_status', this.onBridgeStatus);
    }
  }
};
