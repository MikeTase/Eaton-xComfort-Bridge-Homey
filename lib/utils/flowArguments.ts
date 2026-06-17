const TRUE_VALUES = new Set([
  '1',
  'true',
  'yes',
  'on',
  'open',
  'opened',
  'enable',
  'enabled',
  'allow',
  'allowed',
]);

const FALSE_VALUES = new Set([
  '0',
  'false',
  'no',
  'off',
  'close',
  'closed',
  'disable',
  'disabled',
  'block',
  'blocked',
]);

export function normalizeChoiceIdArgument(value: unknown): string | null {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const normalized = String(value).trim();
    return normalized.length ? normalized : null;
  }

  if (value && typeof value === 'object' && 'id' in value) {
    return normalizeChoiceIdArgument((value as { id?: unknown }).id);
  }

  return null;
}

export function normalizeOnOffArgument(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }

  const normalized = normalizeChoiceIdArgument(value)
    ?.toLowerCase()
    .replace(/[\s-]+/g, '_');

  if (!normalized) {
    return undefined;
  }
  if (TRUE_VALUES.has(normalized)) {
    return true;
  }
  if (FALSE_VALUES.has(normalized)) {
    return false;
  }

  return undefined;
}

export function normalizeValveStateArgument(value: unknown): boolean | undefined {
  return normalizeOnOffArgument(value);
}

export function normalizeRemoteAccessPreference(value: unknown): boolean | undefined {
  return normalizeOnOffArgument(value);
}

export function normalizePercentageArgument(value: unknown): number | null {
  const rawValue = typeof value === 'number'
    ? value
    : normalizeChoiceIdArgument(value)?.replace(',', '.');
  const numberValue = typeof rawValue === 'number' ? rawValue : Number(rawValue);

  if (!Number.isFinite(numberValue)) {
    return null;
  }

  return Math.max(0, Math.min(100, numberValue));
}
