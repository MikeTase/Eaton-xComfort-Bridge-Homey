/// <reference path="../../homey.d.ts" />
import * as Homey from 'homey';
import { XComfortBridge } from '../../lib/connection/XComfortBridge';

interface XComfortApp extends Homey.App {
  bridge: XComfortBridge | null;
}

module.exports = class BridgeDiagnosticsDriver extends Homey.Driver {
  private async listUnpairedDevices() {
    const existing = this.getDevices();
    const existingIds = new Set<string>(
      (existing || []).map((device: Homey.Device) => String(device.getData()?.id || ''))
    );

    const app = this.homey.app as XComfortApp;
    const bridge = app.bridge;
    if (!bridge) {
      throw new Error('Bridge not connected. Please configure settings first.');
    }

    const candidates = [
      { id: 'bridge_diag_temp', name: 'Bridge Temperature', kind: 'temp' },
      { id: 'bridge_diag_power', name: 'Bridge Power', kind: 'power' },
      { id: 'bridge_diag_heat', name: 'Bridge Heating', kind: 'heat' },
      { id: 'bridge_diag_cool', name: 'Bridge Cooling', kind: 'cool' },
      { id: 'bridge_diag_lights_loads', name: 'Bridge Lights & Loads', kind: 'lights_loads' },
      { id: 'bridge_diag_openings', name: 'Bridge Openings', kind: 'openings' },
      { id: 'bridge_diag_presence', name: 'Bridge Presence', kind: 'presence' },
    ];

    return candidates
      .filter((c) => !existingIds.has(c.id))
      .map((c) => ({
        name: c.name,
        data: { id: c.id, kind: c.kind },
      }));
  }

  async onPairListDevices() {
    return this.listUnpairedDevices();
  }
};
