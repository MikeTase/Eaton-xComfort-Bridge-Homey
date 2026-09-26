# Component type catalogue (official app 2.4.1)

From the `vi` table in `main.*.js`. `CAT` 0 = actuator, 1 = sensor. Four-digit codes (7401, 7402, …) are only
*template/demo* variants: `(I)` marks the hardware revision with an integrated rocker input (`versionHW: "1"`, `mode` 1306/1307
pushbutton/switch), and 7703 is the analog (0–10 V) mode of the dimming actuator. The bridge itself only sends the base `compType`.
1001/1002 are virtual Alexa helper types.

Device `devType` values: 100 switch, 101 dimmer, 102 shading, 200 motion, 202 switch/binary, 410 temp sensor,
440 heating actuator, 441 heating valve, 442 multi heating actuator, 450 RC Touch, 451 temp+humidity, 460 router actuator,
497 water guard, 499 water sensor, 510 weather station. The Homey constants also use 201/211/220/520; the official app defines
none of those four.

Heating devTypes that report room temperature: `[410, 441, 450, 451]`.

| compType | name | CAT | model name |
|---|---|---|---|
| 0 | xComfort Component | 1 | Eaton xComfort Component |
| 1 | Pushbutton 1-fold | 1 | Eaton xComfort Pushbutton 1-fold |
| 2 | Pushbutton 2-fold | 1 | Eaton xComfort Pushbutton 2-fold |
| 3 | Pushbutton 4-fold | 1 | Eaton xComfort Pushbutton 4-fold |
| 19 | Binary Input 230V | 1 | Eaton xComfort Binary Input 230V |
| 20 | Binary Input Battery | 1 | Eaton xComfort Binary Input Battery |
| 23 | Temperature Sensor | 1 | Eaton xComfort Temperature Sensor |
| 27 | Shading Actuator | 0 | Eaton xComfort Shading Actuator |
| 29 | Motion Sensor | 1 | Eaton xComfort Motion Sensor |
| 48 | Remote Control 2-fold | 1 | Eaton xComfort Remote Control 2-fold |
| 49 | Remote Control 12-fold | 1 | Eaton xComfort Remote Control 12-fold |
| 52 | Routing Actuator | 0 | Eaton xComfort Routing Actuator |
| 65 | Heating Valve | 1 | Eaton xComfort Heating Valve |
| 71 | Multi Heating Actuator | 0 | Eaton xComfort Multi Heating Actuator |
| 74 | Switching Actuator | 0 | Eaton xComfort Switching Actuator |
| 7401 | Switching Actuator | 0 |  |
| 7402 | Switching Actuator (I) | 0 |  |
| 76 | Door-/Window Sensor | 1 | Eaton xComfort Door-/Window Sensor |
| 77 | Dimming Actuator | 0 | Eaton xComfort Dimming Actuator |
| 7701 | Dimming Actuator | 0 |  |
| 7702 | Dimming Actuator (I) | 0 |  |
| 7703 | Analog Actuator | 0 |  |
| 78 | RC Touch | 1 | Eaton xComfort RC Touch |
| 81 | Heating Actuator | 0 | Eaton xComfort Heating Actuator |
| 8101 | Heating Actuator | 0 |  |
| 8102 | Heating Actuator | 0 |  |
| 83 | xComfort Bridge | 0 | Eaton xComfort Bridge |
| 84 | Water Guard | 0 | Eaton xComfort Water Guard |
| 85 | Water Sensor | 0 | Eaton xComfort Water Sensor |
| 86 | Shading Actuator | 0 | Eaton xComfort Shading Actuator |
| 8601 | Shading Actuator | 0 |  |
| 8602 | Shading Actuator | 0 |  |
| 87 | Pushbutton Multisensor 1-fold | 1 | Eaton xComfort Pushbutton Multisensor 1-Channel |
| 88 | Pushbutton Multisensor 2-fold | 1 | Eaton xComfort Pushbutton Multisensor 2-Channel |
| 89 | Pushbutton Multisensor 4-fold | 1 | Eaton xComfort Pushbutton Multisensor 4-Channel |
| 90 | Weather Station | 1 | Eaton xComfort Weather Station |
| 1001 | Heatmode | 0 | xComfort heatmode |
| 1002 | Binary Sensor | 0 | xComfort binary sensor |
