import type { XComfortDevice, XComfortRoom } from '../types';

const ROOM_LINK_KEY_PATTERN = /(sensor|device|actuator|heater|valve|comp|component)/i;

function normalizeRoomLabel(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, '')
    .toLowerCase();
}

function coerceRoomId(value: string | number | null | undefined, rooms: XComfortRoom[]): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const roomId = String(value).trim();
  if (!roomId) {
    return null;
  }

  return rooms.some((room) => String(room.roomId) === roomId) ? roomId : null;
}

function collectLinkedIds(value: unknown, parentKey: string = ''): string[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectLinkedIds(entry, parentKey));
  }

  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => {
      const nextKey = parentKey ? `${parentKey}.${key}` : key;
      return collectLinkedIds(entry, nextKey);
    });
  }

  if ((typeof value === 'string' || typeof value === 'number') && ROOM_LINK_KEY_PATTERN.test(parentKey)) {
    return [String(value)];
  }

  return [];
}

function matchByName(roomName: string, rooms: XComfortRoom[]): string | null {
  const trimmedName = roomName.trim().toLowerCase();
  if (!trimmedName) {
    return null;
  }

  const exactMatches = rooms.filter((room) => room.name.trim().toLowerCase() === trimmedName);
  if (exactMatches.length === 1) {
    return exactMatches[0].roomId;
  }

  const normalizedName = normalizeRoomLabel(roomName);
  if (!normalizedName) {
    return null;
  }

  const normalizedExactMatches = rooms.filter((room) => normalizeRoomLabel(room.name) === normalizedName);
  if (normalizedExactMatches.length === 1) {
    return normalizedExactMatches[0].roomId;
  }

  const partialMatches = rooms.filter((room) => {
    const normalizedRoomName = normalizeRoomLabel(room.name);
    return normalizedRoomName.includes(normalizedName) || normalizedName.includes(normalizedRoomName);
  });

  if (partialMatches.length === 1) {
    return partialMatches[0].roomId;
  }

  return null;
}

function matchByLinkedIds(device: XComfortDevice, rooms: XComfortRoom[]): string | null {
  const targetIds = new Set<string>([String(device.deviceId)]);
  if (device.compId !== undefined && device.compId !== null) {
    targetIds.add(String(device.compId));
  }

  const matches = rooms.filter((room) => {
    const directRoomSensorId = room.roomSensorId !== undefined && room.roomSensorId !== null
      ? String(room.roomSensorId)
      : null;
    if (directRoomSensorId && targetIds.has(directRoomSensorId)) {
      return true;
    }

    const linkedIds = collectLinkedIds(room.raw || room);
    return linkedIds.some((id) => targetIds.has(id));
  });

  if (matches.length === 1) {
    return matches[0].roomId;
  }

  return null;
}

export function resolveThermostatRoomId(
  device: XComfortDevice | undefined,
  rooms: XComfortRoom[],
  preferredRoomIds: Array<string | number | null | undefined> = [],
): string | null {
  if (!device || rooms.length === 0) {
    return null;
  }

  for (const candidate of preferredRoomIds) {
    const resolved = coerceRoomId(candidate, rooms);
    if (resolved) {
      return resolved;
    }
  }

  const directDeviceRoomId = coerceRoomId(device.roomId, rooms);
  if (directDeviceRoomId) {
    return directDeviceRoomId;
  }

  const linkedRoomId = matchByLinkedIds(device, rooms);
  if (linkedRoomId) {
    return linkedRoomId;
  }

  if (typeof device.roomName === 'string') {
    const matched = matchByName(device.roomName, rooms);
    if (matched) {
      return matched;
    }
  }

  const heatingRooms = rooms.filter(room => room.temperatureOnly === false || room.mode !== undefined);
  if (heatingRooms.length === 1) {
    return String(heatingRooms[0].roomId);
  }

  return null;
}
