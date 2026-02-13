import * as Homey from 'homey';
import { XComfortBridge } from './connection/XComfortBridge';
import type { DeviceStateUpdate, DeviceStateCallback } from './types';

// Define the shape of our specific App class
interface XComfortApp extends Homey.App {
    bridge: XComfortBridge | null;
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

    private onAppBridgeChanged?: (bridge: XComfortBridge | null) => void;

    /** Managed device-state listeners (auto-rebound on bridge change, auto-cleaned on delete) */
    private managedListeners: Array<{ deviceId: string; callback: DeviceStateCallback }> = [];

    /**
     * Template-method initialisation.
     * Acquires the bridge, then calls onDeviceReady() — subclasses should
     * override onDeviceReady() instead of onInit().
     */
    async onInit(): Promise<void> {
        this.log(`Device init: ${this.getName()}`);

        const app = this.homey.app as unknown as XComfortApp;

        if (!app.bridge) {
            this.setUnavailable('Bridge not connected');
            this.error('Bridge instance not found in App');
            return; // no throw — subclass onDeviceReady() simply won't run
        }

        this.bridge = app.bridge;

        this.onAppBridgeChanged = (newBridge) => {
            const oldBridge = this.bridge;
            if (!newBridge) {
                this.setUnavailable('Bridge not connected');
                return;
            }
            this.bridge = newBridge;
            this.setAvailable();

            // Rebind all managed listeners to the new bridge
            for (const entry of this.managedListeners) {
                oldBridge.removeDeviceStateListener(entry.deviceId, entry.callback);
                newBridge.addDeviceStateListener(entry.deviceId, entry.callback);
            }

            this.onBridgeChanged(newBridge, oldBridge);
        };
        app.on('bridge_changed', this.onAppBridgeChanged);

        await this.onDeviceReady();
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
     * Safely update a capability value (no-ops if capability doesn't exist).
     */
    protected async updateCapability(capabilityId: string, value: string | number | boolean | null): Promise<void> {
        if (this.hasCapability(capabilityId)) {
            await this.setCapabilityValue(capabilityId, value).catch(err => {
                this.error(`Failed to update capability ${capabilityId}:`, err);
            });
        }
    }

    // ── Lifecycle ───────────────────────────────────────────────────────

    onDeleted(): void {
        // Remove all managed device-state listeners
        if (this.bridge) {
            for (const entry of this.managedListeners) {
                this.bridge.removeDeviceStateListener(entry.deviceId, entry.callback);
            }
        }
        this.managedListeners = [];

        // Unsubscribe from app-level bridge change events
        const app = this.homey.app as unknown as XComfortApp;
        if (this.onAppBridgeChanged) {
            app.removeListener('bridge_changed', this.onAppBridgeChanged);
            this.onAppBridgeChanged = undefined;
        }
    }
}
