import { readJson, writeJson } from "./store";

// Google's pairedDevices endpoint returns no human-readable label for many
// devices — only a numeric resource id and a battery level. Mirror the
// workout-type override pattern: relabel devices locally, keyed by device id,
// applied on read so the friendly name survives every refetch.
const FILE = "device-overrides.json";

export type DeviceOverrides = Record<string, { label: string }>;

/** Stable id for a paired device — the trailing segment of its resource name. */
export function deviceId(d: any): string {
  return String(d?.name?.split("/").pop() ?? d?.id ?? "");
}

export function getDeviceOverrides(): DeviceOverrides {
  return readJson<DeviceOverrides>(FILE, {});
}

/** Merge local labels onto Google's device list (override wins over displayName). */
export function applyDeviceOverrides<T extends any[]>(devices: T): T {
  if (!Array.isArray(devices)) return devices;
  const ov = getDeviceOverrides();
  return devices.map((d) => {
    const label = ov[deviceId(d)]?.label;
    return label ? { ...d, displayName: label, overrideLabel: label } : d;
  }) as T;
}

/** Set (or clear, when label is blank) the local label for a device id. */
export function setDeviceOverride(id: string, label: string): DeviceOverrides {
  const ov = getDeviceOverrides();
  const trimmed = label.trim();
  if (trimmed) ov[id] = { label: trimmed };
  else delete ov[id];
  writeJson(FILE, ov);
  return ov;
}
