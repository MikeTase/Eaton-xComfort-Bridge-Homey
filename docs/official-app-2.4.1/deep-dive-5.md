# Fifth pass: remaining payloads, Homey command audit, Android side

The xapk was uploaded a fifth time and is byte-identical (SHA-256 `01e5d9bc…4492`). With this pass **every outgoing message
type the official app sends has a documented payload** (77 message types in total). **No app code was changed.**

---

## 1. Audit: every command Homey sends vs. the official app

| Homey code | type | Homey payload | official payload | verdict |
|---|---|---|---|---|
| `XComfortBridge.switchDevice` (:647) | 281 | `{deviceId, switch: 1\|0}` | `{deviceId, switch: true\|false}` | Works in practice. The official app sends a JSON boolean; `1/0` relies on lenient parsing **[check on hardware if a switch ever NACKs]**. |
| `dimDevice` (:748) | 280 | `{deviceId, dimmvalue: 1..99}` | `{deviceId, dimmvalue}` | ✅ match |
| `switchRoom` (:667) | 284 | `{roomId, switch: 1\|0}` | `{roomId, switch: bool}`; `roomId: 0` = all | Same boolean note as 281. |
| `dimRoom` (:688) | 283 | `{roomId, dimmvalue}` | `{roomId, dimmvalue}` | ✅ match |
| `activateScene` (:699) | 285 | `{sceneId}` | `{sceneId}` | ✅ match |
| `setRemoteAccess` (:707) | 288 | `{remoteAllowed}` | `{remoteAllowed}` | ✅ match (the official app disconnects a *remote* session afterwards) |
| `controlShading` (:773) | 355 | `{deviceId, state, action, value?}` | `{deviceId, state, value?}` (`value` only for GO_TO) | Extra `action` key is not official; harmless unless the bridge is strict. Position direction and `curstate` decoding: see README §1.3/§1.4. |
| `setRoomHeatingState` (:806) | 353 | `{roomId, mode, state, setpoint, confirmed: false}` | same, but `setpoint` float with `.001` | See deep-dive-2 §A.2. The official app sends preset changes **without** `setpoint`. Homey's preset change (`drivers/thermostat/device.ts:460-461`) sends two messages, each with a setpoint. |
| `setRoomHvacState` (:821) | 353 | `{roomId, state, confirmed: true}` | `{roomId, state, confirmed: true}` | ✅ match |
| `setThermostatSetpoint` (:785) | 353 | `{deviceId, setpoint}` | *never sent by the official app* (353 is room-based) | Unused by the drivers; would likely NACK. Safe to remove or keep unused. |
| `setEnergyLoadMode` (:837) | 392 | `{meterId, loadMode, mode, controlMode, confirmed}` | `{mode, prio?, prioType?, prioDuration?}` (global) | ❌ wrong values (README §1.1) |
| `requestEnergyData` (:849) | 390, 388, 395, 397 | `{meterId}` or `{}` | 390/397 are config **writes**; 388 `{from,to}`; 395 needs full query | ❌ (README §1.2) |
| `requestDeviceStates` / initial (:322, :932) | 240 | `{}` | `{}` | ✅ match |
| initial (:327) | 242 | `{}` | `{}` (with fields it is a settings write) | ✅ match |
| heartbeat (:170-181) | 2 | every 30 s + once after connect | only after **74 s without any received frame**, ACK expected within 3 s | ✅ harmless, just more traffic |
| `Authenticator` SC init (:148, :155) | 14 | `{type_int, mc: n}` | `noAckNack` (mc `-1`) | Works; the bridge ignores the mc. |
| `Authenticator` login/token (:214-298) | 30/33/37 | as official | as official | ✅ (except the missing identity check, deep-dive-2 §A.1) |

**Not sent by Homey but sent by the official app after every login:** `SET_TIME` (271). See README §2.

---

## 2. Payloads of the remaining outgoing messages [verified]

| type | name | payload | notes |
|---|---|---|---|
| 256 | ARRANGE_DEVICES | `{deviceOrder: [deviceIds]}` | UI order only |
| 260 | ARRANGE_ROOMS | `{roomOrder: [roomIds]}` | |
| 264 | ARRANGE_SCENES | `{sceneOrder: [sceneIds]}` | |
| 259 | DELETE_ROOM | `{roomId}` | |
| 263 | DELETE_SCENE | `{sceneId}` | |
| 274 | DELETE_TIMER | `{timerId}` | |
| 335 | DELETE_TIME_PROGRAM | `{programId}` | |
| 337 | DELETE_SMART_CONDITION | `{conditionId}` | |
| 339 | DELETE_PUSHNOTE | `{pnId}` | |
| 351 | DELETE_CLIMATE_PROGRAM | `{programId}` | |
| 342 | DELETE_USER | `{userId}` | |
| 398 | DELETE_ENERGY_METER | `{meterId}` | → 400 ENERGY_METER_DELETED |
| 250 | UPDATE_BRIDGE | `{name}` | rename the bridge; → 250 echo `{name}` |
| 270 | EDIT_RF_PWD | `{pwd}` | RF (radio) system password; admin only |
| 289 | START_ACTUATOR_CONFIG | `{}` | Sent when an admin opens the actuator list; the bridge retries configuring "not yet configured" mains devices |
| 343 | SET_LOCK | `{lockId, name, active}` | Yale/Unloc lock metadata |
| 345 | SET_USER | `{userId, userName, email, password?, type, rooms, scenes, locks, controlLights, controlHeating, controlShading, controlLoads, sendNotifications, dashboardControlOptions, hidePassword?, temporaryUser, controlEnergy}` | → 367 SET_USER_ID |
| 349 | SET_INTEGRATION_STATE | `{type: 0 services-api / 1 Yale / 3 Unloc, active}` | Alexa/Google on/off (type 0) |
| 357 | GET_INTEGRATION | `{type}` | |
| 358 | UNLINK_INTEGRATION | `{type}` | |
| 244 | SAVE_CONFIG | `{description}` (≤ 48 chars) | cloud backup → 311 `{backupType, success, supportId, error, value}` |
| 245 | REQUEST_CONFIG_LIST | `{templateList: bool}` | → 312 CONFIG_LIST |
| 246 | RESTORE_CONFIG | `{supportId}` | → 313; the bridge restarts |
| 341 | DELETE_CONFIG | `{supportId}` | → 370 `{supportId, state: 0 scheduled / 1 pending / 2 resolved, success, error}` |
| 381 | SET_CLIENT | `{ipAddress, authcode, replaceId, clientId, useFixedIp}` | add/replace/edit a client bridge (master only); → 378 `{success, messageId}` |
| 383 | DELETE_CLIENT_BRIDGE | `{clientId}` | → 382 |
| 384 | ALLOCATE_BRIDGE_RESPONSIBILITY | `{bridgeId, compId: [compIds]}` | move components to a client bridge |
| 385 | SET_MASTER_CLIENT | `{active}` | enable/disable master/client mode |
| 387 | SET_ENERGY_TARIFF | `{tariffType, currency, tariffBase: 0, taxPercentage (int %), …}` | By type:<br>• fixed: `tariffFixed`<br>• time-of-use (dynamic): `country, zone, interval, markupPercentage, markupFixed, limitLow, limitHigh, useAbsCond, absCond, relCond, zip`<br>• day/night: `tariffDay, tariffNight, scheduleId`<br>**All prices and `markupPercentage` are integers × 1000.** |
| 391 | SET_ENERGY_CONTROL | `{add: [ids], delete: [ids]}` | which loads/rooms the bridge switches by tariff (same shape as 390) |
| 394 | SET_ENERGY_MONITORING_VIEW | `{viewSettings: [{…, pos}]}` | quick-view tiles |
| 120 | TEST_COMMAND | debug only | |

None of these are needed for Homey's normal operation. The relevant read-side consequences are:

- **SET_ENERGY_CONTROL/MONITORING are incremental lists.** A "refresh" must never send them (README §1.2).
- **Tariff config and prices come back scaled.** `tariffBase`, `tariffFixed`, `tariffDay`, `tariffNight`, `markupPercentage`,
  `markupFixed` and `absCond` in `eTariff` (300/386) are **÷ 1000**. `taxPercentage`, `limitLow` and `limitHigh` are plain percentages.
  This matches the official reducer (README §4.3).

---

## 3. Android side [verified]

- The manifest has one launcher activity and no deep links or custom URL schemes. There is no local HTTP/ContentProvider API besides the
  file provider, and FCM is used for push.
- The DEX contains only Capacitor/Cordova/Firebase/Play-services code (`com.atbwireless.eaton` has only `R`). There is no bridge logic in
  Java. The native library is only `libsqlc` (SQLite).
- Push notifications go from the bridge through Eaton's cloud to FCM. The app shows them from translation keys (`N<id>_TITLE`/`N<id>_TEXT`
  with parameters) and offers to reconnect to the bridge that sent them. Nothing here is usable from Homey.

---

## 4. Status of the analysis

After five passes, the official app 2.4.1 has been read completely for anything bridge-related:

- the transport, security and auth
- all 77 outgoing and all incoming message types
- the reducers, enums and info codes
- the demo data, FAQ, changelog and terminology

Further passes on the same file are unlikely to add anything. A **newer app version** (a different xapk) would be worth
diffing against these notes. The fastest way is to diff the `xt`/`Ao` enums and `en.json`.
