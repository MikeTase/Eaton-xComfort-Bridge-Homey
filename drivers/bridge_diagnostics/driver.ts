import * as Homey from 'homey';
import { BaseDriver } from '../../lib/BaseDriver';

module.exports = class BridgeDiagnosticsDriver extends BaseDriver {
  private async listUnpairedDevices() {
    const existing = this.getDevices();
    const existingIds = new Set<string>(
      (existing || []).map((device: Homey.Device) => String(device.getData()?.id || ''))
    );

    const candidates = [
      { id: 'bridge_diag_temp', name: 'Bridge Temperature', kind: 'temp' },
      { id: 'bridge_diag_power', name: 'Bridge Power', kind: 'power' },
      { id: 'bridge_diag_heat', name: 'Bridge Heating', kind: 'heat' },
      { id: 'bridge_diag_cool', name: 'Bridge Cooling', kind: 'cool' },
      { id: 'bridge_diag_lights_loads', name: 'Bridge Lights & Loads', kind: 'lights_loads' },
      { id: 'bridge_diag_openings', name: 'Bridge Openings', kind: 'openings' },
      { id: 'bridge_diag_presence', name: 'Bridge Presence', kind: 'presence' },
      { id: 'bridge_diag_remote_access', name: 'Bridge Remote Access', kind: 'remote_access' },
      { id: 'bridge_diag_remote_online', name: 'Bridge Remote Online', kind: 'remote_online' },
    ];

    return this.getBridgeEntries().flatMap((entry) => {
      return candidates
        .map((candidate) => ({
          ...candidate,
          id: `${entry.id}_${candidate.id}`,
          name: this.getBridgeEntries().length > 1 ? `${entry.name} - ${candidate.name}` : candidate.name,
          bridgeId: entry.id,
        }))
        .filter((c) => !existingIds.has(c.id) && !existingIds.has(c.kind ? `bridge_diag_${c.kind}` : c.id))
        .map((c) => ({
          name: c.name,
          data: { id: c.id, kind: c.kind, bridgeId: c.bridgeId },
        }));
    });
  }

  async onPairListDevices() {
    return this.listUnpairedDevices();
  }
};
