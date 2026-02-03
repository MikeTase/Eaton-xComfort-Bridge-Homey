"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const homey_1 = __importDefault(require("homey"));
const XComfortBridge_1 = require("./lib/connection/XComfortBridge");
// Log when the app starts
console.log('[App] Homey app.ts loaded at', new Date().toISOString());
class XComfortApp extends homey_1.default.App {
    constructor() {
        super(...arguments);
        this.bridge = null; // Public for drivers to access via app.bridge
    }
    async onInit() {
        this.log('Eaton xComfort App has been initialized');
        console.log('[App] onInit at', new Date().toISOString());
        // Attempt to load settings and connect
        const ip = this.homey.settings.get('bridge_ip');
        const authKey = this.homey.settings.get('bridge_auth_key');
        if (ip && authKey) {
            this.initBridge(ip, authKey);
        }
        else {
            this.log('Bridge configuration missing in Settings.');
        }
        this.homey.settings.on('set', (key) => {
            if (key === 'bridge_ip' || key === 'bridge_auth_key') {
                const newIp = this.homey.settings.get('bridge_ip');
                const newKey = this.homey.settings.get('bridge_auth_key');
                if (newIp && newKey) {
                    this.initBridge(newIp, newKey);
                }
            }
        });
    }
    async initBridge(ip, authKey) {
        if (this.bridge) {
            this.bridge.disconnect();
            this.bridge = null;
        }
        // Sanitize inputs
        const cleanIp = ip.trim();
        const cleanKey = authKey.trim();
        this.log(`Initializing Bridge at '${cleanIp}'...`);
        this.bridge = new XComfortBridge_1.XComfortBridge(cleanIp, cleanKey);
        // Subscribe to events for logging
        this.bridge.on('connected', () => this.log('Bridge: Connected'));
        this.bridge.on('disconnected', () => this.log('Bridge: Disconnected'));
        this.bridge.on('reconnecting', () => this.log('Bridge: Reconnecting...'));
        try {
            await this.bridge.init();
            this.log('Bridge: Initialization started');
        }
        catch (err) {
            this.error('Bridge: Initialization failed', err);
        }
    }
    // Helper for drivers
    getBridge() {
        return this.bridge;
    }
}
module.exports = XComfortApp;
