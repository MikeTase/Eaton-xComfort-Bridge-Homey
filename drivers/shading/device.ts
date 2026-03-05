import { BaseDevice } from '../../lib/BaseDevice';
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
          let pos = data.shadsClosed ?? data.dimmvalue;
          if (pos !== undefined && this.hasCapability('windowcoverings_set')) {
              // Values > 1 are on the 0-100 scale, normalize to 0-1
              if (pos > 1) pos = pos / 100;
              pos = Math.max(0, Math.min(1, pos));
              this.setCapabilityValue('windowcoverings_set', pos).catch(this.error);
              if (this.hasCapability('windowcoverings_state')) {
                  let state: 'up' | 'idle' | 'down' = 'idle';
                  if (pos <= 0) {
                      state = 'up';
                  } else if (pos >= 1) {
                      state = 'down';
                  }
                  this.setCapabilityValue('windowcoverings_state', state).catch(this.error);
              }
          }
      }
  }

  private registerCapabilityListeners() {
      // Position Set
      if (this.hasCapability('windowcoverings_set')) {
          this.registerCapabilityListener('windowcoverings_set', async (value) => {
              if (this.safetyActive) throw new Error('Safety lock active');
              
              const numericId = Number(this.deviceId);
              if (Number.isNaN(numericId)) throw new Error(`Invalid device ID: ${this.deviceId}`);
              if (this.hasCapability('windowcoverings_state')) {
                  const state = value <= 0 ? 'up' : value >= 1 ? 'down' : 'idle';
                  this.setCapabilityValue('windowcoverings_state', state).catch(this.error);
              }
              await this.bridge.controlShading(numericId, ShadingAction.GO_TO, value * 100);
          });
      }
      
      // State (Up/Down/Idle)
      this.registerCapabilityListener('windowcoverings_state', async (value) => {
           if (this.safetyActive) throw new Error('Safety lock active');
           
           let action = ShadingAction.STOP;
           if (value === 'up') action = ShadingAction.OPEN;
           if (value === 'down') action = ShadingAction.CLOSE;
           
           const numericId = Number(this.deviceId);
           if (Number.isNaN(numericId)) throw new Error(`Invalid device ID: ${this.deviceId}`);
           this.setCapabilityValue('windowcoverings_state', value).catch(this.error);
           await this.bridge.controlShading(numericId, action);
      });
  }
};
