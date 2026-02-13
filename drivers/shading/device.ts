import { BaseDevice } from '../../lib/BaseDevice';
import { MESSAGE_TYPES } from '../../lib/XComfortProtocol';
import { DeviceStateUpdate, ShadingAction } from '../../lib/types';

module.exports = class ShadingDevice extends BaseDevice {
  private safetyActive: boolean = false;

  async onDeviceReady() {
    const settings = this.getSettings();
    const supportsPosition = settings.shRuntime !== undefined && settings.shRuntime > 0;

    if (!supportsPosition && this.hasCapability('windowcoverings_set')) {
        await this.removeCapability('windowcoverings_set').catch(this.error);
    }
    
    this.registerStateListener();
    this.registerCapabilityListeners();
  }

  private registerStateListener() {
    this.addManagedStateListener(this.deviceId, (_id, data) => {
        this.updateState(data);
    });
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
      
      if (data.shadsClosed !== undefined || data.dimmvalue !== undefined) {
          // shadsClosed is likely 0-1 or 0-100. Fallback to dimmvalue if present.
          let pos = data.shadsClosed ?? data.dimmvalue;
          if (pos !== undefined && this.hasCapability('windowcoverings_set')) {
              if (pos > 1) pos = pos / 100; // Auto-detect 0-100 scale
              pos = Math.max(0, Math.min(1, pos));
              this.setCapabilityValue('windowcoverings_set', pos).catch(this.error);
          }
      }
  }

  private registerCapabilityListeners() {
      // Position Set
      if (this.hasCapability('windowcoverings_set')) {
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
      }
      
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
      super.onDeleted();
  }
};
