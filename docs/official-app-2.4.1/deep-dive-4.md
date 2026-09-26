# Fourth pass: auth-key lifecycle, connection handling, validation, firmware gates, severity, terminology

The xapk was uploaded a fourth time and is byte-identical (SHA-256 `01e5d9bc…4492`). This pass covers the remaining app-side
logic that matters for Homey. **No app code was changed.** The analysis of the bridge firmware image was stopped and is not continued
here; everything below comes from the app's own JavaScript and assets.

---

## 1. Findings relevant to the Homey app

### 1.1 The auth key can be rotated from the official app [verified]

An admin can generate a new auth key:

1. `INIT_SET_AUTH_KEY` (404) `{key}`, where the key is 12 random characters from `A–Z0–9`, shown in groups of 4.
2. The bridge answers `NEW_AUTH_KEY` (405) `{key}`, and the default-admin user gets `newAuthKey`.
3. After the user confirms, `CONFIRM_SET_AUTH_KEY` (406) `{}` is answered by `NEW_AUTH_KEY_CONFIRMED` (407).
4. The app then sends `TRIGGER_BRIDGE_ACTION {tType: 3}` (**restart bridge**) and disconnects.

The audit log records this as event 304 "Auth-Key changed".

Consequences for Homey:

- After a rotation, Homey's auth-key login gets `LOGIN_DENIED` (31) on every retry.
  `lib/connection/Authenticator.ts:233` only logs "check credentials". Homey could mark the devices unavailable with a clear
  "auth key changed — use Repair" message, and stop hammering the bridge **[inferred]**. Repeated failed logins show up in
  the bridge audit log (events 107/111/112).
- A bridge restart right after a rotation is expected, so a reconnect burst at that moment is normal.

### 1.2 Connection refusal carries an error id [verified]

- `CONNECTION_START` (10) payload: `{connection_id (len > 5), device_id, device_version}`.
- `CONNECTION_CONFIRM` (11): `{client_type, client_id, client_version, connection_id}`. Homey matches this.
- `CONNECTION_DECLINED` (13): `{error_id, error_message}`, with `error_id` values:

  | error_id | meaning |
  |---|---|
  | 800 | invalid handshake |
  | 801 | open secure channel first |
  | 802 | app version declined |
  | 803 | wrong version format |
  | 804 | wrong client type |
  | 805 | remote access not allowed |
  | 806 | connection closed before reuse |

The official app **does not retry** on 802 (local connection) and otherwise reconnects after 500 ms, one attempt. If that fails
it closes and shows the login page.

`lib/connection/XComfortBridge.ts:473,544` treat every decline as a "stale session" and back off. Branching on
`error_id` would help: 802/803/804 are permanent until Homey changes, 806/800/801 are transient **[inferred]**.

### 1.3 Info severity: `type % 100` [verified]

Info entries are `{text, type, value?}`. The app computes `type % 100` per device and takes the maximum per room tab
(lights/loads/shading). A value **≥ 3 shows a warning marker** on that tab. It forces 1103 (locked), 1127 (shading locked) and
1204 to severity 3 (`type = 203`), and 1128 (shading confirmed) to 1.

Homey could expose a generic `alarm_generic`/"device problem" state whenever any info entry of a device has `type % 100 >= 3`.
That would cover unknown state, load error, overtemperature, overload and locked without mapping every code **[inferred]**.

### 1.4 How the official app groups devices in a room [verified]

This is the same classification Homey needs for "lights on" counts and room actions:

- **Lights:** `devType ∈ {100, 101}` and (`usage` undefined or `0` LIGHT).
- **Loads/appliances:** `devType ∈ {100, 101}` and `usage === 1` LOAD, **plus** water guards (497) and water sensors (499) whose
  component `usageRoom` is the room.
- **Shading:** `devType === 102`.
- **Heating-related devTypes:** `[410, 420, 430, 440, 441, 442, 450]`. Water devTypes: `[497, 498, 499]`. Room-temperature sources:
  `[410, 441, 450, 451]`.
- **Room lighting actions:** `ACTION_SWITCH_ROOM`/`ACTION_SLIDE_ROOM` update only `usage === LIGHT` devices in the app's local
  model. Heating-usage actuators are never switched manually: the FAQ says heating/cooling/sum/switch usages "cannot be manually
  controlled at all".

  **Checked against the code:** `drivers/appliance/driver.ts:22-23` offers *every* non-LIGHT usage for pairing, so heating,
  cooling, sum-heating/cooling and heating/cooling-switch actuators (usages 2, 21–28) can be paired as switchable appliances.
  `drivers/appliance/device.ts` has no usage check. Those outputs are driven by the bridge's climate function, so a Homey toggle
  either fails or gets overridden. Showing them read-only (or as "heating output" status) would match the bridge
  **[verified in the code; bridge behaviour per the FAQ]**.

### 1.5 Firmware-version feature gates used by the app [verified]

| condition (string compare on `fwVersion`) | feature |
|---|---|
| `< "2.40"` | old remote-access page |
| `> "3.03"` | `SET_TIME` includes `utcOffset` |
| `>= "3.16"` | firmware update via app offered |
| `>= "3.22"` | third-party integrations, safe restore |
| `> "3.32"` or `"3.32"` build ≥ 25 | `TRIGGER_BRIDGE_ACTION {tType: 1}` (write to flash) before FW update |
| `< "3.32"` or `"3.32"` build < 39 | backup not allowed |
| `< "4.01"` or `"4.01"` build < 66 | "firmware update available" |

Changelog milestones:

| firmware | app | added |
|---|---|---|
| 3.18 | 2.1.0 | shading, water guard, user management and notifications |
| 3.22 | 2.2.0 | Alexa/Google, pushbutton multisensor, backup & restore |
| 3.3x | 2.3 | smart scenes, cooling, external sensors, advanced regulation; 30 rooms / 50 scenes |
| 4.00 | 2.4.0 | energy monitoring with EMD3P / P1, dynamic tariffs (NO/NL/AT), weather station, smart-scene energy/weather conditions |
| 4.01 | 2.4.1 | 4 meters, EMD3P meter usages, 40 monitored loads, more tariff countries/currencies, new remote-server connection (required after Feb 2025) |

Homey could gate energy features on `fwVersion >= "4.00"` and warn when a bridge is below 4.01, because remote access
(and so dynamic tariffs) needs the new server connection.

### 1.6 Input formats and validation [verified]

- **Auth key:** 12 characters `A–Z0–9`. The sticker barcode is the plain key; the app strips spaces and accepts exactly 12 characters.
  This matches Homey's normalisation.
- **User credentials QR:** an encrypted JSON `{id: bridgeId, u: username, e: email, p: password}`. The app decrypts it with a
  static key. That key is deliberately not reproduced here. Homey should keep asking for username/password rather than decoding the QR.
- **Names:** `Ma` pattern: letters (including accented Latin, Czech/Hungarian/Nordic characters), digits, space and `+-_'/€$%.,°@„“`. Length checks are
  per form (3–50 for meters).
- **Numeric id / generic token patterns:** `^[0-9]{1,32}$` and `^[A-Za-z0-9\-_]{1,50}$`.
- **IPv4:** a strict dotted-quad regex.
- **User passwords:** minimum 8 characters, generated by the bridge by default.

---

## 2. Terminology for Homey locales

See [`terminology.md`](terminology.md). It has Eaton's own en/nl/de/no wording for presets, energy modes, shading,
LeakageStop, device states and weather values.

- Homey's custom capabilities (`app.json` → `capabilities`) currently have only `en`/`nl` titles, even though the app ships
  `da`/`de`/`no`/`sv` locales. The table gives ready-made `de` and `no` titles.
- Eaton's term for the lowest preset is **Protection** (nl *Bescherming*); Homey says *Frost/Vorst*.
- Eaton's Dutch term for the energy mode "Energy saving" is *Energie besparing*; Homey has *Energiebesparing*.
