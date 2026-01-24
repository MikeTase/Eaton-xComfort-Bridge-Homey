"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const homey_1 = __importDefault(require("homey"));
const Bridge_1 = require("./lib/connection/Bridge");
class XComfortApp extends homey_1.default.App {
    constructor() {
        super(...arguments);
        this.bridge = null;
    }
    async onInit() {
        this.log('Eaton xComfort App has been initialized');
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
    initBridge(ip, authKey) {
        if (this.bridge) {
            this.bridge.disconnect();
        }
        // Sanitize inputs
        ip = ip.trim();
        authKey = authKey.trim();
        this.log(`Connecting to Bridge at '${ip}'...`);
        // Generate or retrieve a persistent Device ID
        let deviceId = this.homey.settings.get('client_device_id');
        if (!deviceId) {
            deviceId = "homey_" + Math.random().toString(36).substring(2, 10);
            this.homey.settings.set('client_device_id', deviceId);
        }
        this.bridge = new Bridge_1.XComfortBridge(ip, authKey, deviceId);
        this.bridge.on('connected', () => {
            this.log('Bridge Connected!');
        });
        this.bridge.on('disconnected', () => {
            this.log('Bridge Disconnected');
        });
        this.bridge.on('error', (err) => {
            this.error('Bridge Error:', err);
        });
        this.bridge.connect();
    }
    getBridge() {
        return this.bridge;
    }
}
module.exports = XComfortApp;
