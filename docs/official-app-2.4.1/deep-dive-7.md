# Seventh pass: device-by-device audit of the official app vs. the Homey drivers

The same xapk (SHA-256 `01e5d9bc…4492`) was checked once more, this time one Homey driver at a time. For each device type
the official tile/detail templates, the `310`/`291` reducers, the command senders and the demo data were compared with the
matching Homey driver.

**Unlike the earlier passes, this pass came with app changes.** The "Result" column says what was done.
✅ = implemented in this change, 📝 = documented only (reason given), — = nothing to change.

---

## 1. Summary per driver

| Homey driver | Official behaviour found | Result |
|---|---|---|
| `shading` | `shPos` 0 open … 100 closed (deep-dive-6 §1) | ✅ position inverted to Homey's 0 closed … 1 open; unknown (`< 0` / `> 100`) ignored; only `shPos` used |
| `shading` | Step buttons (`STEP_UP` 4 / `STEP_DOWN` 3) shown for `shControl` 3, 5, 6 and used to turn slats (`shHasSlats`) | ✅ `windowcoverings_tilt_up/down` for slat blinds and step control options (§2.1) |
| `shading` | `shControl` 1–7 decides which buttons exist; slider only with `shRuntime === 1` and `shControl >= 4` | — Homey already gates the position slider on `shRuntime === 1` |
| `shading` | Calibration (`CALIBRATION` 10, `shCalInfo` 1 done / 2 needed / 3 running) | 📝 takes 2–3 min and moves the blind end to end; left to the official app |
| `actuator` / `appliance` | Tile toggles read only `switch`; controls are **disabled when `curstate === 1`** | ✅ `curstate` no longer read as on/off for devTypes 100/101/102 (§2.2) |
| `actuator` | Dimmer slider is a plain `ion-range` (0–100); rooms report `dimmvalue` 100; motion-sensor default `dimmvalueOn` is 100 | 📝 Homey scales to 99 (1–99, like the HA library). Off by at most 1 %. Changing it needs a hardware check. |
| `actuator` | Local lock `SET_DEVICE_ACTUATOR_STATE` (380) `{deviceId, state: 11 lock / 12 unlock}`, offered for usages 0 light, 1 load, 6 water heating, 7 vehicle charger | 📝 possible future Flow action; the lock state is not reported in a documented field |
| `thermostat` | Preset pick: **one** `SET_HEATING_STATE {roomId, mode, state, confirmed: false}` **without setpoint**; auto → manual keeps heating/cooling | ✅ single message without setpoint; cooling rooms stay cooling (§2.3) |
| `thermostat` | Setpoint change `{roomId, mode: currentMode, state, setpoint, confirmed: false}`; on/off/heat/cool `{roomId, state, confirmed: true}` | — identical |
| `thermostat` | Effect regulation (`regulation 2`) setpoints are percentages | 📝 Homey clamps to °C ranges; only relevant for effect-regulated rooms |
| `motion_sensor` | Motion sensor (compType 29, devType 200) has **no `curstate`** in the demo; state is component info `1125` motion / `1126` no motion | ✅ fallback to component info; component updates forwarded (§2.4) |
| `door_window_sensor` | Component info `1121`–`1124` updated by `310` items with `compId` | ✅ those updates now reach the driver (§2.4) |
| `binary_input` | Modes `1302` pushbutton / `1303` switch; ON/OFF as `curstate` | — unchanged |
| `wall_switch` | Rocker channels (220/221) are event based | — not re-evaluated on component updates |
| `weather_station` | `1243` = `"L M R"` lux with comma thousands separators; `bType` 1/2/3 picks the main value | ✅ parsed like the official app (§2.5) |
| `temperature_sensor` | `temp`/`humidity` direct fields + `1222`/`1223` | — handled in the previous change |
| `room_status` | Room state has `lightsOn`, `loadsOn`, `windowsOpen`, `doorsOpen`, `presence`, `shadsClosed`, `wgState`, `errorState`, `power` | ✅ `loadsOn`, `shadsClosed` (new counters) and `presence` (`alarm_motion`) added |
| `room_status` | Room shading `SET_ROOM_SHADING_STATE` (354) `{roomId, state, value?}` | 📝 possible future Flow action "Control room shading" |
| `water_sensor` (guard) | `SET_DEVICE_ALARM_STATE` (356) mute, allowed only while `curstate === 3` | ✅ Flow action "Mute water guard alarm" |
| `water_sensor` (guard) | `TEST` 1 (sounds the siren), `RESET` 2, `MUTE_SECONDARY` 4; `curLowBatt[]` / `curBadSignal[]` list sensor ids; `secondaryState` 0/1 = secondary alarm muted | 📝 test/reset left to the official app; the id lists could drive per-sensor battery/signal alarms later |
| `scene` | `ACTIVATE_SCENE {sceneId}` | — identical |
| `energy_meter` | covered by deep-dive-6 §3 | — |
| `bridge_diagnostics` | Home state `heatingOn`, `coolingOn`, `lightsOn`, `loadsOn`, `windowsOpen`, `doorsOpen`, `presence`, `shadsClosed`, `wgWaterOff`, `tempOutside`, `windSpeed`, `brightness`, `rain` | — the used fields match |

---

## 2. Details of the implemented items

### 2.1 Shading control options (`shControl`) [verified]

From the control-options page (`ion-select` bound to `device.shControl`, only 1–3 without automatic runtime):

| `shControl` | label | buttons |
|---|---|---|
| 1 | Close / Open | up, down |
| 2 | Close / Stop / Open | up, stop, down |
| 3 | Close / Stop / Open + Steps | step up, up, stop, down, step down |
| 4 | Slider only | slider |
| 5 | Slider / Stop + Steps | slider, step up, stop, step down |
| 6 | Slider / Close / Stop / Open (+ steps) | slider, all buttons |
| 7 | Open / Close / Stop / Slider | slider, up, stop, down |

Options 4–7 need `shRuntime === 1` (automatic runtime) and compType `SHADING_ACTUATOR_2021`. Other shading fields shown on
that page: `shStepDur`, `shHasSlats`, `shSlatRuntime` (only with slats), `shCounterPause`, `shInvertOutput`.

Homey: `shadingSupportsSteps()` returns true for `shHasSlats === true` or `shControl ∈ {3, 5, 6}`. Blinds without
slats get the buttons titled "Step up"/"Step down". Steps are refused while the safety lock is active, like the official
app (`shSafetyActive && state < 10`).

### 2.2 Actuator `curstate` is not the on/off state [verified]

- Tile toggle and dimmer: `ngModel` = `switchValue`/`dimmValue` (from `item.switch`/`item.dimmvalue`),
  `disabled = 1 === item.curstate`.
- The `310` reducer stores `switch` and `curstate` separately and never derives one from the other.
- Every official switch command dispatches a `291` with `switch`, so actuators always carry `switch`.

Before this change, Homey's `MessageHandler` turned a `{curstate: 1}` item without `switch` into `switch: true` for
every device type, and the actuator snapshot did the same. For sensor channels (200–202) this is still correct and kept.

### 2.3 Thermostat preset change [verified]

```js
setManualMode(n) {
  if (0 !== heating.state) {
    HEATING_AUTO → HEATING_MANUAL, COOLING_AUTO → COOLING_MANUAL;
    send(SET_HEATING_STATE, {roomId, mode: n, state, confirmed: false})   // no setpoint
  }
}
```

Homey used to send two messages, `{mode: current, setpoint: cached}` and then `{mode: target, setpoint: cached}`. A message
with `mode` + `setpoint` is the official "alter setpoint" for that preset. So when the cache held a default (no `modes`
reported yet) or an outdated value, the preset's configured temperature on the bridge was overwritten. Homey still
switches a room that is off to heating when a preset is picked (the official app does not offer presets while off).

### 2.4 Component info state updates [verified]

The `310` reducer handles `{compId, info}` items by replacing the component's `info`. Motion (`1125`/`1126`) and contact
(`1121`–`1124`) states, each with the time of the change as value, live there. Homey stored them, but did not notify
any device. Now each sensor channel of the "switch" event group (devType 200–202) on that component gets an update
with `componentInfo`:

- `motion_sensor` resolves motion from `switch`/`curstate` first, then from `1125`/`1126`
- `door_window_sensor` re-evaluates with the stored component info

In the demo, motion sensor 404 (compType 29) has no `curstate` and component info `1126 "11:17"`, which gives "no motion".

### 2.5 Weather-station brightness [verified]

The official detail page does `brightness.replace(/,/g, "").split(" ")` and shows L/M/R when there are at least 2 parts.
`bType` ("Brightness Info": 1 Left, 2 Middle, 3 Right) selects the main value. Homey's parser used `replace(',', '.')`
and `parseFloat`, which turned `"12,500 8,200 950"` into 12.5 lux.

---

## 3. Still open (needs hardware or a design decision)

- Dimmer scale 99 vs 100 (§1): read `dimmvalue` 100 and send 100 at full brightness, if the bridge accepts it.
- Actuator lock state: which field reports "locked" (probably `curstate` 1, §2.2) before a lock Flow card is added.
- Water guard `curLowBatt` / `curBadSignal`: per leak-sensor battery/signal alarms.
- Room shading and calibration as Flow actions.
