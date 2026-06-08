Control Eaton xComfort devices from Homey through one or more xComfort Bridges.

Supported addable device types include Actuator / Dimmer, Shading / Blinds, Thermostat / Heating, Door / Window Sensor, Binary Input, Motion Sensor, Wall Switch, and Water Sensor.

Use Flow actions to activate xComfort scenes by name, switch all lights in an xComfort room by name, set heating presets, control supported water valves, and reset calculated energy meters.

Configuration: Open App Settings in Homey, add one or more bridges, and enter each bridge IP address or hostname plus the auth key from the bridge. Dashes and spaces in auth keys are accepted and removed automatically when saved. For stability, reserve each bridge IP in your router with a DHCP reservation.

Adding devices: Open the Devices tab, click Add Device, choose Eaton xComfort, pick a supported device type, then wait for the list to load and select devices to add.

Troubleshooting: Ensure the bridge works in the official Eaton app, verify the IP address/hostname and auth key, and confirm the bridge is reachable from Homey on the local network.
