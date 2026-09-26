# Eighth pass: room climate data (cooling setpoints, room power, floor temperature, status flags)

The xapk was uploaded an eighth time and is byte-identical (SHA-256 `01e5d9bc…4492`). Every file was already read, so this pass
went back to the one area where the official app holds much more logic than Homey: the **room climate model**
(`roomHeating[]` in 300, `SET_ROOM_CLIMATE_STATE` 363, room items in 293/310).

Each finding was checked against the Homey code. The ones marked *(runtime-verified)* were reproduced by feeding the
official demo data (`samples/demo-home.json`) through Homey's own `MessageHandler`.

**No app code was changed.** The "Fix" lines are recommendations.

---

## 1. Findings that affect the Homey app

### 1.1 Room `power` has two meanings and Homey mixes them [verified, runtime-verified]

In the official reducers (`310` room items, `293`, `363`):

```js
typeof t.power < "u" && typeof t.lightsOn < "u" && (room.power = t.power)          // room total (state item)
typeof t.power < "u" && typeof t.mode    < "u" && (room.heating.power = t.power)  // heating power (climate item)
```

- `293 SET_ROOM_STATE` and `310` room items that contain `lightsOn` carry the **room's total power**.
- `363 SET_ROOM_CLIMATE_STATE` and `310` room items that contain `mode` carry the **room's heating power**.
- In 300 the room total is in `rooms[].power` and the heating power in `roomHeating[].power`. Demo room 501: 245 W total, 220 W heating.

Homey stores both as the same `room.power`:

- After the initial data, room 501 has `power` 220. `roomHeating[]` is merged after `rooms[]` and overwrites the total.
- Live updates then alternate 245 → 220 → 245 …

Effects:

- `room_status` `measure_power` jumps between two values.
- The room's integrated `meter_power` (kWh) is wrong.
- The thermostat's power sync can receive the room total.

**Fix:** keep them apart, for example `room.power` (only from items with `lightsOn`, or from `rooms[]`) and `room.heatingPower`
(from items with `mode`, from 363, or from `roomHeating[]`). Then map `room_status` → total and `thermostat` → heating.

### 1.2 Initial heating demand is read from the wrong field [verified, runtime-verified]

- `roomHeating[]` (300) names it **`currentValve`**.
- 363 and 310 name it **`valve`**. The official reducers map `valve` → `heating.currentValve`.

Homey only reads `valve`, so `xcomfort_heating_demand` (room status and thermostat) stays empty until the first live
update. The demo room 502 has `currentValve: 20`, and Homey's `valve` is `undefined`.

**Fix:** in `extractRoomUpdate`/`normalizeRoomPayload`, map `currentValve` → `valve`.

### 1.3 Floor temperature and floor limits are never filled [verified, runtime-verified]

`drivers/thermostat/device.ts` guesses field names (`floorTemp`, `floorTemperature`, …, `floorMinLimit`, `floorTempMin`,
…). **None of them exist.** The official fields are:

| meaning | field | notes |
|---|---|---|
| second temperature | `tempAlt` (300 `roomHeating[]`, 363, 310) | With `regulation 0` (room-temperature regulation) it is shown as **floor** temperature. With `regulation 1` (floor regulation) it is shown as **room** temperature. `-100` = no sensor ("Unknown"). Absent when there is no second sensor. |
| floor limits | `floorMin`, `floorMax` (300 `roomHeating[]`, `SET_ROOM_CLIMATE`) | Demo: 8 / 38 °C |
| floor too cold / too hot | `frostDanger`, `heatDanger` (0/1) | Shown as an icon class on the floor temperature and as a warning instead of the valve % when `regulation ≠ 0` |

With floor regulation, the room's `temp` is the **floor** sensor and `tempAlt` the room sensor. So Homey's
`measure_temperature` for such a room is actually a floor temperature.

**Fix:**
- `xcomfort_floor_temperature` = `tempAlt` when `regulation === 0`.
- For `regulation === 1`, swap the two (`measure_temperature` = `tempAlt`, floor = `temp`).
- Floor limits from `floorMin`/`floorMax`.
- Optionally an alarm from `frostDanger`/`heatDanger`.

### 1.4 `-100` means "no temperature" [verified]

The official app hides these values:

- Room `temp` (`null == temp || temp <= -100` → "Unknown")
- `tempAlt` (`-100 == tempAlt` → "Unknown")
- Home `tempOutside` (`-100 !== tempOutside`)

The factory template sets `tempOutside: -100` (deep-dive-6 §5).

Homey has no such check anywhere:

- `bridge_diagnostics` sets `measure_temperature` to `tempOutside`, so a bridge without an outdoor sensor shows **-100 °C**.
- The thermostat/room-status `measure_temperature` takes `temp` unfiltered.

**Fix:** ignore temperatures `<= -100` (and consider removing the capability when the value never becomes valid).

### 1.5 Cooling uses its own setpoints and ranges [verified]

Each room preset has **two** stored temperatures, `modes: [{mode, value, valueCool}]`. `value` is used while heating, `valueCool` while
cooling. The setpoint range is chosen as:

```js
state === COOLING_MANUAL ? w0["m" + currentMode + "Cool"] : w0["m" + regulation + currentMode]
```

| key | min | max | step | meaning |
|---|---|---|---|---|
| `m1Cool` | 20 | 50 | 0.5 | cooling "protection" (overheat protection) |
| `m2Cool` | 10 | 40 | 0.5 | cooling eco |
| `m3Cool` | **0** | 30 | 0.5 | cooling comfort |

(README §4.2 lists only the first two, and `m3Cool` is missing there.)

Homey reads only `modes[].value` and always clamps with the heating ranges (`MODE_SETPOINT_RANGES`). In a cooling room:

- **Wrong temperature shown:** the preset temperature shown and remembered is the heating one, e.g. eco 18 instead of 29.
- **Clamping:** a bridge setpoint of 35 °C (cooling protection) is clamped to 20 on display.
- **Wrong value sent back:** changing the setpoint sends a value clamped to the heating range.

**Fix:** store `valueCool` per mode, and while the room state is 3/4 use `valueCool` and the `m?Cool` ranges.
`syncTargetTemperatureOptions` needs the same switch.

### 1.6 Default preset values per regulation [verified]

These are used when a room climate is first configured (`heating.modes = regulation 1 ? vme : regulation 2 ? Cme : V9`):

| regulation | protection | eco | comfort | cooling (all) |
|---|---|---|---|---|
| 0 room temp (`V9`) | 10 °C | 18 °C | 21 °C | 35 / 29 / 26 °C |
| 1 floor temp (`vme`) | 15 °C | 22 °C | 25 °C | 35 / 29 / 26 °C |
| 2 effect (`Cme`) | 5 % | 50 % | 70 % | 35 / 29 / 26 |

Homey's `DEFAULT_MODE_SETPOINTS` uses frost **8** °C (official 10) and applies °C defaults to effect-regulated rooms. These
defaults only matter when the bridge has not reported `modes` yet. Since the previous change, presets no longer send a
setpoint, so they no longer reach the bridge.

### 1.7 Room status flags `climateInfoId` and `eSaving` [verified]

From the room climate header (the label order matches the `ngIf` order):

| condition | text |
|---|---|
| `eSaving` truthy | "Heating - Energy control active" (energy control is limiting the heating) |
| `!eSaving && state 0` | "Heating off" |
| `state 1` / `2` | "Heating auto" / "Heating - Manual Mode Enabled" |
| `state 3` / `4` | "Cooling auto" / "Cooling - Manual Mode enabled" |
| `climateInfoId 1` | "(External)": heating/cooling mode is set by an external mode sensor/switch |
| `climateInfoId 2` | "Warning: External Climate Mode Sensor has an unknown state" |
| `climateInfoId 3` | "Warning: Sum-Actuator used for Heating" (cooling not possible now) |

Homey's `xcomfort_external_climate_control` is derived from *configuration* fields (`modeSwitchHeating`, …). It takes the
first key that is present, so `modeSwitchHeating: 0` hides a configured `modeSwitchCooling`. The live indicator is
`climateInfoId === 1`. `eSaving` could feed a "heating limited by energy control" capability or condition.

### 1.8 When a room allows heating / cooling [verified]

`climateService.isRoomHeatingAllowed` / `isRoomCoolingAllowed`:

- **heating:** `heating.sumActuatorId || heating.modeSwitchHeating`, or any device with `tempRoom === roomId` and
  usage ∈ {2, 22, 23, 25, 101, 102} or on a heating-valve component (`HEIZ_VENTIL`)
- **cooling:** `heating.sumCoolingId || heating.modeSwitchCooling`, or any device with `tempRoom === roomId` and
  usage ∈ {21, 22, 24, 25, 101, 102}

The devType test in the official code is always true (`devType === ACTUATOR_SWITCH || ACTUATOR_DIMM`).

The UI shows heating values only when heating is allowed, and cooling values (`valueCool`) only when cooling is allowed.

Homey's `roomSupportsCooling()` also accepts usages 26/27 (heating/cooling *switch* outputs) and the fields
`sumHeatingCoolingId`/`modeSwitchHeatingCooling`, which do not exist in the official model. It is more permissive, but harmless.

---

## 2. Other notes

- 363 `SET_ROOM_CLIMATE_STATE` replaces all climate fields at once (`mode → currentMode`, `valve → currentValve`, …).
  `state` is optional there. Homey already routes 363 through the state-update path.
- `display: [power, schedule, humidity, windoorsOpen]` (booleans per room) [inferred from the template indices] controls which values the official app shows
  in the climate header. Homey could use it to hide capabilities the user disabled.
- `windoorsOpen` (363/310) [inferred] is the number of open windows/doors that affect the room climate. It is separate from the room's
  `windowsOpen`/`doorsOpen` counters.

## 3. Priority for a future change

1. §1.1 room power separation (wrong kWh)
2. §1.4 `-100` filter (visible nonsense value)
3. §1.2 `currentValve`
4. §1.3 floor temperature and limits
5. §1.5 cooling setpoints and ranges
6. §1.7 `climateInfoId`/`eSaving`
