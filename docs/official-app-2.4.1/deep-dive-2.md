# Second pass: bridge firmware, handshake security, FAQ and demo data

This continues [`README.md`](README.md). The re-uploaded xapk is byte-identical to the first one
(SHA-256 `01e5d9bc…4492`), so this pass goes into areas the first pass skipped:

- the bundled **bridge firmware** (it can be decrypted)
- the secure-channel **identity check**
- the in-app **FAQ/help pages**
- the **demo dataset** (sensor/component payloads)
- the **cloud relay** protocol
- climate/time programs, scenes and smart conditions

As before, **no app code was changed**. Confidence labels are the same:
**[verified]**, **[inferred]** and **[check on hardware]**.

---

## A. New discrepancies and improvement opportunities for Homey

### A.1 The bridge's identity is never verified (security) [verified]

In `SC_PUBKEY` (15) the bridge sends `{device_id, device_signature, public_key}`. The official app checks, **before**
it sends the AES secret:

```
RSA-SHA256-verify(
  message   = (device_id + ":::" + public_key) with all \r and \n removed,
  signature = device_signature   (hex string, jsrsasign format),
  key       = Eaton root public key (below))
```

If the check fails, the channel is marked FAILED and nothing is sent. `lib/connection/Authenticator.ts:161-190` takes
`public_key` as-is and immediately encrypts the session key (and later the password or auth-key hash) for it.
Any host on the LAN that answers on the bridge's IP could therefore impersonate the bridge.

Eaton root public key (from `main.js`, the `rootPublicKey` option of `ATBSecureChannel`):

```
-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAu4fd/7eNKJ2xztHOfTtM
2vWXyjsyP2x2Uuh9QJFR6WQyGKhS3anNKbZgrGfMA8ZGKke8BgADCX3y4zYlwD2q
dlSMG5F1RoZNoWTeqUNDijcr1MwbKs+L7C0L4bjZit2F7ZN3WzBv2Zj9dT4M3Bey
j415JYpWbyRdbMjd5JdHGU+7vxAqBYPkfFM8+60trYpFVGIMFjJncF+38YdyU6D7
P9r8QmiFxu9I/kDfhgpdh7UGDEHg6Ue/SjPCBO98JKzIt90rU+5u+q3mPYESo0Dy
3zy1TEEYEzwHJCPwuPL3LYRW9IfBXhuxoO0eHcnG0reouzFEzI5536v5Pa+6jE2X
ywIDAQAB
-----END PUBLIC KEY-----
```

With Node this is `crypto.verify('sha256', Buffer.from(msg), rootKeyPem, Buffer.from(device_signature, 'hex'))`
**[check on hardware]**. Logging-only mode first would be the safe rollout.

The other handshake details match Homey:

- The secret is the RSA PKCS#1 v1.5 encryption (JSEncrypt, base64) of `keyHex + ":::" + ivHex`.
- Session AES is CBC with **zero padding**.
- The password hash is `sha256(salt + sha256(device_id + password))` with a 12-character random salt.
- Auth-key login uses username `"default"`.

### A.2 Floating-point fields are always sent with a fraction [verified]

Every "double" field goes through `roundDoubleValue(v)`, which returns `round(v*100)/100 + 0.001` (or `- 0.001` for negatives).
So `21` is sent as `21.001` and `21.5` as `21.501`. The bridge's JSON parser (`JEncoder`) uses typed format strings, where
`f` means float, and the official app always makes sure a decimal point is present.

Fields treated this way:

- `setpoint` (353)
- climate `modes[].value` / `valueCool`
- `floorMin` / `floorMax` (352)
- `tempOffset`, `tempPT1000Offset`, `humidityOffset`, `sadaHyst`
- smart-condition `value2`, `hysteresis`

Homey sends plain JS numbers: `drivers/thermostat/device.ts:403,460-461` go through `XComfortBridge.setRoomHeatingState`
and send e.g. `setpoint: 21`. Whole-number setpoints might be misparsed or rejected **[check on hardware]**.
The bridge also *reports* these values the same way (demo data: `10.001`, `18.001`, `21.001`), so display code should round to 2 decimals.

### A.3 Door/window `curstate` depends on the sensor mode [verified]

Door/window components have `mode` ∈ `1308` (window, ON when closed), `1309` (window, ON when opened), `1310` (door, ON when
closed), `1311` (door, ON when opened). The device `curstate`/`switch` is the **ON/OFF of the sensor channel**, so
what it means for open or closed flips with the mode.

The official app never uses `curstate` for this. It reads the **component info codes**:

| code | meaning |
|---|---|
| `1121` | window open |
| `1122` | window closed |
| `1123` | door open |
| `1124` | door closed |

The value is the time of the last change, e.g. `{text:"1121", value:"14:45"}`. Motion works the same way (`1125` motion, `1126` no motion).
`drivers/door_window_sensor/device.ts:34` hard-codes `curstate !== 1 ⇒ open`, which is only right for one pair of modes.

### A.4 Temperature input channels are prefixed at component level [verified]

The 2-channel temperature input (compType 23) reports on the **component**:

```
{text:"1222", value:"1: 22.7"}
{text:"1222", value:"2: 23.5"}
```

The value is `channel: value`. `parseFloat` gives `1` and `2`. Homey currently parses device-level info (plain values), so
this only matters if component info is ever used; strip `^\d+:\s*` first.

### A.5 "Unallowed" message types reset the link; one message at a time [verified from firmware strings]

The bridge logs `unallowed type_int(%d)! reset link`, `New Msg too early (Rx-Buf not free) on Link!`,
`Repeated Msg (Rx-Buf not free)`, `RX_ERROR (Queue-Overrun)` and `aes_decrypt error (%d)! ignored last Msg`.

- Sending a message type the bridge doesn't accept from a client (such as the response types 389/393 Homey used to send)
  **drops the whole link**, not just the message.
- The bridge has **one receive buffer per link**. A new message sent before the previous one was processed is
  discarded. This confirms that Homey's single-in-flight semaphore is required, and argues against fire-and-forget bursts.

### A.6 The bridge has a limited number of client connections [verified]

The FAQ says "Up to 4 different end devices can be connected to the Bridge at the same time". The firmware has 5 WSS
connection threads and the message `no client-connection available`. Homey uses one slot per bridge.
`ConnectionManager.disposeSocket()` (`lib/connection/ConnectionManager.ts:589`) calls `ws.close()`, which waits for a close
handshake. On a half-dead TCP link the bridge keeps the slot until its own timeout. A `terminate()` fallback after
a few seconds would free it faster **[inferred]**.

### A.7 Master/client bridge setups [verified]

Only the **master** bridge talks to apps, the cloud and Alexa. Client bridges only extend the RF range and have no user
configuration.

- A Homey user who adds a client bridge's IP will get an empty or refused connection.
- mDNS names starting with `&` are client bridges and `#` are master bridges (README §2), so pairing/settings could warn about this.
- Limits: 1 master + 2 clients, and all bridges must run the same firmware.

### A.8 Other facts useful for the Homey drivers (from the FAQ) [verified]

- **Climate:**
  - An open door/window in the room puts the room into **frost protection** while in Auto mode.
  - Default setpoints: frost 10 °C, eco 19 °C, comfort 21 °C. The UI step is 0.5 °C.
  - Without a week program the room stays in manual mode.
  - With energy control, a cheap tariff forces **comfort** and an expensive tariff forces **eco**.
- **Heating actuator `heatingSpeed` (regulation period):** 1 fast = 5 min, 2 average = 10 min, 3 slow = 15 min, very slow = 25 min.
  `heatingBackupValue` is the output % used after losing RF or sensor data for ≥ 60 min.
- **Binary inputs (`mode` on the comp):**
  - `1302` pushbutton sends one event per press per channel.
  - `1303` switch sends ON/OFF state.
  - `1304` is pushbutton on A and switch on B.
  - `1305` rocker combines A+B into up/down.
  - Only mode `1303` exposes a *state* that smart scenes can use. So a Homey "state" capability is meaningful only in switch mode.
    In pushbutton/rocker mode the events are presses, which is what the wall-switch driver models.
- **Motion sensor:** only channel A (brightness-dependent) is supported by the bridge. Component config fields are `sens`, `bright`,
  `offtime` (seconds) and `led`.
- **Dimmer `min` ("lower dimming limit")** only affects dimming via a *pushbutton*. Its allowed range comes from 303 `msLower`/`msUpper`.
  The dimming profile is `dp` (codes 1350–1376, see info-codes.md).
- **Limits:**

  | item | limit |
  |---|---|
  | RF connections | 250 outgoing + 250 incoming (instead of a device count) |
  | rooms | 30 |
  | scenes | 50 |
  | timers | 40 |
  | smart conditions per scene | 3 |
  | time-program periods per day | 6 |
  | custom users | 19 (plus default admin) |
  | energy meters | 4 (a third-party P1 can only be the main meter) |
  | monitored loads | 40 |

- **Energy tariffs:**
  - Cost = ((hourly tariff + markup % + fixed markup) × VAT) × kWh.
  - Tariff zones come from a rolling 48 h average (12 h before, the current day, 12 h after), recalculated daily at 14:00 when the next day's prices arrive.
  - Priority applies to only one load at a time. On overload, EV charging and high-load appliances are shed first.
- **Notifications the bridge can push** (useful as a model for Homey triggers): water alarm / muted / water on / off,
  empty battery and sensor timeout (daily at 12:00), room below frost, floor below min / above max, window open / closed
  (climate), heating on / off, shading safety activated / deactivated.
- **User types:** child users cannot control the water guard and get no notifications. Adult users cannot change configuration.

---

## B. Bridge firmware (`eaton_bridge_firmware_vc401_66.LIVE.enc`)

### B.1 Decrypting

The `.enc` asset is CryptoJS "passphrase" output: base64 of `Salted__` + salt + ciphertext, AES-256-CBC with the OpenSSL
MD5 key-derivation function. The passphrase is the 64-character hex string passed to `ATBAES.decrypt` in
`sendFirmwareUpdate()` in `main.js`; the IV argument is ignored in passphrase mode. The result is base64 text. Decoding it gives the
1,392,967-byte binary that the app uploads to the bridge in 512-byte chunks with `DATA_SWUPDATE` (248), after
`TRIGGER_BRIDGE_ACTION {tType: 1}` → `INIT_SWUPDATE` (247) → … → `START_SWUPDATE` (249).

```sh
tr -d '\r\n' < eaton_bridge_firmware_vc401_66.LIVE.enc \
  | openssl enc -d -aes-256-cbc -md md5 -a -A -pass pass:<hex passphrase from main.js> \
  | tr -d '\0' | base64 -d > fw.bin
```

The binary is not committed. The passphrase is not reproduced here; it is in the public app bundle.

### B.2 What it is

- **Platform:** Renesas Synergy SSP 2.6.0 (Cortex-M4, IAR), Azure RTOS ThreadX, NetX Duo 6.2.1 and FileX 6.2.1. SharkSSL
  provides TLS and the WebSocket server. A CC13xx radio sits on SPI ("CC13 SPI Thread") for the 868.3 MHz xComfort RF.
- **File layout:** a 0x4B-byte header (length field = file size), then a vector table (SP `0x200645F0`). It looks like a
  multi-segment container; the load address was not determined, so no disassembly was done.

### B.3 What the strings reveal

- **Local server:** the HTTP server accepts only the WebSocket upgrade on `/` ("Server: SharkSSL WebSocket Server"). Everything
  else gets `401 Unauthorized` (Basic realm) or `404`. **There is no local REST API.**
- **mDNS services:** `_appconn._tcp` (apps; name `xComfortBridge_%08X` or the configured name) and `_toolconn._tcp` (service
  tool, `TOOL_Bridge`). It also queries `_mbap._tcp` (Modbus TCP → Eaton EMD3P meters) and `_hwenergy._tcp` (HomeWizard).
- **Network meters are polled by the bridge itself:**
  - Modbus TCP client threads (up to 10)
  - an HTTP client for HomeWizard P1: `GET /api` then `/v1/data`, reading `active_power_w`,
    `total_power_import_kwh`, `total_power_export_kwh`, `wifi_strength`, `meter_model`, `unique_id`, `product_type`
- **Handshake errors (texts):** `Invalid connection-handshake.`, `Open SecureChannel first.`,
  `Client-version too small. Please update your client.`, `Wrong Client-version-format.`, `Wrong Client-type.`,
  `not allowed (connection_id do not match)!`. Homey's `client_version` "3.0.0" passes the version check.
- **Token errors (texts):** `Token expired (time=%d)`, `Token invalid: no Token / wrong Subject / wrong UserID / wrong cnt (%d) /
  clientID_outsub mismatch / not found in myTokens`, `Token crypto error`. Tokens are bound to the client id and user, and
  carry a counter (`cnt`). That explains why the app renews the token after every apply.
- **Log/diagnostics lines** (what `DIAGNOSTICS` 243 returns in 304): `Logins in the last %d hours: %d valid / %d invalid`,
  `RTC-Clock (last sync.: …) RTC-corr: %d (delta-ticks per day)`, `ThreadMon … lastReset: %04x`,
  `FlashWrites: Con=%d, Sec=%d, Ser=%d, Log=%d` and `SupportID: %s`.
- **Cloud (Eaton server) commands:** `GET_PRICE_FORECAST` (the day-ahead prices come from Eaton's cloud: `SPOT_%s%d_%d`,
  e.g. `SPOT_NO1_60`), `SEND_NOTIFICATION`, `ADD_EMAIL`/`REMOVE_EMAIL` (e-mail over SMTP), `SAVE_CONFIG`/`GET_CONFIG`/
  `LOAD_CONFIG`/`CONFIGSTORE` (cloud backup), `ISSUE_TOKEN`, `GET_OAUTH_URL`, `AUTHENTICATE_RESOURCE_OWNER`,
  `GET_LOCK_LIST`/`GET_LOCK_STATUS`/`OPERATE_LOCK` (Yale/August/Unloc via cloud), `GET_DEVICE_LIST`/`GET_DEVICE`/`SET_DEVICE`
  (Alexa/Google: `PHYSICAL_INTERACTION`, `PERIODIC_POLL`, `PROACTIVE_UPDATE`, `DELTADIM`), `SET_RAA_CONFIG`,
  `REMOTE_ACCESS`, `BRIDGE_RESET`, `PUSH_LOG`.
  **Dynamic tariffs therefore need remote access enabled** (the bridge fetches prices through the cloud) **[inferred]**.
- **NextGen (Thread) radio keys:** `extPanId`, `threadId`, `netKey`, `appKey`, `panId`, `channel`, `meshId`, `blePin`.
  This matches `bridgeType`/generation `2 = NEXTGEN` in the app. Future Thread-based devices will come through the same bridge.
- **JSON vocabulary:** the key tables contain every field name used in README §4, plus a few not seen in the app:
  `safetyControlId`, `controlPower`, `invOut`, `lmType`, `validity`, `allocations`, `interests`, `expirationDate`,
  `bridgeBarcode`, `templateList`.

---

## C. Cloud relay (remote access) protocol [verified]

URL `wss://xcomfortbridge.eaton.com/ws` (older hosts `live.eaton-connect.com`). Frames are JSON terminated by `\x04`.

| step | direction | message |
|---|---|---|
| 1 | server → app | `50 WEB_CONNECT_WELCOME {connection_id}` |
| 2 | app → server | `51 WEB_CONNECT_IDENTIFY {client_id, client_version, client_type}` |
| 3 | server → app | `54 ESTABLISHED` or `55 DECLINED` |
| (opt.) | app → server | `600 ONLINE_STATE {devices:[{device_id, token}]}` → `601 {devices:[{device_id, online}]}` |
| 4 | app → server | `602 DC_START {device_id, auth_type:"user", username, password:<hash>, salt, authcode:<hash of auth-key without dashes, same salt>}` or `{device_id, auth_type:"token", token}` |
| 5 | server → app | `603 DC_ESTABLISHED {link_id}` or `604 DC_DECLINED` |
| 6 | both | tunnelled bridge frames: `612 DC_OUT {link_id, enc_msg}` (or `msg` = base64 plaintext for handshake frames) and `613 DC_IN` |
| — | both | `618 PING` / `619 PONG`, `620 DC_CLOSED {link_id}`, `616/617` plugin messages `{plugin, type, payload}` |

- Inside the tunnel the normal secure-channel and auth handshake runs unchanged.
- Remote access must be allowed on the bridge (`SET_REMOTE_CONFIG`).
- This would let Homey reach a bridge in another network (e.g. a holiday home) without port forwarding **[inferred]**.
  Doing so means relying on Eaton's server and should be opt-in.

---

## D. Programs, scenes and smart conditions (payloads) [verified]

**Climate week program:** `SET_CLIMATE_PROGRAM` (350) / `heatingPrograms[]` in 300.

```jsonc
{ "programId": 0 /*new*/, "name": "…", "rooms": [roomIds],
  "schedule": [ { "day": 1..7, "periods": [ { "mode": 1|2|3, "start": <minute of day> } ] } ] }
```

- `protected: 1` marks the built-in "Default" program.
- Demo default: every day eco at 17:00 (1020), comfort at 19:00 (1140) and frost at 23:00 (1380).

**Room climate config:** `SET_ROOM_CLIMATE` (352) takes `roomId`, `programId` and `regulation`, plus these fields:

- `modes: [{mode, value, valueCool?}]` (values are floats with .001)
- `sumActuatorId`, `roomSensorId`, `floorSensorId`
- `floorMin`, `floorMax`
- `display: [power, program, humidity, window]` (booleans)
- `advRegulation`, `sumCoolingId`, `modeSensor`, `modeSwitchHeating`, `modeSwitchCooling`

The reply (`heating.ClimateConfig`) is `0` = configured OK, `-1` = pending, and other values are error codes (see the `10xx` texts).

**Time program** (condition for smart scenes, and the day/night tariff schedule): `SET_TIME_PROGRAM` (336)
`{programId, name, schedule, pType}`, with up to 6 active/inactive periods per day.

**Scene:** `SET_SCENE` (261)

```jsonc
{ "sceneId", "name", "icon", "order", "show",
  "devices": [[deviceId, value, time]], "heatingModes": [[roomId, state, mode]], "locks": [[lockId, value]],
  "pnType", "pnId",                          // attached push note
  "scActive", "scAutoActive", "scCheckTrigger", "scConditionTrigger", "scOperation" /*0 AND,1 OR*/, "scConditions": [conditionIds] }
```

- `scConditionTrigger` means "conditions can trigger the scene".
- `scCheckTrigger` means "external trigger only allowed while conditions are true".

**Smart condition:** `SET_SMART_CONDITION` (338)

```jsonc
{ "conditionId": 0, "type", "operation", "item1", "value1", "item2", "value2", "hysteresis", "minTime" }
```

- `type`: 1 lighting, 2 appliance, 3 shading, 4 water guard, 5 motion, 6 door/window, 7 temperature, 8 humidity,
  9 brightness, 10 wind, 11 rain, 12 water sensor, 13 time program, 14 power, 15 energy tariff, 16 binary, 17 sun
- `operation`: 1 =, 2 <, 3 >
- `value1`/`value2` use the `Nd` value list in enums.md (e.g. 8 motion, 11 opened, 18 sun up)
- For weather-station brightness, `value1` picks the sensor (1 left, 2 middle, 3 right)
- `minTime`: 0 s – 1 h
- The hysteresis is applied as ±½ around `value2`

**Push note:** `SET_PUSHNOTE` (340) `{pnId, title, text}`.
