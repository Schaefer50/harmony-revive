// Owns the set of hubs the bridge talks to and persists the list to disk so
// hubs added from the app survive restarts.

import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { HarmonyHub } from './hub.js';
import type { HubState } from './model.js';

interface StoredHub {
  host: string;
  port?: number;
}

export interface HubManagerEvents {
  changed: [HubState];
  removed: [string];
}

export class HubManager extends EventEmitter<HubManagerEvents> {
  private hubs = new Map<string, HarmonyHub>();
  private readonly file: string;

  constructor(dataDir: string) {
    super();
    this.file = path.join(dataDir, 'hubs.json');
  }

  /** Load saved hubs plus any seeded from the environment, then connect. */
  async init(seedHosts: string[]): Promise<void> {
    let stored: StoredHub[] = [];
    try {
      stored = JSON.parse(await fs.readFile(this.file, 'utf8'));
    } catch {
      /* first run */
    }
    for (const h of stored) this.attach(h.host, h.port);
    let added = false;
    for (const seed of seedHosts) {
      const [host, port] = seed.split(':');
      if (!this.hubs.has(hubKey(host, Number(port) || undefined))) {
        this.attach(host, Number(port) || undefined);
        added = true;
      }
    }
    if (added) await this.save();
  }

  list(): HarmonyHub[] {
    return [...this.hubs.values()];
  }

  get(id: string): HarmonyHub | undefined {
    return this.hubs.get(id);
  }

  async add(host: string, port?: number): Promise<HarmonyHub> {
    const existing = this.hubs.get(hubKey(host, port));
    if (existing) return existing;
    const hub = this.attach(host, port);
    await this.save();
    return hub;
  }

  async remove(id: string): Promise<boolean> {
    const hub = this.hubs.get(id);
    if (!hub) return false;
    hub.stop();
    hub.removeAllListeners();
    this.hubs.delete(id);
    await this.save();
    this.emit('removed', id);
    return true;
  }

  stopAll(): void {
    for (const hub of this.hubs.values()) hub.stop();
  }

  private attach(host: string, port?: number): HarmonyHub {
    const hub = new HarmonyHub(host, { port });
    this.hubs.set(hub.id, hub);
    let lastLogged: string | null = null;
    hub.on('state', () => {
      const line = hub.connected ? `connected (${hub.name})` : hub.error ? `not connected: ${hub.error}` : null;
      if (line && line !== lastLogged) {
        console.log(`[${new Date().toISOString()}] hub ${hub.id} ${line}`);
        lastLogged = line;
      }
      this.emit('changed', hubState(hub));
    });
    hub.on('config', () => this.emit('changed', hubState(hub)));
    hub.start().catch(() => {
      /* error is surfaced via hub state; reconnect is automatic */
    });
    return hub;
  }

  private async save(): Promise<void> {
    const data: StoredHub[] = this.list().map((h) =>
      h.port === 8088 ? { host: h.host } : { host: h.host, port: h.port },
    );
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(data, null, 2));
  }
}

function hubKey(host: string, port?: number): string {
  return !port || port === 8088 ? host : `${host}:${port}`;
}

export function hubState(hub: HarmonyHub): HubState {
  return {
    id: hub.id,
    host: hub.host,
    name: hub.name,
    connected: hub.connected,
    currentActivityId: hub.currentActivityId,
    activityStatus: hub.activityStatus,
    error: hub.error,
  };
}
