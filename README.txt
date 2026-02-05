# Eaton xComfort for Homey

This app allows you to control your Eaton xComfort devices via the xComfort Bridge.

## Features

- Control switching and dimming actuators
- Control rooms (on/off + dim) with aggregated status
- Shading devices (open/close/stop + optional position)
- Thermostats / heating devices (setpoint)
- Wall switch button events as Flow triggers

## Configuration

1.  Go to **App Settings** in Homey.
2.  Enter your **Bridge IP Address**.
3.  Enter your **Bridge Auth Key** (found on the back of the bridge).
4.  The app will automatically connect.
5.  Tip: Reserve the bridge IP in your router (DHCP reservation) so it stays stable.

## Adding Devices

1.  Go to **Devices** tab.
2.  Click **+** (Add Device).
3.  Choose **Eaton xComfort**.
4.  Pick the device type.
5.  Wait for the list to load and select devices to add.

Device types:
- **Actuator / Dimmer**: switching and dimming actuators
- **Room (xComfort)**: room-level control (on/off + dim + status)
- **Shading / Blinds**: open/close/stop, plus position if supported
- **Thermostat / Heating**: setpoint control
- **Wall Switch**: input buttons and Flow triggers

## Flows

Available Flow triggers include:

- `wall_switch_pressed` (includes a raw event payload)
- `wall_switch_up`
- `wall_switch_down`
- `thermostat_button_on`
- `thermostat_button_off`

## Troubleshooting

-   Ensure the Bridge works in the official Eaton app first.
-   Check the IP address and Auth Key.
-   Make sure the bridge is reachable from your Homey’s network.
-   Check the Homey Log for connection errors.
-   If you see frequent disconnects, reboot the bridge and re-check the IP reservation.

## Development

This app is built with TypeScript.

```bash
npm install
npm run build
```

### Debug logging

Set `XCOMFORT_DEBUG=1` to enable extra device-level logging.
