# Eaton xComfort for Homey

This app allows you to control your Eaton xComfort devices via the xComfort Bridge.

## Configuration

1.  Go to **App Settings** in Homey.
2.  Enter your **Bridge IP Address**.
3.  Enter your **Bridge Auth Key** (found on the back of the bridge).
4.  The app will automatically connect.

## Adding Devices

1.  Go to **Devices** tab.
2.  Click **+** (Add Device).
3.  Choose **Eaton xComfort**.
4.  Select **Actuator / Dimmer** or **Wall Switch**.
5.  Wait for the list of devices to load and select the ones you want to add.

## Troubleshooting

-   Ensure the Bridge works in the official Eaton app first.
-   Check the IP address.
-   Check the Homey Log for connection errors.

## Development

This app is built with TypeScript.

```bash
npm install
npm run build
```
