# Bridge info / error / event codes

Source: `assets/i18n/en.json` (English texts), the `cu` render-kind table and the `wi` icon table in `main.*.js` of the official app 2.4.1.

The bridge sends `info: [{text: "<code>", type: <n>, value?: <v>}]` arrays on devices (291/292/310), components (308), rooms (294),
and `APP_INFO` (295) messages `{info: "<code>", value?, compId?, compType?}`. `kind` tells how the official app renders a code:
`text` = fixed string, `value` = string with `{{value}}`, `icon` = status icon (no text), `icon-value` = icon + raw value,
`icon-detail` = icon chosen by `code+value`, `specific` = custom handling, `none` = hidden.

**Note:** the app renders 1121–1126 as *icons* (door/window/motion state), even though en.json also has a text for 1121 (`{{value}}%`).
For door/window sensors the official app treats `1121`/`1123` as **open** and `1122`/`1124` as **closed**; motion sensors report `1125` (motion) / `1126` (no motion).

| code | kind | English text | icon |
|---|---|---|---|
| 800 |  | Invalid connection-handshake. |  |
| 801 |  | Open secure channel first. |  |
| 802 |  | Connection was declined for your App version. You have to update your xComfort-Bridge App before connecting again! |  |
| 803 |  | Wrong Client-version-format. |  |
| 804 |  | Wrong Client-type. |  |
| 805 |  | Remote-Access not allowed. |  |
| 806 |  | Connection closed before reuse. |  |
| 1000 | text | Bad device type |  |
| 1001 | text | Already existing device |  |
| 1002 | text | ERROR: Unknown device |  |
| 1003 | text | ERROR: Unknown room |  |
| 1004 | text | ERROR: Failed creating room |  |
| 1005 | text | ERROR: Failed creating device |  |
| 1006 | text | ERROR: Failed creating scene |  |
| 1007 | text | ERROR: No device/room/scene with this ID |  |
| 1008 | text | ERROR: Unknown scene |  |
| 1009 | text | Room not dimmable |  |
| 1010 | text | Device not dimmable |  |
| 1011 | text | Learningmode Start |  |
| 1012 | text | Learningmode End |  |
| 1013 | value | Infinite toggle (dev: {{value}}) start |  |
| 1014 | text | Infinite toggle end |  |
| 1015 | text | Invalid action |  |
| 1016 | text | Barcode Scan data invalid |  |
| 1017 | value | ERROR: Failed updating room (ID: {{value}}) |  |
| 1018 | value | ERROR: Failed updating scene (ID: {{value}}) |  |
| 1019 | text | Not allowed while Learning Mode is active. |  |
| 1020 | text | A Dimming Actuator has been found! |  |
| 1021 | text | A Switching Actuator  has been found! |  |
| 1022 | text | The device is protected by a different Password. It has been removed. |  |
| 1023 | value | Device (Serial Number: {{value}}) removed because of unsupported device type. |  |
| 1024 | text | ERROR: Failed creating timer. |  |
| 1025 | value | ERROR: Failed updating timer (ID: {{value}}) |  |
| 1026 | text | ERROR: No room/scene with this controlID. |  |
| 1027 | text | ERROR: Unknown timer |  |
| 1028 | text | ERROR: Sensor is protected by an unknown password. |  |
| 1029 | value | Device (ID: {{value}}) removed because of unknown password. |  |
| 1030 | value | Device (ID: {{value}}) removed because of unsupported device type. |  |
| 1031 | text | ERROR: Unknown Device |  |
| 1032 | text | ERROR: Failed creating Device |  |
| 1033 | compType | A new {{type}} was added to your xComfort Bridge (Serial number: {{value}}). |  |
| 1034 | value | Operate '<name>' (Serial number: {{value}}) to finalize configuration. |  |
| 1035 | text | Warning: Mode not editable because device is already used. |  |
| 1036 | value | Device (ID: {{value}}) was removed after Mode update. |  |
| 1037 | text | Device(s) skipped because of Sensor-Overflow. |  |
| 1038 | text | ERROR: Failed creating heating program |  |
| 1039 | value | ERROR: Failed updating heating program (ID: {{value}}) |  |
| 1040 | text | ERROR: Unknown heating program |  |
| 1041 | text | ERROR: Failed creating climate zone |  |
| 1042 | value | ERROR: Failed updating climate zone (ID: {{value}}) |  |
| 1043 | text | ERROR: Unknown climate zone |  |
| 1044 | text | Not configured |  |
| 1045 | text | For effect regulation to be configured the room needs to have only Heating actuators with a firmware version greater than V1.50! Having no or other Heating devices the effect regulation is not possible! |  |
| 1046 | text | No floor sensor at room control |  |
| 1047 | text | No room sensor defined |  |
| 1048 | text | No floor sensor defined |  |
| 1049 | value | SupportID: {{value}} |  |
| 1050 | text | RCT maybe has old Firmware |  |
| 1051 | text | RCT needs new Firmware |  |
| 1052 | specific | Error when communicating with Server ({{value}}). Please try again later! |  |
| 1053 | text | There was an error with the data reception (Not prepared). Please try again! |  |
| 1054 | text | There was an error with the data reception (No data). Please try again! |  |
| 1055 | text | There was an error with the data reception (Data Overflow). Please try again! |  |
| 1056 | text | There was an error when using this backup. Please try again! |  |
| 1057 | specific | The backup could not be saved on the server ({{value}}). Please try again! |  |
| 1058 | text | Authenication failed. Please try again! |  |
| 1059 | text | A Shading Actuator has been found! |  |
| 1060 | text | A Water-Safety Device has been found! |  |
| 1061 | text | The Watersensor cannot be assigned to this LeakageStop because max. number of assignments is already reached. |  |
| 1062 | text | There was an error when trying to communicate with your Yale-Integration. Please reconnect your Yale-account if this error keeps showing up. |  |
| 1063 | text | Error: Unknown User |  |
| 1064 | text | Error: Failed creating User |  |
| 1065 | text | Error: Username already used by another user |  |
| 1066 | text | Error: Email-address already used by another user |  |
| 1067 | text | Advanced Regulation not possible, e.g. missing Heating actuators with Version >V1.53 |  |
| 1068 | text | Not all Multi-Heating Actuator-Valves of one zone currently have the same usage (Heating, Cooling, Heating & Cooling) |  |
| 1069 | text | Climate devices with Cooling are only possible with Advanced Regulation (Room- or Floor-Temperature Regulation). |  |
| 1070 | text | The used Heating Actuators have a version lower than V1.53 and are therefor not supported with Advanced Regulation! They can only be used in a normal way. |  |
| 1071 | text | The used Climate devices do not support Advanced Regulation. |  |
| 1072 | text | Climate Regulation with Switching- or Dimming-Actuator is only possible with Advanced Regulation. The option has to be activated. |  |
| 1073 | text | Error. Failed creating Time Program. |  |
| 1074 | text | Error. Failed updating Time Program. |  |
| 1075 | text | Error. Unknown Time Program. |  |
| 1076 | text | Error. Unknown Condition. |  |
| 1077 | text | Error. Failed creating Condition. |  |
| 1078 | text | Error. Failed creating Push Note. |  |
| 1079 | text | Error. Unknown Push Note. |  |
| 1080 | text | An error occurred, could not create Client-Bridge. |  |
| 1081 | text | An error occurred, unknown Client-Bridge. |  |
| 1082 | text | Not allowed Master-Client in use |  |
| 1083 | text | Failed to create Meter. Please try again. |  |
| 1084 | text | Unknown Meter |  |
| 1085 | text | History-Request currently not possible |  |
| 1100 | text | Sensor-Overflow |  |
| 1101 | icon | State unknown | state-unknown |
| 1102 | icon | Troubled | troubled |
| 1103 | icon | Locked | shading_locked |
| 1104 | icon | Blinking | blinking |
| 1105 | icon | Overtemperature | load-error |
| 1106 | icon | Overload | load-error |
| 1107 | icon | Load error | load-error |
| 1108 | value | -{{value}}dBm |  |
| 1109 | value | {{value}}°C |  |
| 1110 | value | {{value}}W |  |
| 1111 | icon-detail | Quality | signal (value 0=unknown,1=100%,2=75%,3=50%,4=25%) |
| 1112 | icon | Not yet configured | not-yet-configured |
| 1113 | icon | Battery: Empty | battery-0 |
| 1114 | icon | Battery: Weak | battery-1 |
| 1115 | icon | Battery: Medium | battery-2 |
| 1116 | icon | Battery: Good | battery-3 |
| 1117 | icon | Battery: Full | battery-4 |
| 1118 | icon | Battery: Unknown | battery-unknown |
| 1119 | icon | Mains powered | battery-mains |
| 1120 | specific | External connections: {{value}} |  |
| 1121 | icon-value | {{value}}% | window-open |
| 1122 | icon-value | *(no English text in app)* | window-closed |
| 1123 | icon-value | *(no English text in app)* | door-open |
| 1124 | icon-value | *(no English text in app)* | door-closed |
| 1125 | icon-value | *(no English text in app)* | motion |
| 1126 | icon-value | *(no English text in app)* | no-motion |
| 1127 | icon | *(no English text in app)* | shading_locked |
| 1128 | icon | *(no English text in app)* | shading_confirmed |
| 1129 | value | Water detected - {{value}} |  |
| 1130 | value | OK - {{value}} |  |
| 1131 | text | Sensor Status unknown |  |
| 1132 | value | Position: {{value}} |  |
| 1133 | text | Calibration needed |  |
| 1134 | value | Occupied resender slots: {{value}} |  |
| 1200 | icon | Some states unknown | state-unknown |
| 1201 | icon | All states unknown | state-unknown |
| 1202 | icon | Some troubled | troubled |
| 1203 | icon | All troubled | troubled |
| 1204 | icon | *(no English text in app)* | shading_blinds |
| 1220 | text | Value Unknown |  |
| 1221 | text | Value Error |  |
| 1222 | value | {{value}}°C |  |
| 1223 | value | {{value}}% |  |
| 1224 | value | PT1000: {{value}}°C |  |
| 1225 | value | Valve: {{value}}% |  |
| 1226 | value | {{value}}W |  |
| 1227 | value | Sum-Request: {{value}} |  |
| 1228 | text | Not configured |  |
| 1229 | none | *(no English text in app)* | sensor-unknown-startup |
| 1230 | icon | *(no English text in app)* | sensor-unknown-long |
| 1240 | value | {{value}}m/s |  |
| 1241 | value | Rain |  |
| 1242 | value | No Rain |  |
| 1243 | value | {{value}} |  |
| 1300 |  | Sunrise |  |
| 1301 |  | Sunset |  |
| 1302 |  | Mode: Pushbutton |  |
| 1303 |  | Mode: Switch |  |
| 1304 |  | Mode: Pushbutton /  Switch |  |
| 1305 |  | Mode: Rocker |  |
| 1306 |  | Mode: Pushbutton |  |
| 1307 |  | Mode: Switch |  |
| 1308 |  | Window - ON when closed |  |
| 1309 |  | Window - ON when opened |  |
| 1310 |  | Door - ON when closed |  |
| 1311 |  | Door - ON when opened |  |
| 1350 |  | Unknown - no change |  |
| 1351 |  | ON/OFF only |  |
| 1360 |  | User defined |  |
| 1361 |  | R/L/C Standard |  |
| 1362 |  | LED 1 |  |
| 1363 |  | LED 2 |  |
| 1364 |  | LED 3 |  |
| 1365 |  | CFL/ESL |  |
| 1366 |  | LED 4 |  |
| 1367 |  | LED 5 |  |
| 1368 |  | LED 6 |  |
| 1369 |  | LED 7 |  |
| 1370 |  | Linear 0-10V |  |
| 1371 |  | Linear 1-10V |  |
| 1372 |  | Log 0-10V |  |
| 1373 |  | Log 1-10V |  |
| 1374 |  | LED Low |  |
| 1375 |  | LED Mid |  |
| 1376 |  | LED High |  |
| 1500 |  | Home |  |
| 1501 |  | Away |  |
| 1502 |  | Morning |  |
| 1503 |  | Night |  |
| 1520 |  | Default |  |

## Other code families in en.json

Audit-log events (`AUDIT_LOGS` 408 `event` field) and usage/compType labels:

```
USAGE_TYPE_100 = Normal
USAGE_TYPE_101 = Cooling/Heating Sensor - 1 contact
LOG_EVENT_101 = Server Connection: {{detail}}
USAGE_TYPE_102 = Cooling/Heating Sensor - 2 contacts
LOG_EVENT_102 = Client-Connection: {{detail}} (Client: {{obj}})
LOG_EVENT_103 = Meter-Connection: {{detail}} (Meter: {{obj}})
LOG_EVENT_104 = Amazon Alexa Connection: {{detail}}
LOG_EVENT_105 = Google Home Connection: {{detail}}
LOG_EVENT_106 = Yale Connection: {{detail}}
LOG_EVENT_107 = Unsuccessful access attempts: {{detail}}
LOG_EVENT_108 = Decryption failed
LOG_EVENT_109 = Authentication failed
LOG_EVENT_110 = Bridge Power-On (FW-Version: {{detail}}, Build: {{obj}})
LOG_EVENT_111 = Unsuccessful access attempts (wrong username): {{detail}}
LOG_EVENT_112 = Unsuccessful access attempts (wrong auth-key): {{detail}}
LOG_EVENT_200 = General Bridge settings changed
LOG_EVENT_201 = Server connection enable: {{detail}}
LOG_EVENT_202 = Notifications enable: {{detail}}
LOG_EVENT_203 = Configuration-changed: {{obj}} (Number total changed objects: {{detail}})
LOG_EVENT_204 = Input validation fails: {{obj}} (Number total fails: {{detail}})
LOG_EVENT_205 = Climate Mode changed (Room: {{obj}})
LOG_EVENT_206 = FW Update started (FW-Version: {{detail}}, Build: {{obj}})
LOG_EVENT_207 = Energy Settings changed
LOG_EVENT_208 = Tariff Settings changed (Tariff-Type: {{detail}})
BINAREINGANG_230 = Binary Input
LOG_EVENT_301 = Successful {{detail}}
LOG_EVENT_302 = User {{detail}} (User: {{obj}})
LOG_EVENT_303 = User type updated: {{detail}} (User: {{obj}})
LOG_EVENT_304 = Auth-Key changed
LOG_EVENT_306 = Restore of former backuped config was started
COMP_TYPE_7401 = Switching Actuator
DEVICE_TYPE_7401 = Switching Actuator
COMP_TYPE_7402 = Switching Actuator (I)
DEVICE_TYPE_7402 = Switching Actuator (I)
COMP_TYPE_7701 = Dimming Actuator
DEVICE_TYPE_7701 = Dimming Actuator
COMP_TYPE_7702 = Dimming Actuator (I)
DEVICE_TYPE_7702 = Dimming Actuator (I)
COMP_TYPE_7703 = Analog Actuator
DEVICE_TYPE_7703 = Analog Actuator
COMP_TYPE_8101 = Heating Actuator
DEVICE_TYPE_8101 = Heating Actuator
COMP_TYPE_8102 = Heating Actuator (new FW)
DEVICE_TYPE_8102 = Heating Actuator (new FW)
COMP_TYPE_8601 = Shutter Actuator (I)
COMP_TYPE_8602 = Shutter Actuator
```
