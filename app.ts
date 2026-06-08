import * as Homey from 'homey';
import { XComfortBridge } from './lib/connection/XComfortBridge';

export interface XComfortBridgeConfig {
  id: string;
  name: string;
  ip: string;
  authKey: string;
}

export interface XComfortBridgeEntry {
  id: string;
  name: string;
  bridge: XComfortBridge;
}

class XComfortApp extends Homey.App {
  public bridge: XComfortBridge | null = null;
  public bridges: Map<string, XComfortBridge> = new Map();
  private bridgeConfigs: XComfortBridgeConfig[] = [];
  private defaultBridgeId: string | null = null;
  private initToken = 0;
  private settingsDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  async onInit() {
    (this as unknown as { setMaxListeners(n: number): void }).setMaxListeners(300);
    this.log('Eaton xComfort App has been initialized');

    await this.initBridgesFromSettings();
    this.registerFlowActions();

    this.homey.settings.on('set', (key: string) => {
      if (key === 'bridges' || key === 'bridge_ip' || key === 'bridge_auth_key') {
        if (this.settingsDebounceTimer) clearTimeout(this.settingsDebounceTimer);
        this.settingsDebounceTimer = setTimeout(async () => {
          this.settingsDebounceTimer = null;
          await this.initBridgesFromSettings();
        }, 500);
      }
    });
  }

  /**
   * Register app-level Flow actions that span multiple drivers/bridges:
   * - reset_energy_meter: zero the meter_power of any energy-tracking device.
   * - activate_scene_by_name: activate any bridge scene via autocomplete,
   *   without needing a paired scene device.
   * - switch_room_lights_by_name: switch xComfort room/zone lights with a
   *   single bridge ROOM_SWITCH command, avoiding Homey all-lights bursts.
   */
  private registerFlowActions(): void {
    const resetCard = this.homey.flow.getActionCard('reset_energy_meter');
    resetCard?.registerRunListener(async (args: { device?: { resetEnergyMeter?: () => Promise<void> } }) => {
      const device = args.device;
      if (!device || typeof device.resetEnergyMeter !== 'function') {
        throw new Error('This device has no resettable energy meter');
      }
      await device.resetEnergyMeter();
      return true;
    });

    // `registerArgumentAutocompleteListener` exists at runtime but is missing
    // from this SDK version's FlowCardAction typings — cast structurally.
    type SceneAutocompleteResult = { name: string; description?: string; id: string; bridgeId: string };
    const sceneCard = this.homey.flow.getActionCard('activate_scene_by_name') as unknown as {
      registerArgumentAutocompleteListener(
        name: string,
        listener: (query: string) => Promise<SceneAutocompleteResult[]>,
      ): void;
      registerRunListener(
        listener: (args: { scene?: { id?: string; bridgeId?: string } }) => Promise<boolean>,
      ): void;
    } | null;
    sceneCard?.registerArgumentAutocompleteListener('scene', async (query: string) => {
      const entries = this.getBridgeEntries();
      const multiBridge = entries.length > 1;
      const results: Array<{ name: string; description?: string; id: string; bridgeId: string }> = [];

      for (const entry of entries) {
        for (const scene of entry.bridge.getScenes()) {
          if (scene.show === false) {
            continue;
          }
          const sceneName = scene.name || `Scene ${scene.sceneId}`;
          results.push({
            name: multiBridge ? `${entry.name} - ${sceneName}` : sceneName,
            id: String(scene.sceneId),
            bridgeId: entry.id,
          });
        }
      }

      const needle = query.trim().toLowerCase();
      const filtered = needle
        ? results.filter((result) => result.name.toLowerCase().includes(needle))
        : results;
      return filtered.sort((left, right) => left.name.localeCompare(right.name));
    });
    sceneCard?.registerRunListener(async (args: { scene?: { id?: string; bridgeId?: string } }) => {
      const selected = args.scene;
      if (!selected || !selected.id) {
        throw new Error('No scene selected');
      }
      const bridge = this.getBridge(selected.bridgeId || null);
      if (!bridge) {
        throw new Error('Bridge not connected');
      }
      await bridge.activateScene(selected.id);
      return true;
    });

    type RoomAutocompleteResult = { name: string; description?: string; id: string; bridgeId: string };
    const roomCard = this.homey.flow.getActionCard('switch_room_lights_by_name') as unknown as {
      registerArgumentAutocompleteListener(
        name: string,
        listener: (query: string) => Promise<RoomAutocompleteResult[]>,
      ): void;
      registerRunListener(
        listener: (args: { room?: { id?: string; bridgeId?: string }; state?: 'on' | 'off' }) => Promise<boolean>,
      ): void;
    } | null;
    roomCard?.registerArgumentAutocompleteListener('room', async (query: string) => {
      const entries = this.getBridgeEntries();
      const multiBridge = entries.length > 1;
      const results: RoomAutocompleteResult[] = [];

      for (const entry of entries) {
        for (const room of entry.bridge.getRooms()) {
          const roomName = room.name || `Room ${room.roomId}`;
          results.push({
            name: multiBridge ? `${entry.name} - ${roomName}` : roomName,
            id: String(room.roomId),
            bridgeId: entry.id,
          });
        }
      }

      const needle = query.trim().toLowerCase();
      const filtered = needle
        ? results.filter((result) => result.name.toLowerCase().includes(needle))
        : results;
      return filtered.sort((left, right) => left.name.localeCompare(right.name));
    });
    roomCard?.registerRunListener(async (args: { room?: { id?: string; bridgeId?: string }; state?: 'on' | 'off' }) => {
      const selected = args.room;
      if (!selected || !selected.id) {
        throw new Error('No room selected');
      }
      const bridge = this.getBridge(selected.bridgeId || null);
      if (!bridge) {
        throw new Error('Bridge not connected');
      }
      await bridge.switchRoom(selected.id, args.state === 'on');
      return true;
    });
  }

  getBridge(bridgeId?: string | null): XComfortBridge | null {
    const id = bridgeId || this.defaultBridgeId;
    if (id && this.bridges.has(id)) {
      return this.bridges.get(id) || null;
    }

    return this.bridge;
  }

  getBridgeEntries(): XComfortBridgeEntry[] {
    return this.bridgeConfigs
      .map((config) => {
        const bridge = this.bridges.get(config.id);
        return bridge ? { id: config.id, name: config.name, bridge } : null;
      })
      .filter((entry): entry is XComfortBridgeEntry => entry !== null);
  }

  getDefaultBridgeId(): string | null {
    return this.defaultBridgeId;
  }

  private async initBridgesFromSettings(): Promise<void> {
    const token = ++this.initToken;
    const configs = this.loadBridgeConfigs();

    this.resetBridges(configs.length ? undefined : 'Bridge configuration missing in Settings.');

    this.bridgeConfigs = configs;
    this.defaultBridgeId = configs[0]?.id || null;

    if (!configs.length) {
      return;
    }

    await Promise.allSettled(configs.map((config) => this.initBridge(config, token)));
  }

  private async initBridge(config: XComfortBridgeConfig, token: number): Promise<void> {
    if (token !== this.initToken) {
      return;
    }

    const cleanIp = config.ip.trim();
    const cleanKey = config.authKey.replace(/[\s-]+/g, '');
    const name = config.name || cleanIp;

    this.log(`Initializing Bridge "${name}" at '${cleanIp}'...`);

    const bridge = new XComfortBridge(cleanIp, cleanKey, (...args) => this.log(`[${name}]`, ...args));
    this.bridges.set(config.id, bridge);
    if (config.id === this.defaultBridgeId) {
      this.bridge = bridge;
    }

    this.emit('bridge_changed', config.id, bridge);

    bridge.on('connected', () => this.log(`Bridge "${name}": Connected`));
    bridge.on('disconnected', () => this.log(`Bridge "${name}": Disconnected`));
    bridge.on('reconnecting', () => this.log(`Bridge "${name}": Reconnecting...`));

    try {
      await bridge.init();
      if (token === this.initToken) {
        this.log(`Bridge "${name}": Initialization started`);
      }
    } catch (err) {
      if (token === this.initToken) {
        this.error(`Bridge "${name}": Initialization failed`, err);
      }
    }
  }

  private resetBridges(reason?: string): void {
    if (reason) {
      this.log(reason);
    }

    for (const [bridgeId, bridge] of this.bridges.entries()) {
      bridge.disconnect();
      bridge.removeAllListeners();
      this.emit('bridge_changed', bridgeId, null);
    }

    this.bridges.clear();
    this.bridge = null;
  }

  private loadBridgeConfigs(): XComfortBridgeConfig[] {
    const rawBridges = this.homey.settings.get('bridges');
    const parsed = this.normalizeBridgeConfigs(rawBridges);
    if (parsed.length > 0) {
      return parsed;
    }

    const ip = this.homey.settings.get('bridge_ip');
    const authKey = this.homey.settings.get('bridge_auth_key');
    if (!ip || !authKey) {
      return [];
    }

    return [{
      id: 'default',
      name: 'xComfort Bridge',
      ip: String(ip).trim(),
      authKey: String(authKey).replace(/[\s-]+/g, ''),
    }];
  }

  private normalizeBridgeConfigs(value: unknown): XComfortBridgeConfig[] {
    const raw = typeof value === 'string' ? this.parseBridgeJson(value) : value;
    if (!Array.isArray(raw)) {
      return [];
    }

    const seen = new Set<string>();
    return raw
      .map((entry, index) => this.normalizeBridgeConfig(entry, index))
      .filter((entry): entry is XComfortBridgeConfig => entry !== null)
      .map((entry) => {
        let id = entry.id;
        let suffix = 2;
        while (seen.has(id)) {
          id = `${entry.id}_${suffix++}`;
        }
        seen.add(id);
        return { ...entry, id };
      });
  }

  private normalizeBridgeConfig(entry: unknown, index: number): XComfortBridgeConfig | null {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return null;
    }

    const record = entry as Record<string, unknown>;
    const ip = String(record.ip || '').trim();
    const authKey = String(record.authKey || record.auth_key || '').replace(/[\s-]+/g, '');
    if (!ip || !authKey) {
      return null;
    }

    const name = String(record.name || `xComfort Bridge ${index + 1}`).trim();
    const rawId = String(record.id || '').trim();
    const id = rawId || this.makeBridgeId(name || ip, index);

    return {
      id: this.sanitizeBridgeId(id),
      name: name || ip,
      ip,
      authKey,
    };
  }

  private parseBridgeJson(value: string): unknown {
    try {
      return JSON.parse(value);
    } catch {
      return [];
    }
  }

  private makeBridgeId(value: string, index: number): string {
    return this.sanitizeBridgeId(`${value}_${index + 1}`);
  }

  private sanitizeBridgeId(value: string): string {
    const sanitized = value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return sanitized || 'bridge';
  }
}

module.exports = XComfortApp;
