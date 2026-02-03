import Homey from 'homey';
import { XComfortBridge } from '../../lib/connection/XComfortBridge';
import { MESSAGE_TYPES } from '../../lib/XComfortProtocol';
import { DeviceStateUpdate, ClimateMode, ClimateState } from '../../lib/types';

interface XComfortApp extends Homey.App {
    bridge: XComfortBridge | null;
}

module.exports = class ThermostatDevice extends Homey.Device {
  private bridge: XComfortBridge | null = null;
  private deviceId: string = '';

  async onInit() {
    this.bridge = (this.homey.app as XComfortApp).bridge;
    this.deviceId = this.getData().deviceId;

    this.log(`ThermostatDevice init: ${this.getName()}`);

    if (!this.bridge) {
      this.setUnavailable('Bridge not connected');
      return;
    }
    
    // Register listeners
    this.registerStateListener();
    this.registerCapabilityListeners();
  }

  private registerStateListener() {
    if (!this.bridge) return;
    
    // Listen for updates from the bridge
    this.bridge.on(`device_update_${this.deviceId}`, (data: DeviceStateUpdate) => {
        this.updateState(data);
    });
  }
  
  private updateState(data: DeviceStateUpdate) {
      this.log(`Termostat update:`, data);
      
      if (data.setpoint !== undefined) {
          this.setCapabilityValue('target_temperature', data.setpoint).catch(this.error);
      }
      
      if (data.metadata?.temperature !== undefined) {
          this.setCapabilityValue('measure_temperature', data.metadata.temperature).catch(this.error);
      }
      
      if (data.metadata?.humidity !== undefined) {
          this.setCapabilityValue('measure_humidity', data.metadata.humidity).catch(this.error);
      }
  }

  private registerCapabilityListeners() {
      // Set Temperature
      this.registerCapabilityListener('target_temperature', async (value) => {
          if (!this.bridge) throw new Error('Bridge offline');
          
          await this.bridge.getConnectionManager().sendWithRetry({
              type_int: MESSAGE_TYPES.SET_HEATING_STATE,
              mc: this.bridge.getConnectionManager().nextMc(),
              payload: {
                  deviceId: parseInt(this.deviceId),
                  setpoint: value
              }
          });
      });
  }
  
  onDeleted() {
      if (this.bridge) {
          this.bridge.removeAllListeners(`device_update_${this.deviceId}`);
      }
  }
};
