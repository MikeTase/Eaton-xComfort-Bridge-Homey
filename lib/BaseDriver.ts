import * as Homey from 'homey';
import { XComfortBridge } from './connection/XComfortBridge';
import { XComfortDevice, XComfortRoom, XComfortScene } from './types';

interface XComfortBridgeEntry {
    id: string;
    name: string;
    bridge: XComfortBridge;
}

interface XComfortApp extends Homey.App {
    bridge: XComfortBridge | null;
    getBridge?: (bridgeId?: string | null) => XComfortBridge | null;
    getBridgeEntries?: () => XComfortBridgeEntry[];
    getDefaultBridgeId?: () => string | null;
}

interface PairingCandidate {
    data?: Record<string, unknown>;
}

interface PairingCacheEntry<T> {
    expiresAt: number;
    value: T[];
}

export abstract class BaseDriver extends Homey.Driver {
    private devicesCache: PairingCacheEntry<XComfortDevice> | null = null;
    private roomsCache: PairingCacheEntry<XComfortRoom> | null = null;
    private scenesCache: PairingCacheEntry<XComfortScene> | null = null;
    private readonly pairingCacheMs = 3000;

    protected getBridge(bridgeId?: string | null): XComfortBridge {
        const app = this.homey.app as unknown as XComfortApp;
        const bridge = typeof app.getBridge === 'function'
            ? app.getBridge(bridgeId)
            : app.bridge;

        if (!bridge) {
            throw new Error('Bridge not connected. Please configure settings first.');
        }

        return bridge;
    }

    protected getBridgeEntries(): XComfortBridgeEntry[] {
        const app = this.homey.app as unknown as XComfortApp;
        if (typeof app.getBridgeEntries === 'function') {
            const entries = app.getBridgeEntries();
            if (entries.length > 0) {
                return entries;
            }
        }

        if (app.bridge) {
            return [{
                id: typeof app.getDefaultBridgeId === 'function' ? app.getDefaultBridgeId() || 'default' : 'default',
                name: 'xComfort Bridge',
                bridge: app.bridge,
            }];
        }

        return [];
    }

    protected getBridgeDeviceData(prefix: string, device: XComfortDevice): Record<string, unknown> {
        const bridgeId = this.getItemBridgeId(device);
        const deviceId = String(device.deviceId);
        return {
            id: bridgeId ? `${bridgeId}_${prefix}_${deviceId}` : `${prefix}_${deviceId}`,
            deviceId,
            ...(bridgeId ? { bridgeId } : {}),
        };
    }

    protected getBridgeRoomData(prefix: string, room: XComfortRoom): Record<string, unknown> {
        const bridgeId = this.getItemBridgeId(room);
        const roomId = String(room.roomId);
        return {
            id: bridgeId ? `${bridgeId}_${prefix}_${roomId}` : `${prefix}_${roomId}`,
            roomId,
            ...(bridgeId ? { bridgeId } : {}),
        };
    }

    protected getItemBridgeId(item: Record<string, unknown>): string | undefined {
        return typeof item.bridgeId === 'string' && item.bridgeId ? item.bridgeId : undefined;
    }

    protected getItemBridgeName(item: Record<string, unknown>): string | undefined {
        return typeof item.bridgeName === 'string' && item.bridgeName ? item.bridgeName : undefined;
    }

    protected getDisplayNameWithBridge(name: string, item: Record<string, unknown>): string {
        const entries = this.getBridgeEntries();
        const bridgeName = this.getItemBridgeName(item);
        if (entries.length <= 1 || !bridgeName) {
            return name;
        }

        return `${bridgeName} - ${name}`;
    }

    protected filterUnpairedPairingDevices<T extends PairingCandidate>(candidates: T[]): T[] {
        return candidates.filter((candidate) => !this.isPairingDataAlreadyPaired(candidate.data || {}));
    }

    protected isPairingDataAlreadyPaired(data: Record<string, unknown>): boolean {
        const candidateId = this.toOptionalString(data.id);
        const candidateDeviceId = this.toOptionalString(data.deviceId);
        const candidateRoomId = this.toOptionalString(data.roomId);
        const candidateSceneId = this.toOptionalString(data.sceneId);
        const candidateBridgeId = this.getEffectiveBridgeId(data);

        return this.getDevices().some((device) => {
            const existingData = device.getData?.() || {};
            const existingId = this.toOptionalString(existingData.id);
            if (candidateId && existingId && candidateId === existingId) {
                return true;
            }

            const existingBridgeId = this.getEffectiveBridgeId(existingData);
            const bridgeMatches = candidateBridgeId === existingBridgeId;
            if (!bridgeMatches) {
                return false;
            }

            const existingDeviceId = this.toOptionalString(existingData.deviceId);
            if (candidateDeviceId && existingDeviceId && candidateDeviceId === existingDeviceId) {
                return true;
            }

            const existingRoomId = this.toOptionalString(existingData.roomId);
            if (candidateRoomId && existingRoomId && candidateRoomId === existingRoomId) {
                return true;
            }

            const existingSceneId = this.toOptionalString(existingData.sceneId);
            return !!(candidateSceneId && existingSceneId && candidateSceneId === existingSceneId);
        });
    }

    protected async getDevicesFromBridge(timeoutMs: number = 15000): Promise<XComfortDevice[]> {
        const cached = this.getCached(this.devicesCache);
        if (cached) {
            return cached;
        }

        const entries = this.getBridgeEntries();
        if (!entries.length) {
            throw new Error('Bridge not connected. Please configure settings first.');
        }

        const deviceLists = await Promise.all(entries.map(async (entry) => {
            const devices = await this.getDevicesForBridge(entry.bridge, timeoutMs);
            return devices.map((device) => ({
                ...device,
                bridgeId: entry.id,
                bridgeName: entry.name,
            } as XComfortDevice));
        }));

        const devices = deviceLists.flat();
        this.devicesCache = this.createCacheEntry(devices);
        return devices;
    }

    protected async getRoomsFromBridge(timeoutMs: number = 15000): Promise<XComfortRoom[]> {
        const cached = this.getCached(this.roomsCache);
        if (cached) {
            return cached;
        }

        const entries = this.getBridgeEntries();
        if (!entries.length) {
            throw new Error('Bridge not connected. Please configure settings first.');
        }

        const roomLists = await Promise.all(entries.map(async (entry) => {
            const rooms = await this.getRoomsForBridge(entry.bridge, timeoutMs);
            return rooms.map((room) => ({
                ...room,
                bridgeId: entry.id,
                bridgeName: entry.name,
            } as XComfortRoom));
        }));

        const rooms = roomLists.flat();
        this.roomsCache = this.createCacheEntry(rooms);
        return rooms;
    }

    protected async getScenesFromBridge(timeoutMs: number = 15000): Promise<XComfortScene[]> {
        const cached = this.getCached(this.scenesCache);
        if (cached) {
            return cached;
        }

        const entries = this.getBridgeEntries();
        if (!entries.length) {
            throw new Error('Bridge not connected. Please configure settings first.');
        }

        const sceneLists = await Promise.all(entries.map(async (entry) => {
            const scenes = await this.getScenesForBridge(entry.bridge, timeoutMs);
            return scenes.map((scene) => ({
                ...scene,
                bridgeId: entry.id,
                bridgeName: entry.name,
            } as XComfortScene));
        }));

        const scenes = sceneLists.flat();
        this.scenesCache = this.createCacheEntry(scenes);
        return scenes;
    }

    private async getDevicesForBridge(bridge: XComfortBridge, timeoutMs: number): Promise<XComfortDevice[]> {
        const devices = bridge.getDevices();
        if (devices && devices.length > 0) {
            return devices;
        }

        return new Promise<XComfortDevice[]>((resolve) => {
            let isResolved = false;
            // Assigned after callbacks are declared so cleanup can clear the active timer.
            // eslint-disable-next-line prefer-const
            let timeoutTimer: NodeJS.Timeout;

            const cleanup = () => {
                if (timeoutTimer) clearTimeout(timeoutTimer);
                bridge.removeListener('devices_loaded', onLoaded);
            };

            const finish = (loaded: XComfortDevice[]) => {
                if (isResolved) return;
                isResolved = true;
                cleanup();
                resolve(loaded || bridge.getDevices() || []);
            };

            const onLoaded = (loadedDevices: XComfortDevice[]) => finish(loadedDevices);
            bridge.once('devices_loaded', onLoaded);
            timeoutTimer = setTimeout(() => finish(bridge.getDevices() || []), timeoutMs);
        });
    }

    private async getRoomsForBridge(bridge: XComfortBridge, timeoutMs: number): Promise<XComfortRoom[]> {
        const rooms = bridge.getRooms();
        if (rooms && rooms.length > 0) {
            return rooms;
        }

        return new Promise<XComfortRoom[]>((resolve) => {
            let isResolved = false;
            // Assigned after callbacks are declared so cleanup can clear the active timer.
            // eslint-disable-next-line prefer-const
            let timeoutTimer: NodeJS.Timeout;

            const cleanup = () => {
                if (timeoutTimer) clearTimeout(timeoutTimer);
                bridge.removeListener('devices_loaded', onLoaded);
            };

            const finish = () => {
                if (isResolved) return;
                isResolved = true;
                cleanup();
                resolve(bridge.getRooms() || []);
            };

            const onLoaded = () => finish();
            bridge.once('devices_loaded', onLoaded);
            timeoutTimer = setTimeout(finish, timeoutMs);
        });
    }

    private async getScenesForBridge(bridge: XComfortBridge, timeoutMs: number): Promise<XComfortScene[]> {
        const scenes = bridge.getScenes();
        if (scenes && scenes.length > 0) {
            return scenes;
        }

        return new Promise<XComfortScene[]>((resolve) => {
            let isResolved = false;
            // Assigned after callbacks are declared so cleanup can clear the active timer.
            // eslint-disable-next-line prefer-const
            let timeoutTimer: NodeJS.Timeout;

            const cleanup = () => {
                if (timeoutTimer) clearTimeout(timeoutTimer);
                bridge.removeListener('devices_loaded', onLoaded);
            };

            const finish = () => {
                if (isResolved) return;
                isResolved = true;
                cleanup();
                resolve(bridge.getScenes() || []);
            };

            const onLoaded = () => finish();
            bridge.once('devices_loaded', onLoaded);
            timeoutTimer = setTimeout(finish, timeoutMs);
        });
    }

    private getCached<T>(cache: PairingCacheEntry<T> | null): T[] | null {
        if (!cache || Date.now() > cache.expiresAt) {
            return null;
        }

        return cache.value;
    }

    private createCacheEntry<T>(value: T[]): PairingCacheEntry<T> {
        return {
            value,
            expiresAt: Date.now() + this.pairingCacheMs,
        };
    }

    private getEffectiveBridgeId(data: Record<string, unknown>): string {
        const explicitBridgeId = this.toOptionalString(data.bridgeId);
        if (explicitBridgeId) {
            return explicitBridgeId;
        }

        const app = this.homey.app as unknown as XComfortApp;
        return typeof app.getDefaultBridgeId === 'function' ? app.getDefaultBridgeId() || '' : '';
    }

    private toOptionalString(value: unknown): string | null {
        if (value === undefined || value === null) {
            return null;
        }

        const text = String(value).trim();
        return text.length > 0 ? text : null;
    }
}
