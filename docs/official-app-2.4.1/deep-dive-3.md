# Third pass: device configuration, pairing, device types, notifications, demo dataset

The xapk was uploaded a third time and is byte-identical (same SHA-256). This pass covers the
app-side messages the earlier notes did not document, and saves the app's built-in demo home as a sample payload set.
**No app code was changed.** Labels are the same as before: **[verified]**, **[inferred]** and **[check on hardware]**.

---

## 1. Findings relevant to the Homey app

### 1.1 Correction: the full `devType` table [verified]

The first pass said Homey's devTypes 201/211/220 don't exist. That was wrong: the app has a second, fuller table (`wy`):

| devType | meaning | event group (`uw`) |
|---|---|---|
| 100 / 101 / 102 | switch / dimmer / shading actuator | |
| 200, 201, 202 | sensor channel, **switch** type | 0 = switch (state) |
| 210, 211 | sensor channel, **pushbutton** type | 1 = push (events) |
| 220, 221 | sensor channel, **rocker** type | 2 = rocker (up/down) |
| 300, 301 | analog output | |
| 400, 401 | analog input | |
| 410 | temperature input | |
| 420 | humidity input | |
| 430 | energy input | |
| 440 | heating actuator (HA) | |
| 441 | heating valve (HRV) | |
| 442 | multi heating actuator (MCHA) | |
| 450 | RC Touch | |
| 451 | temperature + humidity (pushbutton multisensor) | |
| 460 | router | |
| 497 | water guard | |
| 498, 499 | water sensor | |
| 510 | weather station | |

The event group tells the wall-switch driver how to read `curstate`:

- **switch** (200–202): a state (ON/OFF), e.g. binary inputs in switch mode and door/window sensors (202).
- **push** (210–211): single press events.
- **rocker** (220–221): up/down presses. Pushbuttons, remote controls, the RC Touch button and the multisensor buttons appear as 220 in
  the demo data.

Homey's 520 (`ENERGY_METER`) is not in either table; network meters are `meters[]` with `meterId`, not devices.

### 1.2 Sensors carry `temp`/`humidity` as direct fields [verified in demo data; check on hardware]

In the demo dataset, temperature inputs (410), the RC Touch (450) and multisensor channels (451) have `temp` and `humidity`
**fields on the device**. For 451 the same values also appear as info codes `1222`/`1223` (`"20.5"`, `"44.1"`).
`drivers/temperature_sensor/device.ts:24` reads only `parseInfoMetadata(device.info)`. Using `temp`/`humidity` as a
fallback would cover devices that report no info codes.

Related: the RC Touch device has `tempType` (1 = the PT1000 used as floor sensor), `screenLock`, `simpleMode` and `stbDisplay`.

### 1.3 Water sensor and leak info include timestamps [verified]

A water sensor's info is `{text:"1130", value:"11.11.2021 16:45"}`: 1130 means "OK since …" and 1129 means "Water detected since …".
The water guard device carries `wgLeakSensorId`, `curLowBatt` and `curBadSignal` as **arrays of sensor deviceIds**, plus
`defaultState` (valve type), `offUnknown`, `limeCycle` and `limeToggle`.

### 1.4 `UPDATE_DEVICE` / `UPDATE_COMP` replace the whole configuration [verified]

The official app always sends the **complete** configuration object, even for a rename. The main actuator form sends:

```
deviceId, name, icon, mode, dp, min, usage,
shType, shControl, shRuntime, shCounterRuntime, shStepDur, shSafety, shSafetyPos, shSafetyWind, shSafetyRain,
shCounterPause, shHasSlats, shSlatRuntime, shInvertOutput,
heatingType, heatingSpeed, tempRoom, heatingBackupValue, sadaHyst (float), sadaMinTime,
pidP, pidI, pidD, pidSumMax, pidPMax, pidInterval, cloudUsage, router, limescale, invOut
```

Because the full object is expected, a Homey feature such as "rename device in bridge" or "set dimmer profile" would have to
re-send every field it read from 300/290, or it could reset them **[inferred]**. The sensor, water guard and temperature-input forms send smaller,
type-specific field sets (see §3).

- PID fields range 0–200 (default 50). `pidInterval` ranges 0–10000 in steps of 10 (default 900).
- `min` (lower dimming limit) is only sent when the dimming profile `dp` is one of the "min" profiles `1360–1379`. For `1350–1359` (none /
  on-off only) the app forces `min = 0`.

---

## 2. New-feature material

### 2.1 Bridge notification categories [verified]

`SET_NOTIFICATIONS` (348) takes `{active: bool, notifications: [ids]}` and is admin only. It needs remote access, because notifications
travel through Eaton's cloud. `SEND_TEST_NOTIFICATION` (344) takes `{}`.

| id | notification | category |
|---|---|---|
| 1 | Alarm ON | water |
| 2 | Alarm silent | water |
| 3 | Water ON | water |
| 4 | Water OFF | water |
| 5 | Empty-battery updates | sensors |
| 6 | Timeout updates | sensors |
| 7 | Room temperature below frost | heating |
| 8 | Floor temperature below min | heating |
| 9 | Floor temperature above max | heating |
| 10 | Open window/door | heating |
| 11 | Closed window/door | heating |
| 12 | Climate mode OFF | heating |
| 13 | Climate mode Heating | heating |
| 16 | Climate mode Cooling | heating |
| 14 | Safety activated | shading |
| 15 | Safety deactivated | shading |
| 21 | Local connection state (group 21 = 21–24) | general |

This list is a good template for Homey Flow triggers, derived from the state Homey already receives.

### 2.2 Pairing / learn mode (for a possible "add device via Homey" flow) [verified]

- **Start:** `START_LEARNMODE` (251) with one of:
  - `{}` or `{clientId}` (the client-bridge id in master/client setups)
  - `{deviceId}` to re-configure one sensor
  - `{deviceId, compId, lmType: 1, clientId}` for a targeted learn
- **Found:** the bridge reports `FOUND_COMP` (306). The app answers `FOUND_COMP_RESPONSE` (286) `{compId, add: true|false}`, and the
  new component arrives as `ADD_COMP` (307) plus `ADD_DEVICE` (290) with `configured: false` until finished.
- **Barcode:** `BARCODE_DEVICE` (253) `{scanData, clientId}`.
- **During configuration:** `UPDATE_COMP_EDIT_STATE` (287) with `{close: true}` or edit state. `STOP_LEARNMODE` (252) `{}` ends learn mode.
- **Rewrite/delete:** `FORCE_WRITE_COMP` (278) `{compId}` rewrites config to the device. `DELETE_COMP` (276) `{compId}`.
- **Bridge state:** `learn`, `learnComp`, `learnDevice`, `learnStart`, `learnClientId` and `learnLoaded` appear in 303.

Pairing changes the bridge configuration and needs an admin user, so it should be an explicit, opt-in feature.

### 2.3 Sensor → actuator assignment semantics (read-only use in Homey) [verified]

Sensor devices (`cat: 1`) carry their bridge-side assignment:

- `controlType`:

  | value | target |
  |---|---|
  | 0 | none |
  | 1 | device (lighting) |
  | 2 | room (lighting) |
  | 3 | scene |
  | 4 | master (all) |
  | 5 | device (shading) |
  | 6 | room (shading) |
  | 7 | water safety |

- `controlId`: the target ids.
- `function`: 0 = default. 1 = with delay, uses `delaytime` in seconds (1–43200). 2 = with dim values, uses
  `dimmvalueOn`/`dimmvalueOff`. For shading targets the `SHADING_FUNCTION_*` codes apply: 10, 30, 31, 32, 33, 35, 38, 39, 40.
- `dimmtime` (0–60 s) and `state`.

This lets Homey show *what a wall switch already does in the bridge* (e.g. "Rocker 1 → Kitchen lights"). It could also warn
when a Flow duplicates a bridge-side assignment.

### 2.4 Energy-control flags on actuators [verified]

- `hasPower`: the device measures power.
- `monitorPower`: included in energy monitoring.
- `controlPower`: the load is controlled by energy control (tariff-based switching).

Homey could show "managed by bridge energy control" on such devices.

---

## 3. Device/component configuration payloads (reference)

| form | message | fields |
|---|---|---|
| Actuator (switch/dim/shade/heat) | `UPDATE_DEVICE` 254 | see §1.4 |
| Sensor channel | `UPDATE_DEVICE` 254 | `deviceId, name, icon, mode, usage, controlId, state, function, delaytime?, dimmvalueOn?, dimmvalueOff?, dimmtime, controlType, cloudUsage, router` plus temperature fields where relevant |
| Motion / door-window device | `UPDATE_DEVICE` 254 | `deviceId, name, icon, cloudUsage, router` |
| Component (motion/window/binary input) | `UPDATE_COMP` 275 | `compId, name, icon, mode, sens, bright, offtime, led, usageRoom, heatingUsage` |
| Temperature input channels | `UPDATE_DEVICE` 254 | `deviceId, name ("<comp> <ch+1>"), icon, tempRoom, tempType, tempOffset` |
| Water guard | `UPDATE_DEVICE` 254 + `UPDATE_COMP` 275 | device: `deviceId, name, icon, controlId, defaultState, offUnknown, limeCycle, limeToggle, router`; comp: `compId, name, icon, led, usageRoom`; its water sensors: `{deviceId, name, icon, ignoreUnknown: true}` |
| Room | `SET_ROOM` 257 | `roomId, name, icon, order, devices` |

---

## 4. Demo dataset: [`samples/demo-home.json`](samples/demo-home.json)

This is the official app's built-in demo home, evaluated to plain JSON. Translated names are left as placeholders like
`"<device301>"`. It has three parts:

- `infoData`: the shape of 303 (bridge info)
- `stateData`: the shape of 364 (home state)
- `homeData`: the shape of 300 (SET_ALL_DATA), with 40 comps, 76 devices, 5 rooms, 8 scenes, 3 timers, 2 heating programs,
  5 roomHeating, 4 integrations, 2 locks, 3 users, 1 push note, 2 smart conditions, 1 time program, 1 client, energy config and 2 meters

It covers most component types (1, 2, 19, 20, 23, 27, 29, 49, 65, 71, 74, 76, 77, 78, 81, 84, 85, 86, 87, 88, 89, 90). That makes it
suitable as a **test fixture** for the Homey parsers (`MessageHandler`, `parseInfoMetadata`, device classification).
The demo is hand-written by Eaton, so field presence can differ from real bridges. Treat it as representative, not exhaustive.
