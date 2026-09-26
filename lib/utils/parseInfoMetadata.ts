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
        const values = parseBrightnessValues(info.value);
        if (values.length > 0) {
          metadata.brightness = values[0];
          if (values.length > 1) {
            metadata.brightnessValues = values;
          }
        }
        break;
      }
      default:
        break;
    }
  });

  return metadata;
}

/**
 * Weather-station brightness (info 1243) is `"L M R"`: the lux values of the
 * left, middle and right sensor, with commas as thousands separators
 * (e.g. `"12,500 8,200 950"`). The official app removes the commas and splits
 * on spaces. A single value is returned as a one-element array.
 */
export function parseBrightnessValues(value: string | number): number[] {
  return String(value)
    .replace(/,/g, '')
    .trim()
    .split(/\s+/)
    .map((part) => Number.parseFloat(part))
    .filter((parsed) => Number.isFinite(parsed));
}

/**
 * Main brightness of a weather station: the sensor selected by the device's
 * `bType` (1 left, 2 middle, 3 right; "Brightness Info" in the official app),
 * or the first value.
 */
export function selectMainBrightness(values: number[], bType: unknown): number | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const index = Number(bType) - 1;
  return Number.isInteger(index) && index >= 0 && index < values.length ? values[index] : values[0];
}
