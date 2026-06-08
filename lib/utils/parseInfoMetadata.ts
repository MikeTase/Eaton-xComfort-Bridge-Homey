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
    const parsed = Number.parseFloat(String(value));
    return Number.isFinite(parsed) ? parsed : null;
  };

  infoArray.forEach((info) => {
    if (!info.text) {
      return;
    }

    if (Object.prototype.hasOwnProperty.call(batteryLevels, info.text)) {
      metadata.batteryLevel = batteryLevels[info.text];
      metadata.batteryPowered = true;
      return;
    }

    if (info.text === INFO_TEXT_CODES.BATTERY_LEVEL_UNKNOWN) {
      metadata.batteryPowered = true;
      return;
    }

    if (info.text === INFO_TEXT_CODES.MAINS_POWERED) {
      metadata.batteryPowered = false;
      return;
    }

    if (info.value === undefined) {
      return;
    }

    switch (info.text) {
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
      case INFO_TEXT_CODES.SIGNAL_STRENGTH: {
        const parsed = parseNumericValue(info.value);
        if (parsed !== null) {
          metadata.signalStrength = parsed;
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
      default:
        break;
    }
  });

  return metadata;
}
