import * as Homey from 'homey';
import { BaseDevice } from '../../lib/BaseDevice';
import { DeviceMetadata, DeviceStateUpdate, InfoEntry } from '../../lib/types';
import { parseInfoMetadata } from '../../lib/utils/parseInfoMetadata';

module.exports = class WallSwitchDevice extends BaseDevice {
  private triggerPressed: Homey.FlowCardTriggerDevice | null = null;
  private debug: boolean = false;

  async onDeviceReady() {
    this.debug = process.env.XCOMFORT_DEBUG === '1';

    if (!this.hasCapability('onoff')) {
      await this.addCapability('onoff').catch(this.error);
    }
    
    // Allow UI interaction to update state (or handle errors if strictly read-only)
    this.registerCapabilityListener('onoff', async (value) => {
        // Since wall switches are input devices, we mainly track state. 
        // Allowing this listener removes the "missing capability listener" error
        // and allows the user to manually correct the state in the app if needed.
        if (this.debug) {
          this.log('Wall switch state manually set to:', value);
        }
    });

    // Register Flow Trigger
    this.triggerPressed = this.homey.flow.getDeviceTriggerCard('wall_switch_pressed');
    const triggerUp = this.homey.flow.getDeviceTriggerCard('wall_switch_up');
    const triggerDown = this.homey.flow.getDeviceTriggerCard('wall_switch_down');

    this.addManagedStateListener(this.deviceId, (deviceId: string, state: DeviceStateUpdate) => {
        void this.applySensorMetadata(state.metadata);

        if (this.debug) {
          this.log('Switch Event:', state);
        }
        
        if (typeof state.switch === 'boolean') {
            this.setCapabilityValue('onoff', state.switch).catch(this.error);
        }

        // Trigger specific direction events
        if (state.switch === true) {
             if (triggerUp) triggerUp.trigger(this, {}, {}).catch(this.error);
        } else if (state.switch === false) {
             if (triggerDown) triggerDown.trigger(this, {}, {}).catch(this.error);
        }

        if (this.triggerPressed) {
            // Determine what data to pass to tokens.
            if (Object.keys(state).length > 0) {
                 this.triggerPressed.trigger(this, { event: JSON.stringify(state) }, {})
                    .catch(this.error);
            }
        }
    });

    await this.applyDeviceSnapshot();
  }

  private async applyDeviceSnapshot(): Promise<void> {
    const device = this.bridge.getDevice(this.deviceId);
    if (!device || !Array.isArray(device.info)) {
      return;
    }

    const metadata = parseInfoMetadata(device.info as InfoEntry[]);
    await this.applySensorMetadata(metadata);
  }

  private async applySensorMetadata(metadata?: DeviceMetadata): Promise<void> {
    if (!metadata) {
      return;
    }

    if (typeof metadata.temperature === 'number') {
      if (!this.hasCapability('measure_temperature')) {
        await this.addCapability('measure_temperature').catch(this.error);
      }
      await this.updateCapability('measure_temperature', metadata.temperature);
    }

    if (typeof metadata.humidity === 'number') {
      if (!this.hasCapability('measure_humidity')) {
        await this.addCapability('measure_humidity').catch(this.error);
      }
      await this.updateCapability('measure_humidity', metadata.humidity);
    }
  }
}
