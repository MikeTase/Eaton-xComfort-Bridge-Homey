import { INFO_TEXT_CODES } from '../XComfortProtocol';
import type { DeviceMetadata, InfoEntry } from '../types';

export function parseInfoMetadata(infoArray: InfoEntry[] = []): DeviceMetadata {
  const metadata: DeviceMetadata = {};
  const parseNumericValue = (value: string | number): number | null => {
    const parsed = Number.parseFloat(String(value));
    return Number.isFinite(parsed) ? parsed : null;
  };

  infoArray.forEach((info) => {
    if (!info.text || info.value === undefined) {
      return;
    }

    switch (info.text) {
      case INFO_TEXT_CODES.TEMPERATURE_STANDARD:
      case INFO_TEXT_CODES.TEMPERATURE_DIMMER: {
        const parsed = parseNumericValue(info.value);
        if (parsed !== null) {
          metadata.temperature = parsed;
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
      case INFO_TEXT_CODES.DIMM_VALUE:
      case INFO_TEXT_CODES.DIMM_VALUE_ALT: {
        const parsed = parseNumericValue(info.value);
        if (parsed !== null) {
          metadata.heatingDemand = parsed;
        }
        break;
      }
      default:
        break;
    }
  });

  return metadata;
}
