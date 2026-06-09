# Eaton xComfort Bridge for Homey

This app lets Homey control Eaton xComfort devices through one or more local xComfort Bridges.

It supports light switching and dimming, shading control, thermostat setpoints and presets, door/window sensors, binary inputs, motion sensors, wall switch button events, water sensors, weather station readings, bridge and EMS energy readings, xComfort scene activation, and room-level light switching through bridge Flow actions.

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
| Wall Switch | Push button, remote control | `onoff`, single-press and double-press Flow triggers |
| Energy Meter | Bridge energy, EMS, impulse, power/current/voltage data | `measure_power`, `meter_power`, `measure_current`, `measure_voltage`, `xcomfort_pulses`, tariff/currency/history fields |
| Water Sensor | Water guard / water sensor | `alarm_water`, optional valve control |

## Dashboard Widget

The app includes a **Bridge Status** dashboard widget showing the connection state and device/room/scene counts of each configured bridge.

## Repair & Energy

- **Repair flow**: if your bridge IP address or authentication key changes, use *Repair* on any xComfort device to update the bridge connection without removing devices (so Flows keep working).
- **Homey Energy**: battery-powered sensors report their battery in Homey Energy, lights without metering use an energy approximation, and an energy meter can be marked as a whole-home (cumulative) meter in its device settings.

Requires Homey v12.3.0 or newer.

## Flow Actions

The app exposes these xComfort-specific Flow actions:

| Flow action | Purpose |
| --- | --- |
| Activate scene by name | Activates a bridge scene through autocomplete without adding a scene device. |
| Switch room lights by name | Switches all lights in an xComfort room by room name. |
| Astro period is | Condition for scene/room Flows based on Homey's sunrise and sunset location. |
| Set heating preset | Sets Frost, Economy, or Comfort on thermostat/heating devices. |
| Set water valve | Opens or closes a supported water valve. |
| Reset energy meter | Resets calculated energy on devices with `meter_power`. |
| Set energy load mode | Sets a supported xComfort energy load to Normal, Energy Saving, or Priority. |
| Refresh energy meter | Requests current meter, tariff, energy history, and energy-control data from the bridge. |
| Set bridge remote access | Allows or blocks Eaton remote access for a selected bridge without adding a diagnostics device. |

Wall switch and RC Touch button events are available as Flow triggers, including up/down and double-press variants where the bridge reports repeated button events.

Dimming actuators include Homey-side settings for minimum dim level, default on dim level, below-minimum behavior, and a LED-safe dimming profile. These settings shape Homey commands before they are sent to the bridge; they do not change hidden Eaton firmware configuration unless the bridge itself applies that behavior.

## Configuration

Open the app settings in Homey and add one or more xComfort Bridges. For each bridge, enter:

- Bridge name
- Bridge IP address or hostname
- Login mode: device auth key, or named bridge user/password
- Optional remote access preference: leave unchanged, allow, or block

The device auth key on the bridge is printed with dashes and spaces between letters and numbers, for example `XXXX-XXXX-XXXX`. You can enter it with or without dashes/spaces; the app normalizes it automatically when settings are saved. User/password mode keeps the password as entered, apart from trimming leading and trailing whitespace.

For stability, reserve each bridge IP address in your router with a DHCP reservation.

Remote access preferences are applied after the bridge connects. Leave the setting unchanged if you only want Homey to control the bridge locally.

## Adding Devices

Open Homey Devices, choose Add Device, select Eaton xComfort, then pick one of the supported addable device types. Wait for the list to load and select the devices you want to add.

Already paired devices are filtered from the pairing list where the bridge provides stable identifiers.

## Diagnostics

The settings page can generate a redacted diagnostics export for support. Bridge auth keys, user identity fields, and network addresses are removed before the JSON is shown or downloaded.

Scene diagnostics include smart, conditional, schedule, and device-count metadata when the bridge reports those fields. Energy diagnostics include separate bridge-reported meters, monitored loads, tariffs, and raw history payloads where available.

## Tested Hardware

Working status is based on local testing and community reports.

| Device | Model | Status |
| --- | --- | --- |
| Push Button 1/2/4-Fold | CTAA-0x/04 | Working |
| Push Button MultiSensor | CTSA-0x/04 | Supported as wall switch with sensor metadata when reported by the bridge |
| Remote Control 2-Channel | CHSZ-02/02 | Working |
| Heating Actuator | CHAU-01/01-10E | Working |
| Binary Input | CBEU-02/02, CBEU-02/03 | Supported |
| Motion Detector | CBMD-02/01 | Supported |
| Temperature Input | CTEU-02/01 | Supported through thermostat/sensor metadata |
| Switching Plug | CSAP-01/F5-12E | Partial; infrequent power reporting |
| Weather Station | CWS / weather station devices | Existing installations supported; hidden from new pairing |
| Bridge Energy Control / EMS | Energy, power, current, voltage, tariff, currency, history, pulses | Supported when reported by the bridge |

## Troubleshooting

- Verify the bridge works in the official Eaton app.
- Confirm the IP address/hostname and auth key in Homey app settings.
- Make sure Homey can reach the bridge on the local network.
