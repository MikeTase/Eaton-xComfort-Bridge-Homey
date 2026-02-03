// drivers/bridge/device.ts
import Homey from 'homey';
import { XComfortBridge } from '../../lib/connection/XComfortBridge';
import { BridgeStatus } from '../../lib/types';

module.exports = class BridgeDevice extends Homey.Device {
  private bridge!: XComfortBridge;
  private onBridgeStatusUpdate!: (status: BridgeStatus) => void;

  async onInit() {
    this.log('BridgeDevice has been initialized');
    const app = this.homey.app as any;
    // getBridge() is safer if app isn't fully ready
    this.bridge = app.getBridge?.() || app.bridge;

    if (!this.bridge) {
      this.setUnavailable('Bridge not connected');
      return;
    }

    if (!this.hasCapability('measure_temperature.outside')) {
        await this.addCapability('measure_temperature.outside');
    }
    if (!this.hasCapability('measure_power')) {
        await this.addCapability('measure_power');
    }
    if (!this.hasCapability('alarm_contact')) {
        await this.addCapability('alarm_contact');
    }

    this.onBridgeStatusUpdate = (status: BridgeStatus) => {
        // this.log('Bridge Status Update:', status);
        
        if (typeof status.tempOutside === 'number') {
            // Check for valid temperature range (-100 is often error/init)
            if (status.tempOutside > -50 && status.tempOutside < 100) {
                 this.setCapabilityValue('measure_temperature.outside', status.tempOutside).catch(this.error);
            }
        }
        
        if (typeof status.power === 'number') {
            this.setCapabilityValue('measure_power', status.power).catch(this.error);
        }
        
        if (typeof status.windowsOpen !== 'undefined') {
             this.setCapabilityValue('alarm_contact', status.windowsOpen > 0).catch(this.error);
        }
    };

    // Listen to global bridge status events
    this.bridge.on('bridge_status', this.onBridgeStatusUpdate);
  }

  onDeleted() {
      if (this.bridge && this.onBridgeStatusUpdate) {
          this.bridge.removeListener('bridge_status', this.onBridgeStatusUpdate);
      }
  }
};
