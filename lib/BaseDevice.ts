import * as Homey from 'homey';
import { XComfortBridge } from './connection/XComfortBridge';
import { XCOMFORT_CAPABILITIES } from './XComfortCapabilities';
import type { DeviceMetadata, DeviceStateCallback, InfoEntry, RoomStateCallback } from './types';
import { parseInfoMetadata } from './utils/parseInfoMetadata';

// Define the shape of our specific App class
interface XComfortApp extends Homey.App {
    bridge: XComfortBridge | null;
    getBridge?: (bridgeId?: string | null) => XComfortBridge | null;
    getDefaultBridgeId?: () => string | null;
}

/**
 * Base class for all xComfort devices.
 * Handles common initialization, bridge access, error logging,
 * and automatic device-state listener lifecycle management.
 */
export abstract class BaseDevice extends Homey.Device {
    /** Bridge reference — only valid after a successful onInit(). */
    protected bridge!: XComfortBridge;

    /** Cached device ID from getData().deviceId */
    private _deviceId: string | null = null;
    private _bridgeId: string | null | undefined = undefined;

    private onAppBridgeChanged?: (bridgeIdOrBridge: string | XComfortBridge | null, bridgeMaybe?: XComfortBridge | null) => void;
    private isDeviceReadyInitialized: boolean = false;
    private onBridgeConnected?: () => void;
    private onBridgeDisconnected?: () => void;

    /** Managed device-state listeners (auto-rebound on bridge change, auto-cleaned on delete) */
    private managedListeners: Array<{ deviceId: string; callback: DeviceStateCallback }> = [];
    private managedRoomListeners: Array<{ roomId: string; callback: RoomStateCallback }> = [];

    /**
     * Template-method initialisation.
     * Acquires the bridge, then calls onDeviceReady() — subclasses should
     * override onDeviceReady() instead of onInit().
     */
    async onInit(): Promise<void> {
        this.log(`Device init: ${this.getName()}`);

        const app = this.homey.app as unknown as XComfortApp;

        this.onBridgeConnected = () => {
            this.setAvailable();
        };

        this.onBridgeDisconnected = () => {
            this.setUnavailable('Bridge disconnected');
        };

        const resolveAppBridge = () => {
            if (typeof app.getBridge === 'function') {
                return app.getBridge(this.bridgeId);
            }
            return app.bridge;
        };

        this.onAppBridgeChanged = (bridgeIdOrBridge, bridgeMaybe) => {
            let newBridge: XComfortBridge | null;
            if (typeof bridgeIdOrBridge === 'string') {
                if (bridgeIdOrBridge !== this.bridgeId) {
                    return;
                }
                newBridge = bridgeMaybe || null;
            } else {
                newBridge = bridgeIdOrBridge;
            }

            const oldBridge = this.bridge;

            if (oldBridge) {
                if (this.onBridgeConnected) {
                    oldBridge.removeListener('connected', this.onBridgeConnected);
                }
                if (this.onBridgeDisconnected) {
                    oldBridge.removeListener('disconnected', this.onBridgeDisconnected);
                }
                for (const entry of this.managedListeners) {
                    oldBridge.removeDeviceStateListener(entry.deviceId, entry.callback);
                }
                for (const entry of this.managedRoomListeners) {
                    oldBridge.removeRoomStateListener(entry.roomId, entry.callback);
                }
            }

            if (!newBridge) {
                this.bridge = undefined as unknown as XComfortBridge;
                this.setUnavailable('Bridge not connected');
                return;
            }

            this.bridge = newBridge;

            if (this.onBridgeConnected) {
                newBridge.on('connected', this.onBridgeConnected);
            }
            if (this.onBridgeDisconnected) {
                newBridge.on('disconnected', this.onBridgeDisconnected);
            }

            if (newBridge.isConnected) {
                this.setAvailable();
            } else {
                this.setUnavailable('Bridge connecting...');
            }

            // First successful bridge assignment: initialize device hooks once.
            if (!this.isDeviceReadyInitialized) {
                this.isDeviceReadyInitialized = true;
                this.onDeviceReady().catch((err) => {
                    this.error(`[BaseDevice] onDeviceReady failed for ${this.getName()}:`, err);
                });
                return;
            }

            // Rebind all managed listeners to the new bridge
            for (const entry of this.managedListeners) {
                newBridge.addDeviceStateListener(entry.deviceId, entry.callback);
            }
            for (const entry of this.managedRoomListeners) {
                newBridge.addRoomStateListener(entry.roomId, entry.callback);
            }

            if (oldBridge) {
                this.onBridgeChanged(newBridge, oldBridge);
            }
        };
        app.on('bridge_changed', this.onAppBridgeChanged);

        const initialBridge = resolveAppBridge();
        if (initialBridge) {
            this.onAppBridgeChanged(this.bridgeId, initialBridge);
        } else {
            this.setUnavailable('Bridge not connected');
            this.error('Bridge instance not found in App');
        }
    }

    // ── Subclass hooks ──────────────────────────────────────────────────

    /**
     * Called after the bridge is confirmed available.
     * Subclasses should override this instead of onInit().
     */
    protected async onDeviceReady(): Promise<void> {
        // Subclasses override
    }

    /**
     * Hook for subclasses to perform extra work when the bridge instance changes.
     * Managed listeners are already rebound automatically before this is called.
     */
    protected onBridgeChanged(_newBridge: XComfortBridge, _oldBridge: XComfortBridge): void {
        // Subclasses may override
    }

    // ── Helpers ─────────────────────────────────────────────────────────

    /**
     * Cached device ID accessor — avoids repeated getData().deviceId calls.
     */
    protected get deviceId(): string {
        if (this._deviceId === null) {
            this._deviceId = String(this.getData().deviceId);
        }
        return this._deviceId;
    }

    protected get bridgeId(): string | null {
        if (this._bridgeId === undefined) {
            const data = this.getData() as { bridgeId?: string };
            if (data.bridgeId) {
                this._bridgeId = data.bridgeId;
            } else {
                const app = this.homey.app as unknown as XComfortApp;
                this._bridgeId = typeof app.getDefaultBridgeId === 'function' ? app.getDefaultBridgeId() : null;
            }
        }

        return this._bridgeId || null;
    }

    /**
     * Register a device-state listener that is automatically:
     * - rebound when the bridge reconnects
     * - removed when the device is deleted
     */
    protected addManagedStateListener(deviceId: string, callback: DeviceStateCallback): void {
        this.bridge.addDeviceStateListener(deviceId, callback);
        this.managedListeners.push({ deviceId, callback });
    }

    /**
     * Remove a managed device-state listener.
     */
    protected removeManagedStateListener(deviceId: string, callback?: DeviceStateCallback): void {
        const listeners = this.managedListeners.filter((listener) => {
            return listener.deviceId === deviceId && (!callback || listener.callback === callback);
        });
        if (this.bridge) {
            for (const entry of listeners) {
                this.bridge.removeDeviceStateListener(deviceId, entry.callback);
            }
        }
        this.managedListeners = this.managedListeners.filter((listener) => {
            return !(listener.deviceId === deviceId && (!callback || listener.callback === callback));
        });
    }

    /**
     * Register a room-state listener that is automatically:
     * - rebound when the bridge reconnects
     * - removed when the device is deleted
     */
    protected addManagedRoomStateListener(roomId: string, callback: RoomStateCallback): void {
        this.bridge.addRoomStateListener(roomId, callback);
        this.managedRoomListeners.push({ roomId, callback });
    }

    /**
     * Remove a managed room-state listener.
     */
    protected removeManagedRoomStateListener(roomId: string): void {
        const listeners = this.managedRoomListeners.filter(l => l.roomId === roomId);
        if (this.bridge) {
            for (const entry of listeners) {
                this.bridge.removeRoomStateListener(roomId, entry.callback);
            }
        }
        this.managedRoomListeners = this.managedRoomListeners.filter(l => l.roomId !== roomId);
    }

    /**
     * Safely update a capability value (no-ops if capability doesn't exist).
     *
     * Skips the write entirely when the capability already holds the target
     * value — this avoids redundant SDK round-trips and spurious Flow/Insights
     * re-evaluations under the frequent state updates the bridge emits.
     */
    protected async updateCapability(capabilityId: string, value: string | number | boolean | null): Promise<void> {
        if (!this.hasCapability(capabilityId)) {
            return;
        }
        try {
            if (this.getCapabilityValue(capabilityId) === value) {
                return;
            }
        } catch {
            // Reading the current value failed — fall through and write it.
        }
        await this.setCapabilityValue(capabilityId, value).catch(err => {
            this.error(`Failed to update capability ${capabilityId}:`, err);
        });
    }

    protected async ensureDeviceCapability(capabilityId: string): Promise<void> {
        if (!this.hasCapability(capabilityId)) {
            await this.addCapability(capabilityId).catch(this.error);
        }
    }

    protected async applyDeviceMetadataSnapshot(deviceId: string = this.deviceId): Promise<void> {
        const device = this.bridge.getDevice(deviceId);
        if (!device || !Array.isArray(device.info)) {
            return;
        }

        await this.applySensorMetadata(parseInfoMetadata(device.info as InfoEntry[]));
    }

    protected async applySensorMetadata(metadata?: DeviceMetadata): Promise<void> {
        if (!metadata) {
            return;
        }

        if (typeof metadata.temperature === 'number') {
            await this.ensureDeviceCapability('measure_temperature');
            await this.updateCapability('measure_temperature', metadata.temperature);
        }

        if (typeof metadata.humidity === 'number') {
            await this.ensureDeviceCapability('measure_humidity');
            await this.updateCapability('measure_humidity', metadata.humidity);
        }

        if (typeof metadata.deviceTemperature === 'number') {
            await this.ensureDeviceCapability(XCOMFORT_CAPABILITIES.DEVICE_TEMPERATURE);
            await this.updateCapability(XCOMFORT_CAPABILITIES.DEVICE_TEMPERATURE, metadata.deviceTemperature);
        }

        if (typeof metadata.batteryLevel === 'number') {
            await this.ensureDeviceCapability('measure_battery');
            await this.updateCapability('measure_battery', metadata.batteryLevel);
        }

        if (typeof metadata.signalStrength === 'number') {
            await this.ensureDeviceCapability(XCOMFORT_CAPABILITIES.SIGNAL_QUALITY);
            await this.updateCapability(XCOMFORT_CAPABILITIES.SIGNAL_QUALITY, metadata.signalStrength);
        }

        if (typeof metadata.signalStrengthDbm === 'number') {
            await this.ensureDeviceCapability(XCOMFORT_CAPABILITIES.SIGNAL_STRENGTH);
            await this.updateCapability(XCOMFORT_CAPABILITIES.SIGNAL_STRENGTH, metadata.signalStrengthDbm);
        }
    }

    // ── Lifecycle ───────────────────────────────────────────────────────

    onDeleted(): void {
        this.teardownListeners();
    }

    /**
     * Called when the app shuts down (update/restart). Releases the same
     * bridge/app listeners as onDeleted so nothing fires during teardown.
     * Subclasses that hold timers or unflushed state should override this
     * (and call super.onUninit()).
     */
    async onUninit(): Promise<void> {
        this.teardownListeners();
    }

    private teardownListeners(): void {
        // Remove all managed device-state listeners
        if (this.bridge) {
            for (const entry of this.managedListeners) {
                this.bridge.removeDeviceStateListener(entry.deviceId, entry.callback);
            }
            for (const entry of this.managedRoomListeners) {
                this.bridge.removeRoomStateListener(entry.roomId, entry.callback);
            }
        }
        this.managedListeners = [];
        this.managedRoomListeners = [];

        // Unsubscribe from app-level bridge change events
        const app = this.homey.app as unknown as XComfortApp;
        if (this.onAppBridgeChanged) {
            app.removeListener('bridge_changed', this.onAppBridgeChanged);
            this.onAppBridgeChanged = undefined;
        }

        if (this.bridge) {
            if (this.onBridgeConnected) {
                this.bridge.removeListener('connected', this.onBridgeConnected);
            }
            if (this.onBridgeDisconnected) {
                this.bridge.removeListener('disconnected', this.onBridgeDisconnected);
            }
        }
        this.onBridgeConnected = undefined;
        this.onBridgeDisconnected = undefined;
    }
}
