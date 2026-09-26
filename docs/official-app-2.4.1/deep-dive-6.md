# Sixth pass: blind position direction confirmed, verification of the shipped fixes, remaining files

The xapk was uploaded a sixth time and is byte-identical (SHA-256 `01e5d9bc…4492`). This pass:

- settles the one open question from earlier passes (blind position direction), using Homey's own capability definition
- re-verifies the assumptions behind the protocol fixes shipped in commit `16451ad`
- reads the last unopened asset files

**No app code was changed.**

---

## 1. Blind position is inverted relative to Homey's convention [verified on both sides]

**Bridge side.** `shPos` 0 = fully **open**, 100 = fully **closed**. This is confirmed three ways:

1. The official position slider has the "up" icon at 0 and the "down" icon at 100 (README §1.4).
2. The FAQ smart-scene condition "Shading state: Closed − 95%" treats high values as closed.
3. Scene values: shading `value >= 100` is used for the closed/command range.

Values outside 0..100 mean "position unknown" (`JA_POS_UNKNOWN_SHORT`).

**Homey side.** `node_modules/homey-lib/assets/capability/capabilities/windowcoverings_set.json` says
*"Set the position of window coverings. 0% is closed, 100% is open"* (range 0..1).

**Homey app today** (`drivers/shading/device.ts`):

- `:194` sends `controlShading(id, GO_TO, value * 100)`, so Homey "100 % open" becomes `shPos 100`, which is **closed**.
- `:106-109` shows `shPos / 100`, so a fully open blind (`shPos 0`) shows as 0 % = "closed" in Homey.
- `:191` and `resolveWindowcoveringsState` treat position 0 as "up". That is internally consistent with the bridge, but the opposite of
  Homey's meaning.

**Recommended fix** (not applied):

- Send `value: Math.round((1 - value) * 100)`.
- Display `1 - shPos / 100`, and only for `0 <= shPos <= 100`. Ignore other values as "unknown"; today they are clamped, so e.g. an
  unknown `shPos` of 255 shows as 100 %.
- In the listener, treat Homey `1` as up/open and `0` as down/closed.

The same inversion must be applied when reading `shPos` from the snapshot.

- **Side effect:** existing Flows that set explicit positions will now act as their numbers say (currently they are inverted). Mention this in the changelog.
- **Also:** the position fallback `data.shPos ?? data.shadsClosed ?? data.dimmvalue` (`:106`) should use `shPos` only. `shadsClosed` is a room/home
  *count* of closed blinds and `dimmvalue` is not a position for devType 102.

## 2. New function: slat tilt for blinds with slats [verified]

Devices with `shHasSlats: true` (plus `shSlatRuntime`, reported `shSlatPos`) support step commands. The official app uses
`STEP_UP` (4) and `STEP_DOWN` (3) to change the slat angle; the step duration is `shStepDur` ms, and there is no absolute slat-position command.
Homey has `windowcoverings_tilt_up` / `windowcoverings_tilt_down` (buttons), which map directly to
`SET_DEVICE_SHADING_STATE {deviceId, state: 4 | 3}`.

`windowcoverings_tilt_set` would need an absolute slat command, which the protocol does not offer, so it should not be added.
`shSlatPos` could be shown read-only if needed.

## 3. Verification of the shipped fixes against the official code

| fix (commit `16451ad`) | official code | result |
|---|---|---|
| Load mode values 0/1/2 | `uc` enum + `setMode` → `{mode, prio, prioType, prioDuration}` | ✅ identical |
| Plain mode sends `prio: false` | `cancelPriority` sends `{mode, prio: false}`; `setMode` omits `prio`; the reducer forces `prio = false` for mode 0 | ✅ valid combination (both fields are official) |
| Priority keeps the current mode | `saveModePriorityModal` sends `mode: this.energyControl.mode` | ✅ identical |
| Default priority duration 60 min | official default pin is index 0 = **30 min** (`pinValues 30…300`), and the default `prioType` in the UI is climate | ⚠️ Homey uses 60 min. Allowed, but not the official default. |
| `REQUEST_TARIFF_INFO {from: midnight − 1 d, to: midnight + 2 d}` | `requestTariffInfo` | ✅ identical |
| History "today" `{from: local midnight, iType 0, interval 60, iValues: hours elapsed, vType 0, items}` | `requestHistoryData(DAY, CURRENT)` | ✅ identical (`to` deleted, `iValues = ceil((now − from)/3600)`) |
| History "month" `{from: 1st local midnight, interval 1440, iValues: days elapsed}` | `getTimestampsForTimePeriod(MONTH)` + CURRENT adjustment | ✅ identical |
| ≥ 10 s between history requests | `requestActive + 10 > now` queues the next request | ✅ |
| Price = `entry / (factor × 100)` in main units | `value / (factor × r)` with `r = 100` for CZK/HUF, shown in ct/øre/Rp. for the others | ✅ |
| Door/window mode mapping | demo: mode 1308 + curstate 0 + info 1121 (open) | ✅ consistent |
| Shading `curstate` enum, safety = 4/5 | `Rd` enum, `shSafetyActive = curstate ∈ {SAFETY_UP, SAFETY_DOWN}` | ✅ |
| Water guard leak = curstate 3/4 | dashboard templates (3 = mute possible, 4 = muted) | ✅ |
| Setpoint `+0.001` | `roundDoubleValue` | ✅ |
| Identity check algorithm | app self-test vector verifies with the same algorithm | ✅ algorithm; the production root key is unverified on hardware (log-only) |

Week views (not used by Homey) start on **Monday**: `(getDay() + 6) % 7`.

## 4. Open question that the app cannot answer

**Meter `energyDemand` / `energyFeedIn` unit.** The official app stores them (`SET_ENERGY_METER_STATE` 401 and `meters[]` in 300) but
**never displays them**, so their unit cannot be confirmed from the app. Homey treats them as cumulative kWh (`ENERGY_KEYS`).
The bridge reads HomeWizard's `total_power_import_kwh` / `total_power_export_kwh`, which suggests kWh. Check on hardware by comparing with the meter's own
display. `energyFeedIn` (PV export) is not used by Homey yet and could feed a `meter_power.exported` capability.

## 5. Remaining asset files

- **`assets/template/en.ts`**: the bridge's factory-default configuration (EasyConfig template):
  - scenes Home/Away/Morning/Night (`sceneId` 11–14, `homeScenes: [11,12,13,14]`)
  - two inactive astro timers named `"1300"`/`"1301"` (the codes for Sunrise/Sunset, `type: 1`, 06:00 daily and 20:00 at weekends)
  - the protected "Default" heating program (`programId` 17: eco 17:00, comfort 19:00, frost 23:00)
  - `msLower 0`, `msUpper 30`, `tempOutside: -100` (no outdoor sensor)

  Timer and scene names can be info codes to translate (`"1300"`, and `translate: true` on "Away").
- **`assets/build-src/*.xml`**: Android `portrait_only` flags. Nothing relevant.
- **`assets/demobridge/*.ts`**: translated names for the demo home (already covered by `samples/demo-home.json`).

With this, every file in the xapk has been examined. Further uploads of the same file cannot add information.
