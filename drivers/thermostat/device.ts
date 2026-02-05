import { BaseDevice } from '../../lib/BaseDevice';
import { MESSAGE_TYPES, DEVICE_TYPES } from '../../lib/XComfortProtocol';
import { DeviceStateUpdate } from '../../lib/types';

module.exports = class ThermostatDevice extends BaseDevice {
  private deviceId: string = '';
  private onDeviceUpdate: ((deviceId: string | number, state: DeviceStateUpdate) => void) | null = null;
  private onVirtualUpdate: ((deviceId: string | number, data: DeviceStateUpdate) => void) | null = null;
  private debug: boolean = false;

  async onInit() {
    try {
        await super.onInit();
    } catch (e) {
        return;
    }

    this.deviceId = this.getData().deviceId;
    this.debug = process.env.XCOMFORT_DEBUG === '1';
    
    // Register listeners
    this.registerStateListener();
    this.registerCapabilityListeners();
  }

  private registerStateListener() {
    if (!this.bridge) return;
    
    // Listen for updates from the bridge
    this.onDeviceUpdate = (_id, data) => {
        this.updateState(data);
    };
    this.bridge.addDeviceStateListener(this.deviceId, this.onDeviceUpdate);

    // Virtual Rocker Logic for RC Touch
    const device = this.bridge.getDevice(this.deviceId);
    if (device && device.devType === DEVICE_TYPES.RC_TOUCH) {
        const virtualId = parseInt(this.deviceId) + 1;
        this.log(`Device is RC_TOUCH, listening to virtual rocker ${virtualId}`);

        const triggerOn = this.homey.flow.getDeviceTriggerCard('thermostat_button_on');
        const triggerOff = this.homey.flow.getDeviceTriggerCard('thermostat_button_off');

        this.onVirtualUpdate = (_id, data) => {
            if (this.debug) {
              this.log(`Virtual Rocker update:`, data);
            }
            if (data.switch === true) {
                 triggerOn?.trigger(this, {}, {}).catch(this.error);
            } else if (data.switch === false) {
                 triggerOff?.trigger(this, {}, {}).catch(this.error);
            }
        };

        this.bridge.addDeviceStateListener(String(virtualId), this.onVirtualUpdate);
    }
  }
  
  private updateState(data: DeviceStateUpdate) {
      if (this.debug) {
          this.log(`Thermostat update:`, data);
      }
      
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
          if (this.onDeviceUpdate) {
            this.bridge.removeDeviceStateListener(this.deviceId, this.onDeviceUpdate);
          }
          
          if (this.onVirtualUpdate) {
             const virtualId = parseInt(this.deviceId) + 1;
             this.bridge.removeDeviceStateListener(String(virtualId), this.onVirtualUpdate);
          }
      }
  }
};
