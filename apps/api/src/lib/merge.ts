/**
 * Recursive merge used for settings layering.
 *
 * Arrays are replaced wholesale rather than concatenated — an admin who narrows
 * `supportedLanguages` to two languages must not end up with a union of five.
 * `null` is treated as a deliberate reset, so a field can be cleared.
 */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (patch === undefined) return base;
  if (patch === null) return null as T;
  if (Array.isArray(patch) || typeof patch !== 'object') return patch as T;
  if (base === null || typeof base !== 'object' || Array.isArray(base)) return patch as T;

  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value === undefined) continue;
    out[key] = key in out ? deepMerge(out[key], value) : value;
  }
  return out as T;
}

/** Flattens an object to dotted keys, for audit diffs and analytics grouping. */
export function flatten(obj: unknown, prefix = ''): Record<string, unknown> {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return prefix ? { [prefix]: obj } : {};
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(out, flatten(value, path));
    } else {
      out[path] = value;
    }
  }
  return out;
}

/** Coerces a possibly-unknown JSON value into a plain record. */
export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function asNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}