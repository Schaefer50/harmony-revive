// Normalized shapes the bridge hands to the UI. The hub's raw config is
// verbose and inconsistent (ids are sometimes strings, sometimes numbers), so
// everything is flattened into these before it leaves the server.

export interface HubCommand {
  name: string;
  label: string;
  /** Opaque action string from the hub config; sent back verbatim on press. */
  action: string;
}

export interface CommandGroup {
  name: string;
  commands: HubCommand[];
}

export interface Device {
  id: string;
  label: string;
  manufacturer: string;
  model: string;
  type: string;
  groups: CommandGroup[];
}

export interface Activity {
  id: string;
  label: string;
  order: number;
  /** Buttons the hub maps for this activity (volume to the AVR, etc.). */
  groups: CommandGroup[];
}

export interface HubConfig {
  activities: Activity[];
  devices: Device[];
}

/** Matches the hub's activityStatus values in stateDigest notifications. */
export type ActivityStatus = 'off' | 'starting' | 'on' | 'stopping';

export interface HubState {
  id: string;
  host: string;
  name: string;
  connected: boolean;
  currentActivityId: string | null;
  activityStatus: ActivityStatus;
  error: string | null;
}

export const POWER_OFF_ACTIVITY_ID = '-1';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;

function normalizeGroups(raw: Raw): CommandGroup[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((g: Raw) => ({
    name: String(g?.name ?? ''),
    commands: (Array.isArray(g?.function) ? g.function : [])
      .filter((f: Raw) => typeof f?.action === 'string')
      .map((f: Raw) => ({
        name: String(f.name ?? ''),
        label: String(f.label ?? f.name ?? ''),
        action: f.action as string,
      })),
  }));
}

export function normalizeConfig(raw: Raw): HubConfig {
  const activities: Activity[] = (Array.isArray(raw?.activity) ? raw.activity : [])
    .filter((a: Raw) => String(a?.id) !== POWER_OFF_ACTIVITY_ID)
    .map((a: Raw) => ({
      id: String(a.id),
      label: String(a.label ?? `Activity ${a.id}`),
      order: Number(a.activityOrder ?? 999),
      groups: normalizeGroups(a.controlGroup),
    }))
    .sort((a: Activity, b: Activity) => a.order - b.order || a.label.localeCompare(b.label));

  const devices: Device[] = (Array.isArray(raw?.device) ? raw.device : [])
    .map((d: Raw) => ({
      id: String(d.id),
      label: String(d.label ?? `Device ${d.id}`),
      manufacturer: String(d.manufacturer ?? ''),
      model: String(d.model ?? ''),
      type: String(d.type ?? ''),
      groups: normalizeGroups(d.controlGroup),
    }))
    .sort((a: Device, b: Device) => a.label.localeCompare(b.label));

  return { activities, devices };
}

export function activityStatusFromCode(code: unknown): ActivityStatus {
  switch (Number(code)) {
    case 1:
      return 'starting';
    case 2:
      return 'on';
    case 3:
      return 'stopping';
    default:
      return 'off';
  }
}
