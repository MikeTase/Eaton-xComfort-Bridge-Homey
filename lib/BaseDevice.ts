import * as Homey from 'homey';
import { XComfortBridge } from './connection/XComfortBridge';

// Define the shape of our specific App class
interface XComfortApp extends Homey.App {
    bridge: XComfortBridge | null;
}

/**
 * Base class for all xComfort devices.
 * Handles common initialization, bridge access, and error logging.
 */
export abstract class BaseDevice extends Homey.Device {
    // Protected property for subclasses to access the bridge
    protected bridge!: XComfortBridge;
    private onAppBridgeChanged?: (bridge: XComfortBridge | null) => void;

    /**
     * Subclasses should call super.onInit() FIRST.
     * @returns true if initialization should proceed, false if bridge is missing
     */
    async onInit(): Promise<void> {
        this.logInit();
        
        const app = this.homey.app as unknown as XComfortApp;
        
        if (!app.bridge) {
            this.setUnavailable('Bridge not connected');
            this.error('Bridge instance not found in App');
            throw new Error('Bridge not connected');
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
            this.onBridgeChanged(newBridge, oldBridge);
        };
        app.on('bridge_changed', this.onAppBridgeChanged);
    }

    protected logInit(): void {
        this.log(`Device init: ${this.getName()}`);
    }

    /**
     * Hook for subclasses to rebind listeners on bridge change.
     */
    protected onBridgeChanged(_newBridge: XComfortBridge, _oldBridge: XComfortBridge): void {
        // Subclasses may override
    }

    /**
     * Helper to safely update a capability
     */
    protected async updateCapability(capabilityId: string, value: any): Promise<void> {
        if (this.hasCapability(capabilityId)) {
            await this.setCapabilityValue(capabilityId, value).catch(err => {
                this.error(`Failed to update capability ${capabilityId}:`, err);
            });
        }
    }

    onDeleted(): void {
        const app = this.homey.app as unknown as XComfortApp;
        if (this.onAppBridgeChanged) {
            app.removeListener('bridge_changed', this.onAppBridgeChanged);
            this.onAppBridgeChanged = undefined;
        }
    }
}
