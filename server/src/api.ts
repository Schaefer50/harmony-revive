// HTTP + WebSocket API the apps talk to, plus static hosting of the web app.
//
//   GET    /api/hubs                      list hubs and their live state
//   POST   /api/hubs            {host}    add a hub by IP/hostname
//   DELETE /api/hubs/:id                  forget a hub
//   GET    /api/hubs/:id/config           activities, devices, buttons
//   POST   /api/hubs/:id/refresh          reload config from the hub
//   POST   /api/hubs/:id/activity {activityId}
//   POST   /api/hubs/:id/off
//   POST   /api/hubs/:id/press  {targetId, command, holdMs?}
//   WS     /api/events                    live hub state pushes

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { hubState, type HubManager } from './hubManager.js';

export interface ApiOptions {
  manager: HubManager;
  /** Built web app to serve at /. Skipped if the folder does not exist. */
  webRoot?: string;
  /** If set, every API call must present this token. */
  token?: string;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const HOST_RE = /^[a-zA-Z0-9.-]{1,253}$/;
const MAX_BODY = 64 * 1024;
const MAX_HOLD_MS = 10_000;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

function readBody(req: http.IncomingMessage): Promise<Json> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'Body must be JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(text);
}

function authorized(req: http.IncomingMessage, token: string | undefined): boolean {
  if (!token) return true;
  const header = req.headers.authorization;
  if (header === `Bearer ${token}`) return true;
  const url = new URL(req.url ?? '/', 'http://x');
  return url.searchParams.get('token') === token;
}

export function createApi({ manager, webRoot, token }: ApiOptions): http.Server {
  const hasWeb = !!webRoot && fs.existsSync(path.join(webRoot, 'index.html'));

  async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, parts: string[]) {
    const method = req.method ?? 'GET';

    if (parts.length === 1 && parts[0] === 'hubs') {
      if (method === 'GET') return sendJson(res, 200, manager.list().map(hubState));
      if (method === 'POST') {
        const body = await readBody(req);
        const host = String(body.host ?? '').trim();
        const port = body.port == null ? undefined : Number(body.port);
        if (!HOST_RE.test(host)) throw new HttpError(400, 'Enter the hub IP address, e.g. 10.0.0.26');
        if (port !== undefined && !(Number.isInteger(port) && port > 0 && port < 65536)) {
          throw new HttpError(400, 'Invalid port');
        }
        const hub = await manager.add(host, port);
        return sendJson(res, 201, hubState(hub));
      }
    }

    if (parts[0] === 'hubs' && parts.length >= 2) {
      const hub = manager.get(decodeURIComponent(parts[1]));
      if (!hub) throw new HttpError(404, 'Unknown hub');
      const action = parts.slice(2).join('/');

      if (action === '' && method === 'DELETE') {
        await manager.remove(hub.id);
        return sendJson(res, 200, { ok: true });
      }
      if (action === 'config' && method === 'GET') return sendJson(res, 200, hub.config);
      if (method === 'POST') {
        if (!hub.connected) throw new HttpError(503, hub.error ?? 'Hub is not connected yet');
        const body = await readBody(req);
        switch (action) {
          case 'refresh':
            await hub.refresh();
            return sendJson(res, 200, hub.config);
          case 'activity': {
            const id = String(body.activityId ?? '');
            if (!hub.config.activities.some((a) => a.id === id)) throw new HttpError(404, 'Unknown activity');
            await hub.startActivity(id);
            return sendJson(res, 200, { ok: true });
          }
          case 'off':
            await hub.powerOff();
            return sendJson(res, 200, { ok: true });
          case 'press': {
            const holdMs = Math.max(0, Math.min(Number(body.holdMs) || 0, MAX_HOLD_MS));
            const actionStr = hub.findAction(String(body.targetId ?? ''), String(body.command ?? ''));
            if (!actionStr) throw new HttpError(404, 'Unknown button');
            await hub.pressAction(actionStr, holdMs);
            return sendJson(res, 200, { ok: true });
          }
        }
      }
    }

    throw new HttpError(404, 'Not found');
  }

  function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, pathname: string) {
    if (!hasWeb || !webRoot) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Web app not built. Run `npm run build`.');
      return;
    }
    const root = path.resolve(webRoot);
    let file = path.resolve(root, '.' + decodeURIComponent(pathname));
    if (!file.startsWith(root + path.sep) && file !== root) {
      res.writeHead(403).end();
      return;
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(root, 'index.html'); // single-page app fallback
    }
    const ext = path.extname(file);
    const immutable = pathname.startsWith('/assets/');
    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    try {
      if (url.pathname.startsWith('/api/')) {
        if (!authorized(req, token)) throw new HttpError(401, 'Missing or wrong API token');
        const parts = url.pathname.slice('/api/'.length).split('/').filter(Boolean);
        await handleApi(req, res, parts);
      } else if (req.method === 'GET' || req.method === 'HEAD') {
        serveStatic(req, res, url.pathname);
      } else {
        throw new HttpError(405, 'Method not allowed');
      }
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 502;
      if (!res.headersSent) sendJson(res, status, { error: (err as Error).message });
      else res.end();
    }
  });

  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<WebSocket>();
  const broadcast = (msg: unknown) => {
    const text = JSON.stringify(msg);
    for (const c of clients) if (c.readyState === c.OPEN) c.send(text);
  };
  manager.on('changed', (hub) => broadcast({ type: 'hub', hub }));
  manager.on('removed', (id) => broadcast({ type: 'removed', id }));

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname !== '/api/events' || !authorized(req, token)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      clients.add(ws);
      ws.on('close', () => clients.delete(ws));
      ws.send(JSON.stringify({ type: 'snapshot', hubs: manager.list().map(hubState) }));
    });
  });

  // Keep idle phone connections from being silently dropped by NAT/Wi-Fi.
  const ping = setInterval(() => {
    for (const c of clients) c.ping();
  }, 30_000);
  server.on('close', () => {
    clearInterval(ping);
    for (const c of clients) c.terminate();
  });

  return server;
}
