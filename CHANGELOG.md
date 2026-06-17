# Changelog

## 1.7.5 - 2026-06-14

### Improvements
- Hardened Flow dropdown handling for room light, water valve, dim-level, and bridge remote-access cards so both raw values and Homey dropdown objects resolve correctly.
- Added button/component tokens to the dedicated wall-switch up/down triggers and a bridge ID token to bridge connected/disconnected triggers.

## 1.7.4 - 2026-06-14

### Improvements
- Synced package-lock metadata with the app version and pinned the patched `@grpc/grpc-js` Homey CLI transitive dependency so full `npm audit` stays clean.

## 1.7.3 - 2026-06-09

### Improvements
- Improved silent bridge-drop offline handling, startup device-list recovery, busy-bridge command handling, energy meter protocol handling, and unique per-Homey bridge identification.

## 1.7.0 - 2026-06-09

### Features
- Added "Bridge connected" and "Bridge disconnected" Flow triggers (with bridge name token) plus a "Bridge is connected" Flow condition, so Flows can react to bridge connectivity (e.g. send a notification when the bridge goes offline). Triggers fire on actual state transitions only, not on every retry during an outage.
- Added a "Dim room lights by name" Flow action that dims all dimmable lights in an xComfort room with a single bridge ROOM_DIM command; 0% switches the room lights off.

### Improvements
- Scene devices now cancel their pending button-reset timer on deletion and app shutdown.
- Energy meters skip redundant store writes when the bridge repeats an unchanged kWh reading, reducing flash wear.
- Removed duplicated room autocomplete code in the app Flow card handlers.

## 1.6.0 - 2026-06-09

### Fixes
- Fixed a connection bug where a declined bridge handshake (stale session after an abnormal drop) permanently disabled reconnection until an app restart; the app now backs off and retries automatically.
- Saving app settings no longer reconnects every bridge: only bridges whose IP, login mode, or credentials changed are restarted, so unrelated devices no longer blip offline.
- The "maximum reconnect attempts reached" event now fires once instead of on every subsequent retry.
- Removed a duplicate energy protocol constant that aliased message type 401 under two names.

### Improvements
- Added clean app/device shutdown handling (onUninit): bridge sockets, watchdogs, and timers are released, and pending energy meter readings are flushed so no kWh is lost across app updates.
- Shading wind/rain safety lock is now shown as an alarm capability with Flow support instead of marking the device unavailable; position stays visible while locked.
- Added "Energy today" and "Energy this month" insights capabilities for energy meters, parsed from the bridge's energy history.
- Scene devices now use Homey's button device class.
- Added German, Norwegian, Swedish, and Danish translations.
- Declared the local platform and LAN connectivity in the app manifest for all drivers.
- Added unit tests for command debouncing, the send semaphore, and energy history parsing.
- Halved the installed app size (8.3 MB → 4.2 MB) by optimizing all PNG images and excluding development-only files (tests, lockfile, lint config, changelog) from the app bundle.
- Removed duplicated capability helpers and redundant temperature/humidity update code in sensor devices.

## 1.5.2 - 2026-06-09

### Fixes
- Fixed shading position control by declaring the `shRuntime` setting, restoring `windowcoverings_set` support from live bridge data for already-paired shades, and re-syncing position support after bridge or setting changes.

## 1.5.1 - 2026-06-09

### Fixes
- Renamed the Energy Meter whole-home setting ID so it no longer uses Homey's reserved `energy_` prefix.

## 1.5.0 - 2026-06-09

### Improvements
- Added a Bridge Status dashboard widget, a repair flow to update bridge credentials without re-pairing, battery info for battery-powered sensors in Homey Energy, energy approximation for non-metered lights, and a whole-home cumulative meter option for energy meters.

## 1.4.80 - 2026-06-09

### Improvements
- Added targeted npm overrides for Homey CLI development dependencies so full `npm audit` no longer reports transitive dev-tool advisories.

## 1.4.79 - 2026-06-09

### Improvements
- Removed parentheses from Flow card titles to better match Homey App Store wording guidelines while keeping existing Flow card IDs unchanged.

## 1.4.78 - 2026-06-09

### Improvements
- Completed missing manifest driver SVG icons and normalized all driver icons to Homey's recommended 960x960 canvas while preserving the existing artwork.

## 1.4.77 - 2026-06-09

### Improvements
- Reduced sensitive connection details in runtime logs by avoiding bridge host/IP and named-user values in connection and authentication messages.

## 1.4.76 - 2026-06-09

### Improvements
- Added Homey App Store xlarge image assets for the app and all manifest drivers, and declared them in the app manifest.

## 1.4.75 - 2026-06-09

### Improvements
- Expanded diagnostics redaction for plural and alternate user identity, account, login, credential, and session fields in raw bridge support exports.

## 1.4.74 - 2026-06-09

### Improvements
- Broadened diagnostics redaction to remove bridge/user identity fields such as usernames, user IDs, email addresses, and phone numbers from raw support exports.
- Updated README diagnostics wording to match the broader redaction behavior.

## 1.4.73 - 2026-06-09

### Improvements
- Prevent duplicate device and room state listeners from being registered during bridge rebinds, reducing duplicate capability updates after reconnects or settings changes.
- Broadened source-control ignores for nested macOS metadata files and completed recent Homey changelog metadata.

## 1.4.72 - 2026-06-09

### Improvements
- Added Dutch translations for all remaining Homey manifest language maps, including Flow cards, custom capabilities, driver names, device settings, and tags.

## 1.4.71 - 2026-06-09

### Improvements
- Added Dutch translations for active add-device pairing pages and pairing step titles.
- Routed active pairing page headings, status messages, empty states, and add buttons through Homey i18n.
- Excluded obsolete actuator and wall-switch custom pairing pages that are no longer referenced by the manifest.

## 1.4.70 - 2026-06-09

### Fixed
- Applied Homey i18n translations to static settings-page labels instead of only dynamic settings rows.
- Awaited final energy-meter persistence during device deletion so the last calculated kWh value is not fire-and-forget.

## 1.4.69 - 2026-06-09

### Improvements
- Added Dutch locale translations for the settings page.
- Routed dynamic bridge settings labels and messages through Homey i18n with English fallbacks.
- Escaped dynamic settings translations before rendering them into custom HTML.

## 1.4.68 - 2026-06-09

### Improvements
- Aligned TypeScript Node typings with Homey's documented Node 22 runtime.

## 1.4.67 - 2026-06-09

### Improvements
- Excluded unused pairing views for hidden legacy/internal drivers from Homey publish packages.
- Hardened bridge settings normalization against non-string saved values.

## 1.4.66 - 2026-06-09

### Improvements
- Updated the runtime WebSocket dependency to the patched `ws` 8.21 line after a current npm audit.
- Refreshed Homey and lint/format dev tooling within the current Node 22-compatible setup.
- Excluded macOS `.DS_Store` files from Homey publish packages.
- Removed local pairing-cache lint suppressions in the shared driver helper.

## 1.4.65 - 2026-06-09

### Improvements
- Added handling for bridge add/info/delete lifecycle messages so device, room, and component inventory stays fresher between reconnects.
- Improved support for standalone device and room info updates from the bridge.

## 1.4.64 - 2026-06-09

### Improvements
- Added handling for bridge component-info messages so battery, signal, and mains metadata can update from standalone component payloads.
- Preserved existing component name/type metadata when later bridge updates only contain `info[]`.

## 1.4.63 - 2026-06-09

### Improvements
- Added human-readable bridge app-info messages for protocol 295 responses, improving logs and diagnostics for bridge-side errors.

## 1.4.62 - 2026-06-09

### Improvements
- Added named bridge user/password login as an alternative to the existing device auth-key flow.
- Kept legacy auth-key settings backward compatible and preserved password punctuation for user-mode logins.

## 1.4.61 - 2026-06-09

### Improvements
- Added Homey-side dimming actuator settings for minimum dim level, default on dim level, below-minimum behavior, and LED-safe dimming profile.
- Added an xComfort astro Flow condition for scene and room automations based on Homey sunrise/sunset location.
- Surfaced smart, conditional, and scheduled scene metadata in scene autocomplete, diagnostics, and existing scene device settings when reported by the bridge.
- Expanded Energy Meter pairing and status matching for bridge-reported meters and monitored energy loads.

## 1.4.60 - 2026-06-08

### Improvements
- Added per-bridge remote access preference in app settings and a Flow action to allow or block bridge remote access.
- Improved Push Button MultiSensor metadata handling by accepting numeric info codes and companion sensor metadata on same-component channels.
- Broadened Energy Meter parsing for additional power, tariff, load-mode, and energy-history field names reported by bridge integrations.

## 1.4.59 - 2026-06-08

### Improvements
- Added Wall Switch double-press Flow triggers for up/on and down/off events.
- Surfaced broader diagnostic metadata, including internal device temperature, battery, and signal data on more supported devices.
- Added Energy Meter tariff label, currency, and energy-history summary support when the bridge reports those fields.
- Extended Energy Meter refresh to request energy history while keeping the safer ACK-serialized light-command path.

## 1.4.58 - 2026-06-08

### Changes
- Added Dutch App Store readme text and a Dutch app description.

## 1.4.57 - 2026-06-08

### Changes
- Hid Weather Station from the new-device pairing flow while keeping already-installed Weather Station devices supported.

## 1.4.56 - 2026-06-08

### Improvements
- Expanded Energy Meter support with current, voltage, pulse, tariff, cost, and load-mode fields when the bridge reports them.
- Added Energy Meter Flow actions to refresh meter/tariff/control data and set supported load modes.
- Added pairing for dedicated EMS/impulse energy devices in addition to the bridge-level energy meter.
- Improved pairing metadata with richer xComfort model names, usage labels, and channel counts.
- Added advanced thermostat details for floor sensor values, floor limits, window counts, and external climate control when available.

## 1.4.55 - 2026-06-08

### Improvements
- Added Weather Station pairing with temperature, humidity, brightness, wind speed, rain, battery, and signal metadata where the bridge reports it.
- Added Energy Meter pairing for bridge power and cumulative energy readings.
- Added a redacted diagnostics export in app settings for support.
- Expanded xComfort protocol constants and device model recognition using public bridge implementations as reference.
- Improved thermostat mode handling for off, heat, auto, and cooling-capable rooms.
- Updated README and app metadata to match the current addable device list.

### Fixes
- Surface battery and radio signal metadata on supported sensor devices.
- Preserve Bridge Diagnostics as a non-pairable internal driver while keeping support diagnostics available through settings.

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
