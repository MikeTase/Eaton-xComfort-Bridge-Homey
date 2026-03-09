import { INFO_TEXT_CODES } from '../XComfortProtocol';
import type { DeviceMetadata, InfoEntry } from '../types';

export function parseInfoMetadata(infoArray: InfoEntry[] = []): DeviceMetadata {
  const metadata: DeviceMetadata = {};

  infoArray.forEach((info) => {
    if (!info.text || info.value === undefined) {
      return;
    }

    switch (info.text) {
      case INFO_TEXT_CODES.TEMPERATURE_STANDARD:
      case INFO_TEXT_CODES.TEMPERATURE_DIMMER:
        metadata.temperature = parseFloat(String(info.value));
        break;
      case INFO_TEXT_CODES.HUMIDITY_STANDARD:
        metadata.humidity = parseFloat(String(info.value));
        break;
      default:
        break;
    }
  });

  return metadata;
}
