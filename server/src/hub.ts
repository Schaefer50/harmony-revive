// Client for the Harmony Hub's local WebSocket API (port 8088).
//
// The protocol is undocumented; this follows what the community clients
// (aioharmony, harmonyhub-api) have reverse-engineered:
//   1. POST setup.account?getProvisionInfo to http://<hub>:8088/ to learn the
//      hub's activeRemoteId (needed in the WebSocket URL and every message).
//   2. Open ws://<hub>:8088/?domain=<domain>&hubId=<remoteId>.
//   3. Send {hubId, timeout, hbus: {cmd, id, params}}; replies echo `id`,
//      unsolicited notifications carry a `type` instead.
//
// Nothing here talks to Logitech's cloud.

import { EventEmitter } from 'node:events';
import http from 'node:http';
import WebSocket from 'ws';
import {
  activityStatusFromCode,
  normalizeConfig,
  POWER_OFF_ACTIVITY_ID,
  type ActivityStatus,
  type HubConfig,
} from './model.js';

const ORIGIN = 'http://sl.dhg.myharmony.com';
const DEFAULT_DOMAIN = 'svcs.myharmony.com';
const REQUEST_TIMEOUT_MS = 10_000;
const HEARTBEAT_MS = 30_000;
const MAX_BACKOFF_MS = 30_000;

const CMD = {
  config: 'vnd.logitech.harmony/vnd.logitech.harmony.engine?config',
  currentActivity: 'vnd.logitech.harmony/vnd.logitech.harmony.engine?getCurrentActivity',
  holdAction: 'vnd.logitech.harmony/vnd.logitech.harmony.engine?holdAction',
  runActivity: 'harmony.activityengine?runactivity',
  stateDigest: 'vnd.logitech.connect/vnd.logitech.statedigest?get',
  discoveryInfo: 'connect.discoveryinfo?get',
} as const;

const GET_PARAMS = { verb: 'get', format: 'json' };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

interface Pending {
  resolve: (msg: Json) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
  /** Resolve on code 100 ("in progress") too, not just 200. */
  acceptProgress: boolean;
}

export interface HarmonyHubOptions {
  port?: number;
  /** Override for tests; production hubs always use 8088. */
  autoReconnect?: boolean;
}

export interface HarmonyHubEvents {
  state: [];
  config: [HubConfig];
}

/** Low-level POST to the hub's HTTP endpoint. Used before the socket is up. */
export function hubPost(host: string, port: number, cmd: string, timeoutMs = 5_000): Promise<Json> {
  const body = JSON.stringify({ 'id ': 1, cmd, params: {} });
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host,
        port,
        path: '/',
        method: 'POST',
        timeout: timeoutMs,
        headers: {
          Origin: ORIGIN,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Accept-Charset': 'utf-8',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error(`Hub ${host} returned a non-JSON reply (HTTP ${res.statusCode})`));
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error(`Hub ${host} did not answer within ${timeoutMs}ms`)));
    req.on('error', reject);
    req.end(body);
  });
}

/** Turn low-level network errors into something a person can act on. */
export function describeError(err: NodeJS.ErrnoException, host: string, port: number): string {
  switch (err.code) {
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return (
        `No route to ${host}. If the hub is on and has this IP, macOS may be blocking local network ` +
        `access for node: System Settings → Privacy & Security → Local Network → turn on node. (${err.code})`
      );
    case 'ECONNREFUSED':
      return `${host} refused the connection on port ${port}. Check this is the hub's IP. (${err.code})`;
    case 'ETIMEDOUT':
      return `${host} did not answer. Check the hub is powered and on this network. (${err.code})`;
    default:
      return err.message;
  }
}

export class HarmonyHub extends EventEmitter<HarmonyHubEvents> {
  readonly host: string;
  readonly port: number;
  private readonly autoReconnect: boolean;

  remoteId: string | null = null;
  name: string;
  connected = false;
  error: string | null = null;
  currentActivityId: string | null = null;
  activityStatus: ActivityStatus = 'off';
  config: HubConfig = { activities: [], devices: [] };

  private domain = DEFAULT_DOMAIN;
  private configVersion: number | null = null;
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<string, Pending>();
  private heartbeat: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private backoffMs = 1_000;
  private stopped = false;
  private connecting: Promise<void> | null = null;

  constructor(host: string, opts: HarmonyHubOptions = {}) {
    super();
    this.host = host;
    this.name = host;
    this.port = opts.port ?? 8088;
    this.autoReconnect = opts.autoReconnect ?? true;
  }

  /** Stable key for this hub; known before the hub ever answers. */
  get id(): string {
    return this.port === 8088 ? this.host : `${this.host}:${this.port}`;
  }

  /** Connect and load config + current state. Retries in the background on failure. */
  start(): Promise<void> {
    this.stopped = false;
    if (!this.connecting) {
      this.connecting = this.connect().finally(() => (this.connecting = null));
    }
    return this.connecting;
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.teardown(new Error('Hub connection closed'));
    const ws = this.ws;
    this.ws = null;
    this.connected = false;
    ws?.close();
  }

  private async connect(): Promise<void> {
    try {
      if (!this.remoteId) {
        const info = await hubPost(this.host, this.port, 'setup.account?getProvisionInfo');
        const data = info?.data;
        if (!data?.activeRemoteId) {
          throw new Error('Hub did not report a remote id; is the local API enabled?');
        }
        this.remoteId = String(data.activeRemoteId);
        if (typeof data.discoveryServer === 'string') {
          try {
            this.domain = new URL(data.discoveryServer).host || DEFAULT_DOMAIN;
          } catch {
            /* keep default */
          }
        }
      }
      await this.openSocket();
      this.backoffMs = 1_000;
      this.error = null;
      await this.refresh();
    } catch (err) {
      this.error = describeError(err as NodeJS.ErrnoException, this.host, this.port);
      // Drop any half-set-up socket; its close handler ignores it once detached.
      const ws = this.ws;
      this.ws = null;
      this.connected = false;
      this.teardown(err as Error);
      ws?.terminate();
      // Re-provision on the next attempt in case the hub was reset.
      this.remoteId = null;
      this.emit('state');
      this.scheduleReconnect();
      throw err;
    }
  }

  private openSocket(): Promise<void> {
    const url = `ws://${this.host}:${this.port}/?domain=${encodeURIComponent(this.domain)}&hubId=${this.remoteId}`;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, { handshakeTimeout: 5_000 });
      let opened = false;
      ws.on('open', () => {
        opened = true;
        this.ws = ws;
        this.connected = true;
        this.startHeartbeat(ws);
        this.emit('state');
        resolve();
      });
      ws.on('message', (data) => this.onMessage(data.toString()));
      ws.on('error', (err) => {
        if (!opened) reject(err);
      });
      ws.on('close', () => {
        if (this.ws !== ws) return;
        this.ws = null;
        this.connected = false;
        this.teardown(new Error('Hub connection lost'));
        this.emit('state');
        this.scheduleReconnect();
      });
    });
  }

  private startHeartbeat(ws: WebSocket): void {
    let alive = true;
    ws.on('pong', () => (alive = true));
    this.heartbeat = setInterval(() => {
      if (!alive) {
        ws.terminate();
        return;
      }
      alive = false;
      ws.ping();
    }, HEARTBEAT_MS);
  }

  private teardown(err: Error): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  private scheduleReconnect(): void {
    if (this.stopped || !this.autoReconnect || this.reconnectTimer) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.start().catch(() => {
        /* connect() already recorded the error and rescheduled */
      });
    }, delay);
  }

  /** Send a command and wait for the reply with the matching id. */
  request(cmd: string, params: Json = GET_PARAMS, acceptProgress = false): Promise<Json> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Hub is not connected'));
    }
    const id = String(this.nextId++);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Hub did not answer ${cmd}`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer, acceptProgress });
      ws.send(this.frame(cmd, id, params));
    });
  }

  /** Fire-and-forget send for latency-sensitive button presses. */
  private send(cmd: string, params: Json): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error('Hub is not connected');
    ws.send(this.frame(cmd, String(this.nextId++), params));
  }

  private frame(cmd: string, id: string, params: Json): string {
    return JSON.stringify({ hubId: this.remoteId, timeout: 30, hbus: { cmd, id, params } });
  }

  private onMessage(text: string): void {
    let msg: Json;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }

    const id = msg?.id != null ? String(msg.id) : null;
    const pending = id ? this.pending.get(id) : undefined;
    if (pending) {
      const code = Number(msg.code);
      if (code === 200 || (code === 100 && pending.acceptProgress)) {
        clearTimeout(pending.timer);
        this.pending.delete(id!);
        pending.resolve(msg);
      } else if (code !== 100) {
        clearTimeout(pending.timer);
        this.pending.delete(id!);
        pending.reject(new Error(`Hub rejected ${msg.cmd ?? 'request'}: ${msg.msg ?? code}`));
      }
      return;
    }

    switch (msg?.type) {
      case 'connect.stateDigest?notify':
        this.onStateDigest(msg.data);
        break;
      case 'harmony.engine?startActivityFinished':
        if (msg.data?.activityId != null) {
          this.currentActivityId = String(msg.data.activityId);
          this.activityStatus = this.currentActivityId === POWER_OFF_ACTIVITY_ID ? 'off' : 'on';
          this.emit('state');
        }
        break;
    }
  }

  private onStateDigest(data: Json): void {
    if (!data) return;
    if (data.activityId != null) {
      this.currentActivityId = String(data.activityId);
      this.activityStatus =
        this.currentActivityId === POWER_OFF_ACTIVITY_ID ? 'off' : activityStatusFromCode(data.activityStatus);
      this.emit('state');
    }
    // syncStatus 0 means the hub finished applying a config change (e.g. from
    // the Logitech app); reload so the UI shows new devices/activities.
    const version = data.configVersion != null ? Number(data.configVersion) : null;
    if (version != null && Number(data.syncStatus) === 0 && version !== this.configVersion) {
      this.configVersion = version;
      this.loadConfig().catch(() => {});
    }
  }

  async refresh(): Promise<void> {
    const [digest, info] = await Promise.all([
      this.request(CMD.stateDigest).catch(() => null),
      this.request(CMD.discoveryInfo).catch(() => null),
    ]);
    if (info?.data?.friendlyName) this.name = String(info.data.friendlyName);
    if (digest?.data?.configVersion != null) this.configVersion = Number(digest.data.configVersion);
    await this.loadConfig();
    const current = await this.request(CMD.currentActivity);
    this.currentActivityId = String(current?.data?.result ?? POWER_OFF_ACTIVITY_ID);
    this.activityStatus = this.currentActivityId === POWER_OFF_ACTIVITY_ID ? 'off' : 'on';
    this.emit('state');
  }

  async loadConfig(): Promise<HubConfig> {
    const res = await this.request(CMD.config);
    this.config = normalizeConfig(res?.data);
    this.emit('config', this.config);
    return this.config;
  }

  /** Start an activity, or pass POWER_OFF_ACTIVITY_ID to turn everything off. */
  async startActivity(activityId: string): Promise<void> {
    await this.request(
      CMD.runActivity,
      { async: 'true', timestamp: 0, activityId: String(activityId) },
      true,
    );
  }

  powerOff(): Promise<void> {
    return this.startActivity(POWER_OFF_ACTIVITY_ID);
  }

  /**
   * Press and release a button. `action` is the opaque string from the hub
   * config for that button; holdMs > 0 keeps it held (e.g. for volume ramps).
   */
  async pressAction(action: string, holdMs = 0): Promise<void> {
    const params = { status: 'press', timestamp: '0', verb: 'render', action };
    this.send(CMD.holdAction, params);
    if (holdMs > 0) await new Promise((r) => setTimeout(r, holdMs));
    this.send(CMD.holdAction, { ...params, status: 'release' });
  }

  /** Look up a device or activity button by name and press it. */
  async pressCommand(targetId: string, commandName: string, holdMs = 0): Promise<void> {
    const action = this.findAction(targetId, commandName);
    if (!action) throw new Error(`No command "${commandName}" on ${targetId}`);
    await this.pressAction(action, holdMs);
  }

  findAction(targetId: string, commandName: string): string | null {
    const target =
      this.config.devices.find((d) => d.id === targetId) ??
      this.config.activities.find((a) => a.id === targetId);
    if (!target) return null;
    for (const g of target.groups) {
      const c = g.commands.find((c) => c.name === commandName);
      if (c) return c.action;
    }
    return null;
  }
}
