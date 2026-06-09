import { INFO_TEXT_CODES } from '../XComfortProtocol';
import type { DeviceMetadata, InfoEntry } from '../types';

export function parseInfoMetadata(infoArray: InfoEntry[] = []): DeviceMetadata {
  const metadata: DeviceMetadata = {};
  const batteryLevels: Record<string, number> = {
    [INFO_TEXT_CODES.BATTERY_LEVEL_0]: 0,
    [INFO_TEXT_CODES.BATTERY_LEVEL_25]: 25,
    [INFO_TEXT_CODES.BATTERY_LEVEL_50]: 50,
    [INFO_TEXT_CODES.BATTERY_LEVEL_75]: 75,
    [INFO_TEXT_CODES.BATTERY_LEVEL_100]: 100,
  };
  const parseNumericValue = (value: string | number): number | null => {
    const parsed = Number.parseFloat(String(value).replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  };

  infoArray.forEach((info) => {
    const textCode = String(info.text || '');
    if (!textCode) {
      return;
    }

    if (Object.prototype.hasOwnProperty.call(batteryLevels, textCode)) {
      metadata.batteryLevel = batteryLevels[textCode];
      metadata.batteryPowered = true;
      return;
    }

    if (textCode === INFO_TEXT_CODES.BATTERY_LEVEL_UNKNOWN) {
      metadata.batteryPowered = true;
      return;
    }

    if (textCode === INFO_TEXT_CODES.MAINS_POWERED) {
      metadata.batteryPowered = false;
      return;
    }

    if (textCode === INFO_TEXT_CODES.RAIN) {
      metadata.rain = true;
      return;
    }

    if (textCode === INFO_TEXT_CODES.NO_RAIN) {
      metadata.rain = false;
      return;
    }

    if (info.value === undefined) {
      return;
    }

    switch (textCode) {
      case INFO_TEXT_CODES.TEMPERATURE_STANDARD:
      case INFO_TEXT_CODES.PT1000_TEMPERATURE: {
        const parsed = parseNumericValue(info.value);
        if (parsed !== null) {
          metadata.temperature = parsed;
        }
        break;
      }
      case INFO_TEXT_CODES.DEVICE_TEMPERATURE:
      case INFO_TEXT_CODES.TEMPERATURE_DIMMER: {
        const parsed = parseNumericValue(info.value);
        if (parsed !== null) {
          metadata.deviceTemperature = parsed;
          if (metadata.temperature === undefined) {
            metadata.temperature = parsed;
          }
        }
        break;
      }
      case INFO_TEXT_CODES.HUMIDITY_STANDARD:
        {
          const parsed = parseNumericValue(info.value);
          if (parsed !== null) {
            metadata.humidity = parsed;
          }
        }
        break;
      case INFO_TEXT_CODES.SIGNAL_STRENGTH_DBM: {
        const parsed = parseNumericValue(info.value);
        if (parsed !== null) {
          metadata.signalStrengthDbm = parsed;
        }
        break;
      }
      case INFO_TEXT_CODES.SIGNAL_STRENGTH: {
        const parsed = parseNumericValue(info.value);
        if (parsed !== null) {
          metadata.signalStrength = parsed;
        }
        break;
      }
      case INFO_TEXT_CODES.POWER:
      case INFO_TEXT_CODES.POWER_CONSUMPTION: {
        const parsed = parseNumericValue(info.value);
        if (parsed !== null) {
          metadata.power = parsed;
        }
        break;
      }
      case INFO_TEXT_CODES.DIMM_VALUE: {
        const parsed = parseNumericValue(info.value);
        if (parsed !== null) {
          metadata.heatingDemand = parsed;
          metadata.valvePosition = parsed;
        }
        break;
      }
      case INFO_TEXT_CODES.SUM_REQUEST: {
        const parsed = parseNumericValue(info.value);
        if (parsed !== null) {
          metadata.heatingDemand = parsed;
        }
        break;
      }
      case INFO_TEXT_CODES.WIND_SPEED: {
        const parsed = parseNumericValue(info.value);
        if (parsed !== null) {
          metadata.windSpeed = parsed;
        }
        break;
      }
      case INFO_TEXT_CODES.BRIGHTNESS: {
        const parsed = parseNumericValue(info.value);
        if (parsed !== null) {
          metadata.brightness = parsed;
        }
        break;
      }
      default:
        break;
    }
  });

  return metadata;
}
