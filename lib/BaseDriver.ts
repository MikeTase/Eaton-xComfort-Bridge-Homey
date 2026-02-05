import * as Homey from 'homey';
import { XComfortBridge } from './connection/XComfortBridge';
import { XComfortDevice } from './types';

// Define the shape of our specific App class
interface XComfortApp extends Homey.App {
    bridge: XComfortBridge | null;
}

/**
 * Base class for all xComfort drivers.
 * Provides helper methods for accessing the bridge and waiting for devices.
 */
export abstract class BaseDriver extends Homey.Driver {
    
    /**
     * Gets the bridge instance from the app, throwing an error if not connected.
     */
    protected getBridge(): XComfortBridge {
        const app = this.homey.app as unknown as XComfortApp;
        const bridge = app.bridge;

        if (!bridge) {
            throw new Error('Bridge not connected. Please configure settings first.');
        }

        return bridge;
    }

    /**
     * Gets devices from the bridge.
     * If the device list is empty, it waits for the 'devices_loaded' event or a timeout.
     * @param timeoutMs Max time to wait for devices in milliseconds (default 15000)
     */
    protected async getDevicesFromBridge(timeoutMs: number = 15000): Promise<XComfortDevice[]> {
        const bridge = this.getBridge();
        const devices = bridge.getDevices();

        // If devices are already loaded, return them immediately
        if (devices && devices.length > 0) {
            return devices;
        }

        // Otherwise wait for them
        return new Promise<XComfortDevice[]>((resolve) => {
            let isResolved = false;
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

            timeoutTimer = setTimeout(() => {
                finish(bridge.getDevices() || []);
            }, timeoutMs);
        });
    }
}
