# Changelog

## 1.4.52 - 2026-06-05

### Improvements
- Added support for configuring multiple xComfort Bridges and pairing devices from each bridge.
- Added Binary Input and Motion Sensor drivers for additional xComfort sensor channels.
- Door/window pairing now follows the xComfort Bridge component type mapping used by the Home Assistant integration.
- Exposed heating demand as a default thermostat capability.
- Added calculated bridge/main-meter energy for Bridge Diagnostics power devices.
- Added a Flow action to switch xComfort room lights by room name via the bridge room command.
- Added a Flow action to activate xComfort scenes by name without adding scene devices.
- Debounced very fast duplicate wall switch and RC Touch button events to reduce accidental repeated Flow triggers.
- Added a delayed bridge state refresh after room light switching so Homey catches up with room/device state.
- Improved multi-bridge startup so configured bridges initialize in parallel.
- Improved sensor pairing diagnostics for binary, motion, and door/window devices.
- Improved wall switch pairing names with controlled-device context when available.
- Kept Appliance / Load, Temperature Sensor, Room Status, and xComfort Scene drivers as hidden legacy drivers for existing installations.

### Fixes
- Preserve existing bridge diagnostics state when main electrical power updates arrive separately.
- Restore Bridge Diagnostics as an addable device while keeping Room Status hidden from pairing.
- Align actuator switching with ACK-aware bridge pacing to avoid retry storms during busy bridge responses.
- Filter already paired devices from pairing lists where stable bridge identifiers are available.

## 2026-02-20

### Fixes
- Fixed crash when WebSocket is closed before connection is established (cleanup now absorbs async error events)

## 2026-02-05

### Improvements
- Pairing UX polish across device types (consistent status/empty/error messaging)
- Added room pairing templates
- Settings UI validation and show/hide auth key
- Safer connection handling and cleaner logging

### Fixes
- Room listener cleanup on delete
- Shading position updates normalized
- Build fix for actuator timestamp usage
