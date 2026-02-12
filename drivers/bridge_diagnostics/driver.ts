/// <reference path="../../homey.d.ts" />
import * as Homey from 'homey';
import { BaseDriver } from '../../lib/BaseDriver';

module.exports = class BridgeDiagnosticsDriver extends BaseDriver {
  private async listUnpairedDevices() {
    const existing = this.getDevices();
    const existingIds = new Set<string>(
      (existing || []).map((device: Homey.Device) => String(device.getData()?.id || ''))
    );

    const bridge = this.getBridge();
    // Use bridge just to verify connectivity, though we don't query devices from it here for virtual devices
    // Actually we might want to check if bridge is connected before allowing adding diagnostics
    
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
