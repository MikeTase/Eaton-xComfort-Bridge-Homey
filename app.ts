import * as Homey from 'homey';
import { createHash } from 'crypto';
import appManifest from './app.json';
import { XComfortBridge } from './lib/connection/XComfortBridge';
import type { XComfortAuthMode } from './lib/types';
import {
  normalizeChoiceIdArgument,
  normalizeOnOffArgument,
  normalizePercentageArgument,
  normalizeRemoteAccessPreference as normalizeRemoteAccessFlowPreference,
} from './lib/utils/flowArguments';

export interface XComfortBridgeConfig {
  id: string;
  name: string;
  ip: string;
  authKey: string;
  authMode?: XComfortAuthMode;
  username?: string;
  remoteAccess?: boolean;
}

export interface XComfortBridgeEntry {
  id: string;
  name: string;
  bridge: XComfortBridge;
}

type AstroPeriod = 'dark' | 'daylight' | 'after_sunset' | 'before_sunrise';

type AutocompleteResult = { name: string; description?: string; id: string; bridgeId?: string };

/**
 * Structural view of a Flow card with autocomplete support.
 * `registerArgumentAutocompleteListener` exists at runtime but is missing
 * from this SDK version's typings, so cards are cast to this shape.
 */
interface AutocompleteFlowCard<Args> {
  registerArgumentAutocompleteListener(
    name: string,
    listener: (query: string) => Promise<AutocompleteResult[]>,
  ): void;
  registerRunListener(listener: (args: Args) => Promise<boolean>): void;
}

class XComfortApp extends Homey.App {
  public bridge: XComfortBridge | null = null;
  public bridges: Map<string, XComfortBridge> = new Map();
  private bridgeConfigs: XComfortBridgeConfig[] = [];
  private defaultBridgeId: string | null = null;
  private initToken = 0;
  private settingsDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  // Last connectivity state announced via Flow triggers, per bridge id.
  // Prevents repeated 'disconnected' triggers during failing reconnect cycles.
  private bridgeConnectivityAnnounced: Map<string, boolean> = new Map();
  // Stable per-Homey client_id sent to the bridge (derived once, cached).
  private bridgeClientId: string | null = null;

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
   * Called when the app is shutting down (update/restart). Stop timers and
   * disconnect bridges so sockets, heartbeats, and watchdogs are released
   * cleanly. Devices flush their own state in their onUninit hooks.
   */
  async onUninit(): Promise<void> {
    if (this.settingsDebounceTimer) {
      clearTimeout(this.settingsDebounceTimer);
      this.settingsDebounceTimer = null;
    }
    this.resetBridges('App shutting down — disconnecting bridges.');
  }

  /**
   * Register app-level Flow actions that span multiple drivers/bridges:
   * - reset_energy_meter: zero the meter_power of any energy-tracking device.
   * - activate_scene_by_name: activate any bridge scene via autocomplete,
   *   without needing a paired scene device.
   * - switch_room_lights_by_name: switch xComfort room/zone lights with a
   *   single bridge ROOM_SWITCH command, avoiding Homey all-lights bursts.
   * - set_bridge_remote_access: enable/disable Eaton remote access without
   *   exposing the hidden diagnostics driver in Homey pairing.
   * - xcomfort_astro_is: simple sunrise/sunset helper condition for xComfort
   *   scene and room Flow automations.
   */
  private registerFlowActions(): void {
    const astroCondition = this.homey.flow.getConditionCard('xcomfort_astro_is');
    astroCondition?.registerRunListener(async (args: { period?: unknown }) => {
      const period = this.normalizeAstroPeriodArgument(args.period);
      if (!period) {
        throw new Error('No astro period selected');
      }

      return this.isAstroPeriod(period, new Date());
    });

    const resetCard = this.homey.flow.getActionCard('reset_energy_meter');
    resetCard?.registerRunListener(async (args: { device?: { resetEnergyMeter?: () => Promise<void> } }) => {
      const device = args.device;
      if (!device || typeof device.resetEnergyMeter !== 'function') {
        throw new Error('This device has no resettable energy meter');
      }
      await device.resetEnergyMeter();
      return true;
    });

    const setEnergyLoadModeCard = this.homey.flow.getActionCard('set_energy_load_mode');
    setEnergyLoadModeCard?.registerRunListener(async (
      args: { device?: { setLoadModeAction?: (mode: string) => Promise<void> }; mode?: unknown },
    ) => {
      const device = args.device;
      const mode = this.normalizeLoadModeArgument(args.mode);
      if (!mode) {
        throw new Error('No energy load mode selected');
      }
      if (!device || typeof device.setLoadModeAction !== 'function') {
        throw new Error('This device does not support xComfort energy load mode control');
      }
      await device.setLoadModeAction(mode);
      return true;
    });

    const refreshEnergyCard = this.homey.flow.getActionCard('refresh_energy_meter');
    refreshEnergyCard?.registerRunListener(async (
      args: { device?: { refreshEnergyData?: () => Promise<void> } },
    ) => {
      const device = args.device;
      if (!device || typeof device.refreshEnergyData !== 'function') {
        throw new Error('This device does not support energy refresh');
      }
      await device.refreshEnergyData();
      return true;
    });

    const sceneCard = this.homey.flow.getActionCard('activate_scene_by_name') as unknown as
      AutocompleteFlowCard<{ scene?: { id?: string; bridgeId?: string } }> | null;
    sceneCard?.registerArgumentAutocompleteListener('scene', async (query: string) => {
      const entries = this.getBridgeEntries();
      const multiBridge = entries.length > 1;
      const results: AutocompleteResult[] = [];

      for (const entry of entries) {
        for (const scene of entry.bridge.getScenes()) {
          if (scene.show === false) {
            continue;
          }
          const sceneName = scene.name || `Scene ${scene.sceneId}`;
          const description = this.formatSceneDescription(scene);
          results.push({
            name: multiBridge ? `${entry.name} - ${sceneName}` : sceneName,
            ...(description ? { description } : {}),
            id: String(scene.sceneId),
            bridgeId: entry.id,
          });
        }
      }

      return this.filterAndSortByName(results, query);
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

    const roomCard = this.homey.flow.getActionCard('switch_room_lights_by_name') as unknown as
      AutocompleteFlowCard<{ room?: { id?: string; bridgeId?: string }; state?: unknown }> | null;
    roomCard?.registerArgumentAutocompleteListener('room', async (query: string) => {
      return this.getRoomAutocompleteResults(query);
    });
    roomCard?.registerRunListener(async (args: { room?: { id?: string; bridgeId?: string }; state?: unknown }) => {
      const selected = args.room;
      if (!selected || !selected.id) {
        throw new Error('No room selected');
      }
      const switchState = normalizeOnOffArgument(args.state);
      if (switchState === undefined) {
        throw new Error('No room light state selected');
      }
      const bridge = this.getBridge(selected.bridgeId || null);
      if (!bridge) {
        throw new Error('Bridge not connected');
      }
      await bridge.switchRoom(selected.id, switchState);
      return true;
    });

    const dimRoomCard = this.homey.flow.getActionCard('dim_room_lights_by_name') as unknown as
      AutocompleteFlowCard<{ room?: { id?: string; bridgeId?: string }; level?: unknown }> | null;
    dimRoomCard?.registerArgumentAutocompleteListener('room', async (query: string) => {
      return this.getRoomAutocompleteResults(query);
    });
    dimRoomCard?.registerRunListener(async (args: { room?: { id?: string; bridgeId?: string }; level?: unknown }) => {
      const selected = args.room;
      if (!selected || !selected.id) {
        throw new Error('No room selected');
      }
      const level = normalizePercentageArgument(args.level);
      if (level === null) {
        throw new Error('No dim level selected');
      }
      const bridge = this.getBridge(selected.bridgeId || null);
      if (!bridge) {
        throw new Error('Bridge not connected');
      }
      await bridge.dimRoom(selected.id, level);
      return true;
    });

    const bridgeConnectedCondition = this.homey.flow.getConditionCard('bridge_is_connected') as unknown as
      AutocompleteFlowCard<{ bridge?: { id?: string } }> | null;
    bridgeConnectedCondition?.registerArgumentAutocompleteListener('bridge', async (query: string) => {
      return this.getBridgeAutocompleteResults(query);
    });
    bridgeConnectedCondition?.registerRunListener(async (args: { bridge?: { id?: string } }) => {
      const bridge = this.getBridge(args.bridge?.id || null);
      return !!(bridge && bridge.isConnected);
    });

    const remoteAccessCard = this.homey.flow.getActionCard('set_bridge_remote_access') as unknown as
      AutocompleteFlowCard<{ bridge?: { id?: string }; state?: unknown }> | null;
    remoteAccessCard?.registerArgumentAutocompleteListener('bridge', async (query: string) => {
      return this.getBridgeAutocompleteResults(query);
    });
    remoteAccessCard?.registerRunListener(async (args: { bridge?: { id?: string }; state?: unknown }) => {
      const allowed = this.normalizeRemoteAccessPreference(args.state);
      if (allowed === undefined) {
        throw new Error('No remote access state selected');
      }

      const bridge = this.getBridge(args.bridge?.id || null);
      if (!bridge) {
        throw new Error('Bridge not connected');
      }

      await bridge.setRemoteAccess(allowed);
      return true;
    });
  }

  private async getRoomAutocompleteResults(query: string): Promise<AutocompleteResult[]> {
    const entries = this.getBridgeEntries();
    const multiBridge = entries.length > 1;
    const results: AutocompleteResult[] = [];

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

    return this.filterAndSortByName(results, query);
  }

  private getBridgeAutocompleteResults(query: string): AutocompleteResult[] {
    return this.filterAndSortByName(
      this.getBridgeEntries().map((entry) => ({
        id: entry.id,
        name: entry.name,
        description: entry.bridge.isConnected ? 'Connected' : 'Connecting',
      })),
      query,
    );
  }

  /** Case-insensitive substring filter on `name`, then alphabetical sort. */
  private filterAndSortByName<T extends { name: string }>(results: T[], query: string): T[] {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? results.filter((result) => result.name.toLowerCase().includes(needle))
      : results;
    return filtered.sort((left, right) => left.name.localeCompare(right.name));
  }

  /**
   * Fire the bridge connected/disconnected Flow triggers on actual state
   * transitions only, so repeated failed reconnect attempts don't spam Flows.
   */
  private announceBridgeConnectivity(bridgeId: string, bridgeName: string, connected: boolean): void {
    if (this.bridgeConnectivityAnnounced.get(bridgeId) === connected) {
      return;
    }
    this.bridgeConnectivityAnnounced.set(bridgeId, connected);

    const card = this.homey.flow.getTriggerCard(connected ? 'bridge_connected' : 'bridge_disconnected');
    card?.trigger({ bridge: bridgeName, bridge_id: bridgeId }).catch((err) => {
      this.error(`Failed to trigger bridge_${connected ? 'connected' : 'disconnected'}`, err);
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

  /**
   * Lightweight per-bridge status summary for the dashboard widget.
   */
  getBridgeStatusSummary(): Array<Record<string, unknown>> {
    return this.bridgeConfigs.map((config) => {
      const bridge = this.bridges.get(config.id);
      return {
        id: config.id,
        name: config.name,
        connected: !!(bridge && bridge.isConnected),
        devices: bridge ? bridge.getDevices().length : 0,
        rooms: bridge ? bridge.getRooms().length : 0,
        scenes: bridge ? bridge.getScenes().length : 0,
      };
    });
  }

  /**
   * Update the stored IP address and/or auth key of a configured bridge
   * (used by the device repair flow). Writing the settings key triggers
   * the existing settings listener, which reinitializes the bridges.
   */
  async updateBridgeConfig(bridgeId: string | null, ip: string, authKey: string): Promise<void> {
    const trimmedIp = ip.trim();
    const cleanedKey = authKey.replace(/[\s-]+/g, '');

    if (!trimmedIp || !cleanedKey) {
      throw new Error('Both the bridge IP address and the authentication key are required.');
    }

    const targetId = bridgeId || this.defaultBridgeId;
    const configs = this.loadBridgeConfigs();

    if (!configs.length) {
      // No configuration yet — create one via the legacy keys.
      this.homey.settings.set('bridge_ip', trimmedIp);
      this.homey.settings.set('bridge_auth_key', cleanedKey);
      return;
    }

    const updated = configs.map((config) => {
      if (targetId && config.id !== targetId) {
        return config;
      }
      return { ...config, ip: trimmedIp, authKey: cleanedKey };
    });

    this.homey.settings.set('bridges', updated);
  }

  /**
   * Wait until the given bridge reports a connection, or time out.
   * Used by the repair flow to verify new credentials.
   */
  async waitForBridgeConnection(bridgeId: string | null, timeoutMs = 20000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const bridge = this.getBridge(bridgeId);
      if (bridge && bridge.isConnected) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return false;
  }

  private normalizeLoadModeArgument(value: unknown): string | null {
    return normalizeChoiceIdArgument(value);
  }

  private normalizeAstroPeriodArgument(value: unknown): AstroPeriod | null {
    const rawValue = normalizeChoiceIdArgument(value);
    if (!rawValue) {
      return null;
    }

    const normalized = rawValue.toLowerCase().replace(/[\s-]+/g, '_');
    if (
      normalized === 'dark'
      || normalized === 'daylight'
      || normalized === 'after_sunset'
      || normalized === 'before_sunrise'
    ) {
      return normalized;
    }

    return null;
  }

  private async isAstroPeriod(period: AstroPeriod, now: Date): Promise<boolean> {
    const location = await this.getHomeyLocation();
    if (!location) {
      throw new Error('Homey location is unavailable; configure Homey location to use xComfort astro helpers');
    }

    const { sunrise, sunset } = this.calculateSunTimes(now, location.latitude, location.longitude);
    const isAfterSunset = now >= sunset;
    const isBeforeSunrise = now < sunrise;
    const isDark = isAfterSunset || isBeforeSunrise;

    switch (period) {
      case 'dark':
        return isDark;
      case 'daylight':
        return !isDark;
      case 'after_sunset':
        return isAfterSunset;
      case 'before_sunrise':
        return isBeforeSunrise;
      default:
        return false;
    }
  }

  private async getHomeyLocation(): Promise<{ latitude: number; longitude: number } | null> {
    const homeyWithGeo = this.homey as unknown as {
      geolocation?: {
        getLatitude?: () => number | Promise<number>;
        getLongitude?: () => number | Promise<number>;
        latitude?: number;
        longitude?: number;
      };
    };
    const geolocation = homeyWithGeo.geolocation;
    if (!geolocation) {
      return null;
    }

    const latitude = typeof geolocation.getLatitude === 'function'
      ? await geolocation.getLatitude()
      : geolocation.latitude;
    const longitude = typeof geolocation.getLongitude === 'function'
      ? await geolocation.getLongitude()
      : geolocation.longitude;

    if (
      typeof latitude !== 'number'
      || typeof longitude !== 'number'
      || !Number.isFinite(latitude)
      || !Number.isFinite(longitude)
    ) {
      return null;
    }

    return {
      latitude: Math.max(-89.8, Math.min(89.8, latitude)),
      longitude: Math.max(-180, Math.min(180, longitude)),
    };
  }

  private calculateSunTimes(date: Date, latitude: number, longitude: number): { sunrise: Date; sunset: Date } {
    const dayOfYear = this.getDayOfYear(date);
    const gamma = (2 * Math.PI / 365) * (dayOfYear - 1);
    const equationOfTime = 229.18 * (
      0.000075
      + 0.001868 * Math.cos(gamma)
      - 0.032077 * Math.sin(gamma)
      - 0.014615 * Math.cos(2 * gamma)
      - 0.040849 * Math.sin(2 * gamma)
    );
    const declination = 0.006918
      - 0.399912 * Math.cos(gamma)
      + 0.070257 * Math.sin(gamma)
      - 0.006758 * Math.cos(2 * gamma)
      + 0.000907 * Math.sin(2 * gamma)
      - 0.002697 * Math.cos(3 * gamma)
      + 0.00148 * Math.sin(3 * gamma);

    const latitudeRad = latitude * Math.PI / 180;
    const zenithRad = 90.833 * Math.PI / 180;
    const hourAngleArg = (
      Math.cos(zenithRad) / (Math.cos(latitudeRad) * Math.cos(declination))
    ) - (Math.tan(latitudeRad) * Math.tan(declination));
    const hourAngle = Math.acos(Math.max(-1, Math.min(1, hourAngleArg)));
    const hourAngleMinutes = (hourAngle * 180 / Math.PI) * 4;
    const solarNoonUtcMinutes = 720 - (4 * longitude) - equationOfTime;
    const sunriseUtcMinutes = solarNoonUtcMinutes - hourAngleMinutes;
    const sunsetUtcMinutes = solarNoonUtcMinutes + hourAngleMinutes;
    const utcMidnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

    return {
      sunrise: new Date(utcMidnight + (sunriseUtcMinutes * 60000)),
      sunset: new Date(utcMidnight + (sunsetUtcMinutes * 60000)),
    };
  }

  private getDayOfYear(date: Date): number {
    const start = Date.UTC(date.getUTCFullYear(), 0, 0);
    const current = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    return Math.floor((current - start) / 86400000);
  }

  private formatSceneDescription(scene: { [key: string]: unknown }): string | undefined {
    const parts = [
      typeof scene.sceneType === 'string' ? scene.sceneType : undefined,
      typeof scene.conditionSummary === 'string' ? scene.conditionSummary : undefined,
      typeof scene.scheduleSummary === 'string' ? scene.scheduleSummary : undefined,
    ].filter((part): part is string => !!part && part !== '-');

    return parts.length ? parts.join(' · ') : undefined;
  }

  getDiagnosticsExport(): Record<string, unknown> {
    return {
      generatedAt: new Date().toISOString(),
      app: {
        id: appManifest.id,
        version: appManifest.version,
      },
      settings: {
        bridges: this.bridgeConfigs.map((config) => ({
          id: config.id,
          name: config.name,
          ip: '<redacted>',
          authKey: '<redacted>',
        })),
      },
      bridges: this.bridgeConfigs.map((config) => {
        const bridge = this.bridges.get(config.id);
        if (!bridge) {
          return {
            id: config.id,
            name: config.name,
            connected: false,
          };
        }

        const devices = bridge.getDevices();
        const rooms = bridge.getRooms();
        const scenes = bridge.getScenes();
        const components = bridge.getComponents();

        return this.sanitizeDiagnostics({
          id: config.id,
          name: config.name,
          connected: bridge.isConnected,
          bridgeInfo: bridge.getLastBridgeInfo(),
          bridgeStatus: bridge.getLastBridgeStatus(),
          counts: {
            devices: devices.length,
            rooms: rooms.length,
            scenes: scenes.length,
            components: components.length,
          },
          devices,
          rooms,
          scenes,
          components,
        });
      }),
    };
  }

  private async initBridgesFromSettings(): Promise<void> {
    const token = ++this.initToken;
    const configs = this.loadBridgeConfigs();

    if (!configs.length) {
      this.resetBridges('Bridge configuration missing in Settings.');
      this.bridgeConfigs = [];
      this.defaultBridgeId = null;
      return;
    }

    // Only restart bridges whose connection settings actually changed, so a
    // settings save doesn't blip every paired device offline.
    const previousConfigs = new Map(this.bridgeConfigs.map((config) => [config.id, config]));

    for (const [bridgeId, bridge] of [...this.bridges.entries()]) {
      const previous = previousConfigs.get(bridgeId);
      const next = configs.find((config) => config.id === bridgeId);
      if (next && previous && !this.bridgeConnectionChanged(previous, next)) {
        continue;
      }
      bridge.disconnect();
      bridge.removeAllListeners();
      this.bridges.delete(bridgeId);
      this.bridgeConnectivityAnnounced.delete(bridgeId);
      this.emit('bridge_changed', bridgeId, null);
    }

    this.bridgeConfigs = configs;
    this.defaultBridgeId = configs[0]?.id || null;
    this.bridge = this.defaultBridgeId ? this.bridges.get(this.defaultBridgeId) || null : null;

    const pending: Promise<void>[] = [];
    for (const config of configs) {
      const existing = this.bridges.get(config.id);
      if (!existing) {
        pending.push(this.initBridge(config, token));
        continue;
      }

      // Kept bridge: apply a changed remote-access preference without reconnecting.
      const previous = previousConfigs.get(config.id);
      if (existing.isConnected && previous?.remoteAccess !== config.remoteAccess) {
        this.applyBridgeRemoteAccessPreference(config, existing).catch((err) => {
          this.error(`Bridge "${config.name || config.ip}": Failed to apply remote access preference`, err);
        });
      }
    }

    await Promise.allSettled(pending);
  }

  /**
   * True when the settings that affect the bridge connection itself differ.
   * Name and remote-access changes do not require a reconnect.
   */
  private bridgeConnectionChanged(previous: XComfortBridgeConfig, next: XComfortBridgeConfig): boolean {
    const normalize = (config: XComfortBridgeConfig) => {
      const authMode = this.normalizeAuthMode(config.authMode);
      return {
        ip: config.ip.trim(),
        authMode,
        authKey: this.normalizeBridgeSecret(config.authKey, authMode),
        username: authMode === 'user' ? this.normalizeBridgeUsername(config.username) : '',
      };
    };

    const a = normalize(previous);
    const b = normalize(next);
    return a.ip !== b.ip
      || a.authKey !== b.authKey
      || a.authMode !== b.authMode
      || a.username !== b.username;
  }

  private async initBridge(config: XComfortBridgeConfig, token: number): Promise<void> {
    if (token !== this.initToken) {
      return;
    }

    const cleanIp = config.ip.trim();
    const authMode = this.normalizeAuthMode(config.authMode);
    const cleanKey = this.normalizeBridgeSecret(config.authKey, authMode);
    const username = authMode === 'user' ? this.normalizeBridgeUsername(config.username) : 'default';
    const name = config.name || cleanIp;
    const clientId = await this.resolveBridgeClientId();

    if (token !== this.initToken) {
      return;
    }

    this.log(`Initializing Bridge "${name}" using ${authMode} login...`);

    const bridge = new XComfortBridge(
      cleanIp,
      cleanKey,
      (...args) => this.log(`[${name}]`, ...args),
      { mode: authMode, username, ...(clientId ? { clientId } : {}) },
    );
    this.bridges.set(config.id, bridge);
    if (config.id === this.defaultBridgeId) {
      this.bridge = bridge;
    }

    this.emit('bridge_changed', config.id, bridge);

    bridge.on('connected', () => this.log(`Bridge "${name}": Connected`));
    bridge.on('connected', () => {
      // Look up the latest config so a remote-access preference changed after
      // init (without a reconnect) is still applied correctly.
      const currentConfig = this.bridgeConfigs.find((entry) => entry.id === config.id) || config;
      this.applyBridgeRemoteAccessPreference(currentConfig, bridge).catch((err) => {
        this.error(`Bridge "${name}": Failed to apply remote access preference`, err);
      });
    });
    bridge.on('disconnected', () => this.log(`Bridge "${name}": Disconnected`));
    bridge.on('reconnecting', () => this.log(`Bridge "${name}": Reconnecting...`));
    bridge.on('connected', () => this.announceBridgeConnectivity(config.id, name, true));
    bridge.on('disconnected', () => this.announceBridgeConnectivity(config.id, name, false));

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

  /**
   * Stable per-Homey `client_id` for the bridge handshake. The official app
   * sends the phone's unique device identifier, which the bridge uses to
   * clean up stale sessions; a shared constant id would make two Homeys (or
   * a Homey and another integration using the same constant) evict each
   * other. Hashed to 16 hex chars to match the official id format. Returns
   * undefined when the Homey id is unavailable (falls back to the legacy
   * shared CLIENT_CONFIG.ID).
   */
  private async resolveBridgeClientId(): Promise<string | undefined> {
    if (this.bridgeClientId) {
      return this.bridgeClientId;
    }

    try {
      const homeyWithCloud = this.homey as unknown as {
        cloud?: { getHomeyId?: () => string | Promise<string> };
      };
      const homeyId = typeof homeyWithCloud.cloud?.getHomeyId === 'function'
        ? await homeyWithCloud.cloud.getHomeyId()
        : undefined;

      if (typeof homeyId === 'string' && homeyId.trim()) {
        this.bridgeClientId = createHash('sha256')
          .update(`homey-xcomfort-bridge:${homeyId.trim()}`)
          .digest('hex')
          .slice(0, 16);
        return this.bridgeClientId;
      }
    } catch (err) {
      this.error('Failed to derive per-Homey bridge client id, using shared fallback', err);
    }

    return undefined;
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
    this.bridgeConnectivityAnnounced.clear();
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
      authMode: 'device',
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
    const authMode = this.normalizeAuthMode(record.authMode ?? record.auth_mode);
    const authKey = this.normalizeBridgeSecret(
      record.authKey ?? record.auth_key ?? record.password ?? '',
      authMode,
    );
    const username = authMode === 'user' ? this.normalizeBridgeUsername(record.username) : undefined;
    const remoteAccess = this.normalizeRemoteAccessPreference(record.remoteAccess ?? record.remote_access);
    if (!ip || !authKey || (authMode === 'user' && !username)) {
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
      authMode,
      ...(username ? { username } : {}),
      ...(remoteAccess !== undefined ? { remoteAccess } : {}),
    };
  }

  private normalizeAuthMode(value: unknown): XComfortAuthMode {
    const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    return ['user', 'username', 'password', 'account', 'named_user', 'user_password'].includes(normalized)
      ? 'user'
      : 'device';
  }

  private normalizeBridgeSecret(value: unknown, authMode: XComfortAuthMode): string {
    const secret = String(value || '');
    return authMode === 'user' ? secret.trim() : secret.replace(/[\s-]+/g, '');
  }

  private normalizeBridgeUsername(value: unknown): string {
    return String(value || '').trim();
  }

  private normalizeRemoteAccessPreference(value: unknown): boolean | undefined {
    return normalizeRemoteAccessFlowPreference(value);
  }

  private async applyBridgeRemoteAccessPreference(
    config: XComfortBridgeConfig,
    bridge: XComfortBridge,
  ): Promise<void> {
    if (typeof config.remoteAccess !== 'boolean') {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 1500);
    });

    if (!bridge.isConnected) {
      return;
    }

    if (bridge.getLastBridgeInfo().remoteAllowed === config.remoteAccess) {
      return;
    }

    await bridge.setRemoteAccess(config.remoteAccess);
    this.log(`Bridge "${config.name || config.ip}": Remote access ${config.remoteAccess ? 'enabled' : 'disabled'}`);
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

  private sanitizeDiagnostics(value: unknown, key: string = ''): unknown {
    if (this.shouldRedactDiagnosticsKey(key)) {
      return '<redacted>';
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeDiagnostics(item));
    }

    if (value && typeof value === 'object') {
      const sanitized: Record<string, unknown> = {};
      Object.entries(value as Record<string, unknown>).forEach(([entryKey, entryValue]) => {
        sanitized[entryKey] = this.sanitizeDiagnostics(entryValue, entryKey);
      });
      return sanitized;
    }

    return value;
  }

  private shouldRedactDiagnosticsKey(key: string): boolean {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    return normalized === 'authkey'
      || normalized === 'auth'
      || normalized === 'user'
      || normalized === 'username'
      || normalized === 'userid'
      || normalized === 'email'
      || normalized === 'emailaddress'
      || normalized === 'phone'
      || normalized === 'phonenumber'
      || normalized.includes('email')
      || normalized.includes('phone')
      || normalized.includes('login')
      || normalized.includes('account')
      || normalized.includes('owner')
      || normalized.includes('credential')
      || normalized.includes('session')
      || normalized.includes('password')
      || normalized.includes('token')
      || normalized.includes('secret')
      || normalized === 'ip'
      || normalized === 'ipaddress'
      || normalized === 'host'
      || normalized === 'hostname'
      || normalized.includes('macaddress')
      || normalized === 'mac';
  }
}

module.exports = XComfortApp;
