// drivers/bridge/driver.ts
import Homey from 'homey';
import { XComfortBridge } from '../../lib/connection/XComfortBridge';

module.exports = class BridgeDriver extends Homey.Driver {
  private bridge!: XComfortBridge;

  async onInit() {
    console.log('[BridgeDriver] initialized');
    const app = this.homey.app as any;
    this.bridge = app.bridge;
  }

  async onPairListDevices() {
    return [
      {
        name: 'xComfort Bridge',
        data: {
          id: 'xcomfort_bridge_main',
          deviceId: 'bridge'
        }
      }
    ];
  }
};
