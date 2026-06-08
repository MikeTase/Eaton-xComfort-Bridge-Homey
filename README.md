# Eaton xComfort Bridge for Homey

This app lets Homey control Eaton xComfort devices through one or more xComfort Bridges.

It supports light switching and dimming, shading control, thermostat setpoints and presets, door/window sensors, binary inputs, motion sensors, wall switch button events, water sensors, xComfort scene activation, and room-level light switching through bridge Flow actions.

## Supported Addable Device Types

These drivers are shown when adding devices in Homey.

| Homey driver | xComfort device | Main capabilities |
| --- | --- | --- |
| Actuator / Dimmer | Switching actuator, dimming actuator | `onoff`, `dim` |
| Shading / Blinds | Shading actuator | `windowcoverings_state`, `windowcoverings_set` |
| Thermostat / Heating | Heating actuator, heating valve, RC Touch | `measure_temperature`, `target_temperature`, `thermostat_mode`, `xcomfort_preset_mode`, `xcomfort_heating_demand` |
| Door / Window Sensor | Door/window sensor | `alarm_contact` |
| Binary Input | 230 V / battery binary input | `alarm_generic` |
| Motion Sensor | Motion / presence sensor | `alarm_motion` |
| Wall Switch | Push button, remote control | `onoff`, wall-switch Flow triggers |
| Water Sensor | Water guard / water sensor | `alarm_water`, optional valve control |

## Flow Actions

The app exposes these xComfort-specific Flow actions:

| Flow action | Purpose |
| --- | --- |
| Activate scene by name | Activates a bridge scene through autocomplete without adding a scene device. |
| Switch room lights by name | Switches all lights in an xComfort room by room name. |
| Set heating preset | Sets Frost, Economy, or Comfort on thermostat/heating devices. |
| Set water valve | Opens or closes a supported water valve. |
| Reset energy meter | Resets calculated energy on devices with `meter_power`. |

Wall switch and RC Touch button events are available as Flow triggers.

## Configuration

Open the app settings in Homey and add one or more xComfort Bridges. For each bridge, enter:

- Bridge name
- Bridge IP address or hostname
- Auth key from the bridge

The auth key on the bridge is printed with dashes and spaces between letters and numbers, for example `XXXX-XXXX-XXXX`. You can enter it with or without dashes/spaces; the app normalizes it automatically when settings are saved.

For stability, reserve each bridge IP address in your router with a DHCP reservation.

## Adding Devices

Open Homey Devices, choose Add Device, select Eaton xComfort, then pick one of the supported addable device types. Wait for the list to load and select the devices you want to add.

Already paired devices are filtered from the pairing list where the bridge provides stable identifiers.

## Tested Hardware

Working status is based on local testing and community reports.

| Device | Model | Status |
| --- | --- | --- |
| Push Button 1/2/4-Fold | CTAA-0x/04 | Working |
| Push Button MultiSensor | CTSA-0x/04 | Untested |
| Remote Control 2-Channel | CHSZ-02/02 | Working |
| Heating Actuator | CHAU-01/01-10E | Working |
| Switching Plug | CSAP-01/F5-12E | Partial; infrequent power reporting |

## Troubleshooting

- Verify the bridge works in the official Eaton app.
- Confirm the IP address/hostname and auth key in Homey app settings.
- Make sure Homey can reach the bridge on the local network.
