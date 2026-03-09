This app lets you control Eaton xComfort devices via the xComfort Bridge.

It supports switching and dimming actuators, shading control (open/close/stop with optional position), thermostat setpoints with synced Frost/Economy/Comfort presets, door and window sensors, wall switch button events, water sensors, and bridge diagnostics.

Configuration: Open App Settings in Homey, enter the Bridge IP Address and Bridge Auth Key (found on the back of the bridge), and the app will connect automatically. Important: The auth key on the bridge is printed with dashes and spaces between letters and numbers (e.g. XXXX-XXXX-XXXX), but must be entered without dashes or spaces (e.g. XXXXXXXXXXXX) in the app settings. The app also normalizes the key automatically when saved. For stability, reserve the bridge IP in your router (DHCP reservation).

Adding devices: Open the Devices tab, click Add Device, choose Eaton xComfort, pick a device type, then wait for the list to load and select devices to add. Supported device types include Actuator or Dimmer, Shading or Blinds, Thermostat or Heating, Wall Switch, Water Sensor, and Bridge Diagnostics.

Troubleshooting: Ensure the Bridge works in the official Eaton app, verify the IP address and Auth Key, and confirm the bridge is reachable on your Homey network.
