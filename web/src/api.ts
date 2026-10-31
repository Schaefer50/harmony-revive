// Thin client for the bridge server's API (same origin as the app).

export interface HubCommand {
  name: string;
  label: string;
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
  groups: CommandGroup[];
}
export interface HubConfig {
  activities: Activity[];
  devices: Device[];
}
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

export type ServerEvent =
  | { type: 'snapshot'; hubs: HubState[] }
  | { type: 'hub'; hub: HubState }
  | { type: 'removed'; id: string };

const TOKEN_KEY = 'harmony-revive.token';

export function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setToken(token: string): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode */
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`);
  return body as T;
}

const hubPath = (id: string) => `/api/hubs/${encodeURIComponent(id)}`;
const post = (body: unknown = {}): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

export const api = {
  hubs: () => call<HubState[]>('/api/hubs'),
  addHub: (host: string) => call<HubState>('/api/hubs', post({ host })),
  removeHub: (id: string) => call(hubPath(id), { method: 'DELETE' }),
  config: (id: string) => call<HubConfig>(`${hubPath(id)}/config`),
  refresh: (id: string) => call<HubConfig>(`${hubPath(id)}/refresh`, post()),
  startActivity: (id: string, activityId: string) => call(`${hubPath(id)}/activity`, post({ activityId })),
  powerOff: (id: string) => call(`${hubPath(id)}/off`, post()),
  press: (id: string, targetId: string, command: string) => call(`${hubPath(id)}/press`, post({ targetId, command })),
};

/** Live hub state over WebSocket, reconnecting forever with backoff. */
export function subscribe(onEvent: (e: ServerEvent) => void, onStatus: (online: boolean) => void): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let delay = 500;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const open = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const token = getToken();
    ws = new WebSocket(`${proto}://${location.host}/api/events${token ? `?token=${encodeURIComponent(token)}` : ''}`);
    ws.onopen = () => {
      delay = 500;
      onStatus(true);
    };
    ws.onmessage = (m) => {
      try {
        onEvent(JSON.parse(m.data));
      } catch {
        /* ignore malformed */
      }
    };
    ws.onclose = () => {
      onStatus(false);
      if (closed) return;
      timer = setTimeout(open, delay);
      delay = Math.min(delay * 2, 10_000);
    };
  };

  // Phones suspend sockets in the background; reconnect immediately on return.
  const onVisible = () => {
    if (document.visibilityState === 'visible' && ws && ws.readyState > WebSocket.OPEN) {
      clearTimeout(timer);
      delay = 500;
      open();
    }
  };
  document.addEventListener('visibilitychange', onVisible);
  open();

  return () => {
    closed = true;
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisible);
    ws?.close();
  };
}
