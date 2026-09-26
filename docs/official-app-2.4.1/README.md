# Official Eaton xComfort Bridge app 2.4.1: decompilation findings

This is what we learned from taking apart the official Android app. It records what could improve the
Homey app's existing features and which new features the bridge protocol supports. **No app code was changed
because of this document.** It only records knowledge, and each item names the file it concerns so
it can be picked up later.

- **Source:** `EatonxComfortBridge_2.4.1_APKPure.xapk`, package `com.eaton.corp.xComfortBridge`,
  versionName 2.4.1, versionCode 906, min SDK 24, target SDK 34.
- **Bundled firmware:** `assets/public/assets/firmware/eaton_bridge_firmware_vc401_66.LIVE.enc`, which is bridge
  FW **4.01 build 66** (encrypted, not analysed). The app treats `fwVersion < "4.01"`, or `4.01` with `fwBuild < 66`,
  as "firmware update available".
- **Architecture:** Capacitor/Ionic (Angular) hybrid app. The Java/DEX code holds only Capacitor/Cordova plugins
  (`com.atbwireless.eaton` holds just `R`). **All bridge logic is JavaScript** in
  `assets/public/main.51854e2e350b5e4e.js` (3.4 MB minified, about 109k lines after beautifying). That file includes the
  transport library (`ATBSecureChannel`, `ATBProtocolManager`, `ATBAuthenticationManager`,
  `ATBWebConnectManager`), the Redux reducers that parse every incoming message, a complete **demo-mode
  dataset** (realistic example payloads), and all outgoing message builders.
- **Method:** unzip the xapk and base apk, run `js-beautify` on the bundles, then grep and read by hand. Enum tables and the
  info-code table were extracted mechanically. See the appendices:
  - [`enums.md`](enums.md): every protocol-relevant enum (message types, device/comp types, shading, climate, energy, …)
  - [`info-codes.md`](info-codes.md): all bridge info/error/event codes with texts and how the app renders them
  - [`component-types.md`](component-types.md): component type catalogue
  - [`deep-dive-8.md`](deep-dive-8.md): eighth pass on the **room climate model**: room power has two meanings, `currentValve`,
    floor temperature `tempAlt`/`floorMin`/`floorMax`, the `-100` "no sensor" value, cooling setpoints `valueCool`, `climateInfoId`/`eSaving`
  - [`deep-dive-7.md`](deep-dive-7.md): seventh pass, a **device-by-device audit** of every Homey driver against the official
    app, listing what was implemented (blind position/steps, actuator `curstate`, thermostat presets, motion/contact
    component info, brightness, room counters, water guard mute) and what is still open
  - [`deep-dive-6.md`](deep-dive-6.md): sixth pass, confirming the **blind position is inverted vs. Homey's 0 = closed convention**;
    also covers slat tilt, verification of the shipped fixes, and the template/default config
  - [`deep-dive-5.md`](deep-dive-5.md): fifth pass, covering an audit of every command Homey sends vs. the official payloads, the payloads
    of all remaining outgoing messages, the Android side, and the analysis status
  - [`deep-dive-4.md`](deep-dive-4.md): fourth pass, covering auth-key rotation, `CONNECTION_DECLINED` error ids, info severity, room
    grouping, firmware feature gates, input formats
  - [`terminology.md`](terminology.md): Eaton's en/nl/de/no wording for Homey locales
  - [`deep-dive-3.md`](deep-dive-3.md): third pass, covering device-config and pairing payloads, the full devType table, notification ids,
    and the demo dataset saved as [`samples/demo-home.json`](samples/demo-home.json)
  - [`deep-dive-2.md`](deep-dive-2.md): second pass, covering the decrypted bridge firmware, handshake identity check,
    float encoding, door/window modes, FAQ facts, the cloud relay protocol, and program/scene/condition payloads

Confidence labels: **[verified]** means read directly from the official code. **[inferred]** means deduced from usage,
UI texts or demo data. **[check on hardware]** means it needs confirmation against a real bridge.

---

## 1. Discrepancies found in the current Homey app (highest value first)

### 1.1 Energy load mode values are shifted [verified]

Official `ENERGY_CONTROL_SET_MODE` (392) payload:

```jsonc
{ "mode": 0|1|2,              // 0 = INACTIVE ("Energy Control deactivated"), 1 = AUTO ("Normal": loads on at normal+cheap tariff), 2 = ENERGY_SAVING (cheap tariff only)
  "prio": true|false,         // temporary priority on/off (separate from mode)
  "prioType": 0|1|2|3,        // 0 climate, 1 water heating, 2 EV charging, 3 special/high-load appliances
  "prioDuration": 30..300 }   // minutes; UI offers 30,60,…,300
```

- Energy control is **global per bridge**. The official app never sends `meterId` with this message.
- "Priority" is **not a mode value**. It is `{mode: <current mode>, prio: true, prioType, prioDuration}`, and
  cancelling it is `{mode: <current>, prio: false}`.
- Homey today (`lib/utils/energyFields.ts:196` `normalizeLoadMode`, `:220` `loadModeToProtocolValue`) maps
  `normal→0`, `energy_saving→1`, `priority→2`. That means **"normal" actually deactivates energy control,
  "energy_saving" selects Normal/AUTO, and "priority" selects Energy saving.** The incoming parse has the same
  shift. `setEnergyLoadMode` (`lib/connection/XComfortBridge.ts:831`) also sends extra keys (`meterId`, `loadMode`,
  `controlMode`, `confirmed`) that the official app does not send.
- State comes back in `SET_ENERGY_STATE` (393) with `{mode, prio, prioType, prioDuration, prioInitTime (s), loads:[{type, active, power}]}`,
  and in `SET_ALL_DATA` (300) / `SET_ENERGY_DATA` (386) as `eControl: {configured, mode, prio, prioType, prioDuration, prioInitTime}`.
  The official app derives `auto = (mode === 1)`.

### 1.2 "Refresh energy meter" sends configuration-write messages [verified]

`requestEnergyData()` (`lib/connection/XComfortBridge.ts:849`) sends `SET_ENERGY_MONITORING` (390),
`REQUEST_TARIFF_INFO` (388), `REQUEST_ENERGY_HISTORY` (395) and `SET_ENERGY_METER` (397) with only `{meterId}` or `{}`.
In the official app:

| type | real meaning | official payload |
|---|---|---|
| 390 `SET_ENERGY_MONITORING` | **edits which loads are monitored** | `{add: [ids], delete: [ids]}` (ids = deviceId / roomId / meterId) |
| 397 `SET_ENERGY_METER` | **creates** (`meterId: 0`) **or updates** a network meter | `{meterId, meterType, ipAddress, name, fixedIp, usage, mdnsName?, serialId?}` |
| 388 `REQUEST_TARIFF_INFO` | read dynamic tariff prices | `{from, to}` Unix seconds (app uses local-midnight − 1 day … + 2 days) |
| 395 `REQUEST_ENERGY_HISTORY` | read history | see §4.3; `from/iType/interval/iValues/vType/items` are required |

The official app has **no "subscribe to live data" message**. Live values arrive unsolicited:

- device power: `power` in 291 / 310 items
- room power: `power` in 293 / 310 room items
- home total: `power` in 364
- network meters: `SET_ENERGY_METER_STATE` (401) `{meterId, connectionState, power, energyDemand, energyFeedIn}`

`SET_ENERGY_DATA` (386) is **not a live power push**. It carries the energy *configuration*
(`eMonitoring`, `eControl`, `eTariff`); the comment in `lib/XComfortProtocol.ts:76` is misleading.
Recommendation: only send 388/395 with the proper payloads, and never send 390/397 from a "refresh" action.
Sending 397 with `{}` or `{meterId}` risks the bridge creating a blank meter or overwriting one **[check on hardware]**.

### 1.3 Shading `curstate` uses a different enum from the command values [verified]

The official app decodes the reported `curstate` of shading actuators with this enum:

`UNDEFINED=0, STOPPED=1, MOVING_UP=2, MOVING_DOWN=3, SAFETY_UP=4, SAFETY_DOWN=5, STOPPED_OVERTEMP=6, STOPPED_OVERLOAD=7`

The command enum is a different one: `OPEN=0, CLOSE=1, STOP=2, STEP_DOWN=3, STEP_UP=4, GO_TO=5, CALIBRATION=10, LOCK=11, UNLOCK=12, QUIT=13`.

- `drivers/shading/device.ts:202` (`resolveWindowcoveringsState`) interprets `curstate` with the *command* enum.
  So "moving up" (2) shows as idle, "moving down" (3) shows as up, and "stopped" (1) shows as down.
- **Safety lock active = `curstate === 4 || curstate === 5`** (locked open / locked closed).
  `shSafety` is only the *configuration flag* "safety function enabled" (the UI toggle "Safety function: Active/Inactive"),
  not the live lock state. `drivers/shading/device.ts:75` treats `shSafety !== 0` as "locked", so a blind whose
  safety function is merely *enabled* is reported as locked and refuses commands.
- Command naming: official `3 = STEP_DOWN`, `4 = STEP_UP`. `lib/types.ts:86` names them `STEP_OPEN = 3`,
  `STEP_CLOSE = 4`, which is the reverse direction (currently only used in the curstate mapping above).
- The live safety *reason* is `shSafetyReason`, an array of flags that can contain `1` wind, `2` rain,
  `4` timeout, `8` general (sensor/binary input), `16` bridge. Calibration state is `shCalInfo`: `1` calibrated OK,
  `2` calibration needed, `3` calibration running (the "Run calibration" button is disabled while it is 3).
  Slats: `shHasSlats`, `shSlatPos`, `shSlatRuntime`.

### 1.4 Shading position direction [verified — inverted vs. Homey, see deep-dive-6 §1]

The official slider runs 0 to 100 with the **"up" icon at 0 and the "down" icon at 100**. So `shPos` 0 means fully open and
100 means fully closed. Values outside 0..100 mean "position unknown" (`JA_POS_UNKNOWN_SHORT`). `GO_TO` is sent as
`{deviceId, state: 5, value: shPos}`. Only `shRuntime === 1` ("automatic runtime", newest-generation actuator
compType 86) supports positions. The app also shows `SHADING_GOTO_NOT_ALLOWED` otherwise, which matches the existing Homey logic.
Homey's `windowcoverings_set` uses 1 = open and 0 = closed, but `drivers/shading/device.ts:190` sends `value * 100` and reads
`shPos / 100` without inverting.

### 1.5 Water guard (LeakageStop, devType 497) alarm is readable [verified]

The water guard `curstate` values are:

| value | meaning |
|---|---|
| `0` | unknown |
| `1` | water ON (valve open) |
| `2` | water OFF |
| `3` | **leak alarm active** (the alarm can be muted) |
| `4` | **leak alarm muted** |
| `5` | test alarm active |
| `7` | over-temperature |

The icon index is `563 + curstate` (default/green/blue/red/orange).
- Room-level equivalent: `wgState` in 293/310 (3/4 = alarm), and `wgWaterOff` in 364.
- `secondaryState` (0/1) is a second mute state that applies to the "sensor status unknown" alarm.
  Other fields: `curLowBatt` (array of sensor ids with low battery), `curBadSignal` (array of sensor ids), `wgLeakSensorId`
  (array of sensors in leak state).
- Water sensor (devType 499) `curstate` values: `0` OK, `1` water detected (leakage), `2` unknown. Its info codes are `1129` "Water detected - x",
  `1130` "OK - x" and `1131` "Sensor status unknown".
- `drivers/water_sensor/device.ts:113` returns `undefined` for water guards, so `alarm_water` is never set from them.
  Using `curstate ∈ {3,4}` would give Homey a real leak alarm on the LeakageStop.

### 1.6 Energy history response format [verified]

Response `ENERGY_HISTORY` (396):

```jsonc
{ "iType": 0|1, "interval": 60|1440|1, "vType": 0|1|2, "final": true|false,
  "items": [ { "id": <deviceId|roomId|meterId>, "start": <unix s>, "factor"?: <n>, "values": [ ... ] } ] }
```

- `value * factor` gives Wh for `vType` 0 (the UI divides by 1000 to show kWh). For `vType` 1 (costs) the app also divides
  by 100.
- `iType` 1 (LONG) is monthly (`interval: 1`, one value per month).
- A response can arrive in several parts. Parts are merged by `start` offset, and `final` marks the last one.
- `lib/utils/energyHistory.ts` currently guesses keys like `today`/`month`/`kwh`, and none of those exist in this format.

### 1.7 Weather-station brightness has three values [verified]

Info code `1243` carries `"L M R"`: three lux values (left/middle/right sensor, commas as thousands separators),
split on spaces after removing commas. The device's `bType` (1/2/3) selects the "main" one.
`lib/utils/parseInfoMetadata.ts:126` parses only the first number.

### 1.8 Minor naming and protocol notes [verified]

- 295 is called `APP_INFO`. Its payload is `{info: "<code>", value?, compId?, compType?}` (see [`info-codes.md`](info-codes.md)).
  Homey calls it `ERROR_INFO`.
- 363 is `SET_ROOM_CLIMATE_STATE`: `{roomId, mode, setpoint, valve, temp, humidity, power, frostDanger, heatDanger,
  windoorsOpen, climateInfoId, tempAlt, eSaving, state?}`.
- NACKs carry an `info` field. `-100` means unknown device, `-99` device not dimmable, `-98` invalid action. A NACK sent for an
  unknown message type has `info: "INVALID MESSAGE TYPE"`.
- devType naming: the official app calls 442 `ACTUATOR_MULTI_HEATING` (Homey: `HEATING_WATER_VALVE`) and has
  460 `ACTUATOR_ROUTER`, which Homey lacks. *(Corrected in the third pass: the official `wy` table also defines the sensor-channel
  types 200/201/202 switch, 210/211 pushbutton and 220/221 rocker, so Homey's 201/211/220 are valid. Only 520 is unknown. See
  [`deep-dive-3.md`](deep-dive-3.md).)*
- The bridge also accepts `HOME_DATA` (242) *with fields* as a **settings write**: `routingEnabled`,
  `climateHRVLimitOn/Off`, `homeScenes`. Only ever send it with an empty payload as a request.

### 1.9 Found in the second pass (details in [`deep-dive-2.md`](deep-dive-2.md) §A)

- **Bridge identity is not verified.** Homey skips the `device_signature` check against Eaton's root key (`lib/connection/Authenticator.ts:161`).
- **Whole-number floats.** The official app sends every float field (`setpoint` etc.) with a fraction (`21` → `21.001`);
  Homey sends `21`.
- **Door/window state depends on the sensor mode.** The meaning of `curstate` flips with modes 1308–1311, but
  `drivers/door_window_sensor/device.ts:34` hard-codes it; info codes 1121–1124 are unambiguous.
- **The bridge resets the link on an unallowed `type_int`** and drops messages sent while its single receive buffer is busy.
- **Connection slots are limited** (4 apps). Only **master** bridges accept app connections.

---

## 2. New feature opportunities (the protocol supports them)

| Idea | Messages / payload | Notes |
|---|---|---|
| **Automatic bridge discovery / IP-change repair** | mDNS `_appconn._tcp.local.`; service name `<bridgeId>_<bridgeName>`, name prefix `#` = master bridge, `&` = client bridge; IP from `ipv4Addresses[0]` | Homey supports mDNS discovery natively in `app.json`. This would remove the need for fixed DHCP reservations. |
| **Water guard leak alarm + mute + test** | read `curstate` (§1.5); `SET_DEVICE_ALARM_STATE` (356) `{deviceId, state}` with `1` TEST, `2` RESET, `3` MUTE, `4` MUTE_SECONDARY | Mute is only possible while `curstate === 3`. MUTE_SECONDARY mutes the "sensor unknown" alarm. |
| **Shading: step up/down, calibration, safety lock/unlock/quit, room shading** | `SET_DEVICE_SHADING_STATE` (355) `{deviceId, state, value?}`; `SET_ROOM_SHADING_STATE` (354) `{roomId, state, value?}` | The official app blocks commands `< 10` while safety is active, but still allows LOCK(11)/UNLOCK(12)/QUIT(13). Calibration(10) takes 2–3 min. |
| **Shading safety alarm with reason** | `curstate` 4/5 plus `shSafetyReason` flags | e.g. `alarm_generic` plus a "reason" capability (wind/rain/timeout/general/bridge). |
| **All lights on / off (whole home)** | `ACTION_SWITCH_ROOM` (284) `{roomId: 0, switch: true/false}` | The official "ALL_DEVICES_ON/OFF" home tiles. Only offered for users with type ≥ 2 (admin). |
| **Energy control: mode + priority boost** | 392 as in §1.1 | Flow actions such as "Prioritise EV charging for 2 h" or "Set energy saving". |
| **Dynamic tariff / price** | 388 `{from, to}` then 389 `{start, interval (min), factor, unit, tariff: [[price*factor, rating], …]}` | `rating` 1 = cheap (green), 2 = normal, 3 = expensive. Price = `value / (factor * currencyFactor)`, where currencyFactor is 100 for CZK/HUF (no sub-unit) and 1 otherwise. This would give Homey a "current price" and a "cheap hour" trigger. |
| **Network energy meters (Eaton EMD3P / HomeWizard P1)** | 401 `{meterId, connectionState, power, energyDemand, energyFeedIn}`; list in 300 `meters: [{meterId, meterType, name, ipAddress, serialId, fwVersion, usage, connectionState, power, energyDemand, energyFeedIn}]` | `meterType` 1 EMD3P, 2 HomeWizard P1. `usage` 0 main/area total, 1 appliance, 2 EV, 3 PV (negative power = production), 4 heat pump, 5 special appliance, 6 water heater. |
| **Proper energy history (today/month kWh)** | 395 request (§4.3) and 396 response (§1.6) | |
| **Smart scenes: enable/disable automation, "conditions met" trigger** | `SET_SMART_SCENE_AUTO_STATE` (334) `{sceneId, scAutoActive}`; `SET_SCENE_STATE` (374) `{sceneId, scConditionsState}` (also in 310 items) | Scene fields: `scActive`, `scAutoActive`, `scCheckTrigger`, `scConditionTrigger`, `scOperation` (0 AND / 1 OR), `scConditions`, `scConditionsState`. |
| **Bridge diagnostics log + audit log** | `DIAGNOSTICS` (243) `{}` returns `SET_DIAGNOSTICS` (304) `{log: "<text with \n>"}` and `AUDIT_LOGS` (408) `{logs: [[ts, event, objId, userId, detail], …], final}` | Admin only. Event texts are `LOG_EVENT_<n>` (see info-codes.md), e.g. 107/111/112 failed-login counters, 110 bridge power-on, 206 FW update. Useful for the Homey diagnostics export and a "bridge rebooted" trigger. |
| **Firmware-update-available indicator** | 303 `fwVersion`, `fwBuild` | Compare with 4.01 build 66. |
| **Bridge clock sync** | `SET_TIME` (271) `{time: <local epoch s>, utcOffset: <JS getTimezoneOffset()*60>}` | The official app sends this **after every login** (`utcOffset` only if fw > 3.03). `SET_TIME_FORCE` (333) exists too. The bridge reports its clock in 303 `time` (local epoch s). |
| **Push Homey's location to the bridge (astro)** | `SET_ASTRO` (272) `{location: "lat;lon", srOffset, ssOffset, times, lat, lon}` | The bridge's timers use it. 303 returns `location`/`lat`/`lon`. |
| **Bridge restart** | `TRIGGER_BRIDGE_ACTION` (402) `{tType: 3}` returns 403 | `tType` 1 WRITE_TO_FLASH (used before FW update), 2 DELETE_ENERGY_TARIFF, **3 RESTART_BRIDGE**. |
| **Actuator local lock/unlock (child lock)** | `SET_DEVICE_ACTUATOR_STATE` (380) `{deviceId, state: 11 lock / 12 unlock}` | "SA_DA_LOCK/UNLOCK" buttons for switching/dimming actuators. |
| **Locks (Yale / Unloc integrations)** | `OPERATE_LOCK` (359) `{lockId, state: 1 locked / 2 unlocked}`; state in 366 `{lockId, lockState, doorState}` and 310 items | `lockState` 0 unknown / 1 locked / 2 unlocked; `doorState` 0 unknown / 1 open / 2 ajar / 3 closed. |
| **Timers: enable/disable** | `SET_TIMER` (273) with the full timer object and `active` toggled | Needs all fields (§4.7). |
| **Heating: cooling modes, frost/heat danger, window-open, energy saving** | 363 / 310 room fields | `frostDanger`, `heatDanger`, `windoorsOpen`, `eSaving`, `humidity`, `tempAlt`. |
| **Signal / battery / "sensor unknown" diagnostics** | info codes 1108 (dBm), 1111 + value (0–4), 1113–1119, 1229/1230 | |
| **Detect user permissions** | JWT `role` claim (0 guest … 4 third-party); 303 `currentUserId`, 300 `users[]` with `rooms`, `scenes`, `locks`, `controlLights/Heating/Shading/Loads/Energy` | Could warn when the configured user cannot control some rooms. |

---

## 3. Transport and session (compared with the Homey implementation)

The Homey implementation already matches most of this. The official behaviour is recorded here for reference.

- **URL:** `ws://<bridge-ip>/` (plain WebSocket, port 80). The cloud relay is `wss://xcomfortbridge.eaton.com/ws` with web-connect
  message types 50–55 and 600–620 (see enums.md). Homey does not need it.
- **Framing:** each encrypted frame ends with `\x04`. Frames without `\x04` are buffered and concatenated. Before encrypting, the app
  strips `\0` and `\x05` from the plaintext. AES key/IV come from the SC handshake (14/15/16/17; 18 = SC_INVALID).
- **Handshake:** `CONNECTION_START` (10) is answered with `CONNECTION_CONFIRM` (11) `{client_type: "shl-app", client_id, client_version}`.
  The official `client_version` is the app version ("2.4.1"). Decline codes: 800 invalid handshake, 801 open secure channel
  first, 802 app version declined, 803 bad version format, 804 wrong client type, 805 remote access not allowed,
  806 connection closed before reuse.
- **Auth:**
  1. `AUTH_LOGIN` (30) `{username, password: hash, salt}`, where the hash is `PasswordHasher.hashPassword(deviceId, password)`. The reply is 31 (denied) or 32 `{token}`.
  2. The client sends `AUTH_APPLY_TOKEN` (33) `{token}`, and the bridge answers 34 `{valid: true}`.
  3. The client sends `AUTH_RENEW_TOKEN` (37) `{token}`, the bridge answers 38 `{token}`, and the client applies the new token again.
  4. The official app **stores the renewed token and next time connects with 33 only** (no login). It falls back to login if 34 says `valid: false`.
  Also: 35/36 VERIFY_TOKEN and 39 KILL_TOKEN exist. The JWT payload carries `role` (user type).
- **After auth:** the app sends `SET_TIME` (271), then `INITIAL_DATA` (240) `{}` and `HOME_DATA` (242) `{}`. The bridge answers
  303 (bridge info), 364 (home state) and one or more 300 (`SET_ALL_DATA`; the final one has `lastItem: true`).
- **ACK/NACK:** every message with `mc` is ACKed as `{type_int: 1, ref: mc}`. An unknown type is NACKed with `info`.
  Messages with `type_int < 100` (and firmware data 247–249) are fire-and-forget. All others go through a **single in-flight
  queue**: 3 s ACK timeout, then one resend. If the second timeout expires the **connection is closed**. `WAIT4ACK` (3) extends the
  current wait once to 30 s.
- **Heartbeat:** only after **74 s without any received frame**. The app sends HEARTBEAT (2) and closes the connection if there is no ACK within 3 s.

---

## 4. Message payload reference (official app 2.4.1)

The complete numeric list is in [`enums.md`](enums.md) (`xt` = outgoing, `Ao` = incoming). This section gives payloads for the
messages most relevant to Homey.

### 4.1 Device, room and scene control

| type | name | payload |
|---|---|---|
| 280 | ACTION_SLIDE_DEVICE | `{deviceId, dimmvalue}` |
| 281 | ACTION_SWITCH_DEVICE | `{deviceId, switch: bool}` |
| 283 | ACTION_SLIDE_ROOM | `{roomId, dimmvalue}` |
| 284 | ACTION_SWITCH_ROOM | `{roomId, switch}`; `roomId: 0` = all devices |
| 285 | ACTIVATE_SCENE | `{sceneId}` |
| 354 | SET_ROOM_SHADING_STATE | `{roomId, state, value?}` (value only for GO_TO) |
| 355 | SET_DEVICE_SHADING_STATE | `{deviceId, state, value?}` |
| 356 | SET_DEVICE_ALARM_STATE | `{deviceId, state}` (1 test, 2 reset, 3 mute, 4 mute secondary) |
| 380 | SET_DEVICE_ACTUATOR_STATE | `{deviceId, state}` (11 lock, 12 unlock) |
| 334 | SET_SMART_SCENE_AUTO_STATE | `{sceneId, scAutoActive}` |
| 359 | OPERATE_LOCK | `{lockId, state}` |

The home-screen favourites array `homeScenes` (in 303) holds a `sceneId`, `lockId`, `-1` (all on), `-2` (all off) or `-3` (Unloc app link).
`0` marks an empty slot.

### 4.2 Climate

- `SET_HEATING_STATE` (353), room based:
  - setpoint change: `{roomId, mode, state, setpoint, confirmed: false}`
  - preset change: `{roomId, mode, state, confirmed: false}` (auto states switch to manual when a preset is picked)
  - on/off/heat/cool change: `{roomId, state, confirmed: true}`
- Room `heating.state`: `0` OFF, `1` HEATING_AUTO, `2` HEATING_MANUAL, `3` COOLING_AUTO, `4` COOLING_MANUAL, `5` VARIOUS.
- Presets (`mode`/`currentMode`): `1` frost, `2` eco, `3` comfort.
- Setpoint limits (`"m" + regulation + mode`):

  | regulation | mode 1 (frost) | mode 2 (eco) | mode 3 (comfort) | step |
  |---|---|---|---|---|
  | 0 room temp | 5–20 °C | 10–30 °C | 18–40 °C | 0.5 |
  | 1 floor temp | 5–20 °C | 10–30 °C | 18–40 °C | 0.5 |
  | 2 effect regulation | 0–100 % | 0–100 % | 0–100 % | 5 |
  | 3 | 5–20 °C | 10–30 °C | 18–40 °C | 0.5 |

  Extra ranges: `m49` 5–30 °C, `m59` 20–40 °C, cooling mode 1 20–50 °C, cooling mode 2 10–40 °C, cooling mode 3 0–30 °C
  (cooling uses `modes[].valueCool`, see [`deep-dive-8.md`](deep-dive-8.md) §1.5).
- **Effect regulation (`regulation 2`) setpoints are percentages, not °C.**
- Room climate config (`SET_ROOM_CLIMATE` 352, and `heating` in 300 `roomHeating[]`): `temperatureOnly`, `state`, `programId`,
  `regulation`, `modes` (setpoint per preset), `sumActuatorId`, `roomSensorId`, `floorSensorId`, `floorMin`, `floorMax`,
  `display`, `advRegulation`, `sumCoolingId`, `modeSensor`, `modeSwitchHeating`, `modeSwitchCooling`, `monitorPower`.
- Device heating fields:
  - `heatingType`: 0 undefined, 1 electric floor foil, 2 electric floor cable, 3 water floor, 4 electric radiator,
    5 electric infrared, 6 water radiator, 7 other
  - `heatingSpeed`: 1 fast, 2 average, 3 slow, 10–15 advanced
  - `tempType`: 0 not used, 1 floor, 4 room, 5 outside
  - also `tempOffset`, `pidP/I/D`, `screenLock`

### 4.3 Energy

- Request history (`REQUEST_ENERGY_HISTORY` 395):
  ```jsonc
  { "from": <unix s>, "iType": 0 /*SHORT*/ | 1 /*LONG (months)*/, "interval": 60 | 1440 | 1,
    "iValues": <count>, "vType": 0 /*kWh*/ | 1 /*costs*/ | 2 /*CO2*/, "items": [<ids>] }
  ```
  - The official app deletes `to` before sending.
  - If there is more than one id it sends `items: []`, meaning all monitored items.
  - Day view: `interval` 60, 24 values. Week: 1440 × 7. Month: 1440 × days. Year: `iType` 1, `interval` 1, 12 values.
  - Requests are throttled: at most one active request, 10 s apart.
- Monitored item ids:
  - devices with `monitorPower: true`, grouped by `usage`: LIGHT, LOAD, WATER_HEATING, VEHICLE_CHARGER, HIGH_LOAD_APPLIANCE
  - rooms with `heating.monitorPower`
  - meters, grouped by `usage`
- Energy config in 300/386:
  - `eMonitoring: {configured, viewSettings}`
  - `eControl: {…}` (§1.1)
  - `eTariff: {configured, tariffType (0 fixed / 1 time-of-use / 2 day-night), country, zone, interval (15|60 min), currency (1 EUR, 2 NOK, 3 CZK, 4 HUF, 5 CHF), tariffBase, tariffFixed, tariffDay, tariffNight, markupPercentage, markupFixed, absCond} (÷1000), taxPercentage, scheduleId, limitLow, limitHigh (percent, 50–95 / 105–150), useAbsCond, relCond, zip}`
  - Dynamic tariffs are supported for NO (5 zones), NL, AT, FR, DE, CZ, HU, IT (9 zones), CH and SK.

### 4.4 Shading device fields (from ADD_DEVICE 290 / SET_ALL_DATA)

- `shType` (symbol): 1 zip screen, 2 shutter blinds, 3 awnings, 4 vertical blinds, 5 roller blinds, 6 pleated.
- Runtime and control: `shControl`, `shRuntime` (1 = automatic, which supports positions), `shCounterRuntime`, `shStepDur`, `shCounterPause`, `shInvertOutput`.
- Safety configuration: `shSafety` (enabled), `shSafetyPos`, `shSafetyWind` (2/3/4/5/10/15/20 m/s), `shSafetyRain`.
- Live state: `shPos`, `shSlatPos`, `curstate` (§1.3), `shSafetyReason`, `shCalInfo`.
- The sensor-side shading functions have `mode` codes 10/30/31/32/33/35/38/39/40 (see `SHADING_FUNCTION_*` in en.json).

### 4.5 Device state fields seen in 291 / 310

`dimmvalue, switch, power, state, curstate, shSafetyReason, shCalInfo, shPos, shSlatPos, secondaryState, curLowBatt,
curBadSignal, wgLeakSensorId, disabled, info`.

A `switch` update in 310 also carries a top-level `disabled` flag.

### 4.6 Room / home state

- Room (293 and 310 room items): `dimmvalue, switch, lightsOn, loadsOn, windowsOpen, doorsOpen, presence, power, wgState,
  errorState, shadsClosed`, plus the heating fields from §4.2.
- Home (`SET_BRIDGE_STATE` 364): `heatingOn, coolingOn, lightsOn, loadsOn, windowsOpen, doorsOpen, presence, power,
  tempOutside, shadsClosed, wgWaterOff, windSpeed, brightness, rain`. These are counts, except `power` (W) and the
  weather values. Demo example: `{heatingOn:1, lightsOn:3, loadsOn:1, windowsOpen:1, doorsOpen:1, presence:0, power:195,
  tempOutside:12.1, shadsClosed:2, wgWaterOff:0, windSpeed:1.6, brightness:3400, rain:1, coolingOn:0}`.
  `tempOutside: -100` means no outdoor sensor. The official reducer also accepts these fields inside 303.

### 4.7 Timers (`SET_TIMER` 273)

```jsonc
{ "timerId", "controlId": [ids], "name", "active", "type": 0 fixed | 1 astro | 2 sunrise-dep | 3 sunset-dep,
  "time": "HH:MM:SS", "weekdays": [7× 0/1], "state", "dimmvalue", "dimmtime", "offset": ±seconds,
  "shControlId", "shState", "shPos" }
```

- `controlType` values: 0 none, 1 device, 2 room, 3 scene, 4 master.
- Scene and timer device values: 0–100 brightness, 100 ON, 111 on-delay, 112 on/off-delay, 113 on/off-delay with
  warning, 114 pulse, 116 blinking, 140–148 lock/unlock variants, 1001 unlock all, 1002 lock all.
- Scenes in 300 compress device, heating and lock lists as tuples:
  - `devices: [[deviceId, value, time]]`
  - `heatingModes: [[roomId, state, mode]]`
  - `locks: [[lockId, value]]`

### 4.8 Bridge info (`SET_BRIDGE_DATA` 303)

```
id, name, fwVersion, fwBuild, pwd, homeScenes, learn/learnClientId/learnLoaded, location ("lat;lon"), lat, lon,
time (local epoch s), msLower, msUpper, dataLoaded, remoteAllowed, remoteOnline, bridgeType, mcBridgeState
(0 disabled, 1 enabled, 2 master, 3 client), currentUserId, notifications, notificationsActive, routingEnabled,
climateHRVLimitOn/Off, initStage, template/templateMode, vacantActors/DPs/Rooms/Scenes/Sensors
```

- 300 can also carry `configVariant`. If it changes, the official app **discards its whole cache** and rebuilds from fresh data.
- Master/client (multi-bridge) setups: components carry `clientId`. `clients[]` in 300 have `{clientId, connectionState, fwVersion (×100), fwBuild, ipAddress, lanDelay, mdnsName}`.

### 4.9 User types / roles

| value | role |
|---|---|
| 0 | guest |
| 1 | user |
| 2 | admin |
| 3 | default admin (auth-key login) |
| 4 | third-party integration |

Features such as all-on/off, diagnostics and actuator config require type ≥ 2.
