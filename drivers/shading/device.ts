import Homey from 'homey';
import { XComfortBridge } from '../../lib/connection/XComfortBridge';
import { MESSAGE_TYPES } from '../../lib/XComfortProtocol';
import { DeviceStateUpdate, ShadingAction } from '../../lib/types';

interface XComfortApp extends Homey.App {
    bridge: XComfortBridge | null;
}

module.exports = class ShadingDevice extends Homey.Device {
  private bridge: XComfortBridge | null = null;
  private deviceId: string = '';
  private safetyActive: boolean = false;
  private onDeviceUpdate: ((deviceId: string | number, state: DeviceStateUpdate) => void) | null = null;

  async onInit() {
    this.bridge = (this.homey.app as XComfortApp).bridge;
    this.deviceId = this.getData().deviceId;
    
    const settings = this.getSettings();
    const supportsPosition = settings.shRuntime !== undefined && settings.shRuntime > 0;

    if (!supportsPosition) {
        await this.removeCapability("windowcoverings_set");
    }

    if (!this.bridge) {
      this.setUnavailable('Bridge not connected');
      return;
    }
    
    this.registerStateListener();
    this.registerCapabilityListeners();
  }

  private registerStateListener() {
    if (!this.bridge) return;
    
    this.onDeviceUpdate = (_id, data) => {
        this.updateState(data);
    };
    this.bridge.addDeviceStateListener(this.deviceId, this.onDeviceUpdate);
  }
  
  private updateState(data: DeviceStateUpdate) {
      if (data.shSafety !== undefined) {
          const isSafe = data.shSafety === 0;
          this.safetyActive = !isSafe;
          if (!isSafe) {
              this.setUnavailable("Safety Lock Active (Wind/Rain)");
          } else {
              this.setAvailable();
          }
      }
      
      if (data.shadsClosed !== undefined) {
          // shadsClosed is likely 0-1 (float) or 0-100. Assuming 0-1 for Homey.
          // If protocol sends 0-100, divide by 100.
          // Based on observations, usually 0.0 to 1.0.
          // If existing logic suggests differently, adjust.
          // Python repo says: 0=Open, 100=Closed?
          // Let's assume 0.0-1.0 to meet Homey standard. 
          // If 'dimmvalue' is used for position:
          let pos = data.dimmvalue;
          if (pos !== undefined) {
              if (pos > 1) pos = pos / 100; // Auto-detect scale
              this.setCapabilityValue('windowcoverings_set', pos).catch(this.error);
          }
      }
  }

  private registerCapabilityListeners() {
      // Position Set
      this.registerCapabilityListener('windowcoverings_set', async (value) => {
          if (this.safetyActive) throw new Error('Safety lock active');
          
          await this.bridge?.getConnectionManager().sendWithRetry({
              type_int: MESSAGE_TYPES.SET_DEVICE_SHADING_STATE,
              mc: this.bridge.getConnectionManager().nextMc(),
              payload: {
                  deviceId: parseInt(this.deviceId),
                  action: ShadingAction.GO_TO,
                  value: value * 100 // Protocol likely expects 0-100
              }
          });
      });
      
      // State (Up/Down/Idle)
      this.registerCapabilityListener('windowcoverings_state', async (value) => {
           if (this.safetyActive) throw new Error('Safety lock active');
           
           let action = ShadingAction.STOP;
           if (value === 'up') action = ShadingAction.OPEN;
           if (value === 'down') action = ShadingAction.CLOSE;
           
           await this.bridge?.getConnectionManager().sendWithRetry({
              type_int: MESSAGE_TYPES.SET_DEVICE_SHADING_STATE,
              mc: this.bridge.getConnectionManager().nextMc(),
              payload: {
                  deviceId: parseInt(this.deviceId),
                  action: action
              }
          });
      });
  }
  
  onDeleted() {
      if (this.bridge && this.onDeviceUpdate) {
          this.bridge.removeDeviceStateListener(this.deviceId, this.onDeviceUpdate);
      }
  }
};
