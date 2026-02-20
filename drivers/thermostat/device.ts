import { BaseDevice } from '../../lib/BaseDevice';
import { MESSAGE_TYPES, DEVICE_TYPES } from '../../lib/XComfortProtocol';
import { DeviceStateUpdate } from '../../lib/types';

module.exports = class ThermostatDevice extends BaseDevice {
  private debug: boolean = false;

  async onDeviceReady() {
    this.debug = process.env.XCOMFORT_DEBUG === '1';
    
    // Register listeners
    this.registerStateListener();
    this.registerCapabilityListeners();
  }

  private registerStateListener() {
    // Listen for updates from the bridge
    this.addManagedStateListener(this.deviceId, (_id, data) => {
        this.updateState(data);
    });

    // Virtual Rocker Logic for RC Touch
    const device = this.bridge.getDevice(this.deviceId);
    if (device && device.devType === DEVICE_TYPES.RC_TOUCH) {
        const virtualId = String(parseInt(this.deviceId) + 1);
        this.log(`Device is RC_TOUCH, listening to virtual rocker ${virtualId}`);

        const triggerOn = this.homey.flow.getDeviceTriggerCard('thermostat_button_on');
        const triggerOff = this.homey.flow.getDeviceTriggerCard('thermostat_button_off');

        this.addManagedStateListener(virtualId, (_id, data) => {
            if (this.debug) {
              this.log(`Virtual Rocker update:`, data);
            }
            if (data.switch === true) {
                 triggerOn?.trigger(this, {}, {}).catch(this.error);
            } else if (data.switch === false) {
                 triggerOff?.trigger(this, {}, {}).catch(this.error);
            }
        });
    }
  }
  
  private async updateState(data: DeviceStateUpdate) {
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
          if (!this.hasCapability('measure_humidity')) {
              await this.addCapability('measure_humidity').catch(this.error);
          }
          this.setCapabilityValue('measure_humidity', data.metadata.humidity).catch(this.error);
      }
  }

  private registerCapabilityListeners() {
      // Set Temperature
      this.registerCapabilityListener('target_temperature', async (value) => {
          if (!this.bridge) throw new Error('Bridge offline');
          
          const numericId = Number(this.deviceId);
          if (Number.isNaN(numericId)) throw new Error(`Invalid device ID: ${this.deviceId}`);
          await this.bridge.getConnectionManager().sendWithRetry({
              type_int: MESSAGE_TYPES.SET_HEATING_STATE,
              mc: this.bridge.getConnectionManager().nextMc(),
              payload: {
                  deviceId: numericId,
                  setpoint: value
              }
          });
      });
  }
  
  onDeleted() {
      super.onDeleted();
  }
};
