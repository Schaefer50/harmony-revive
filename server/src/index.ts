// Entry point. Configuration is by environment variable:
//   PORT          port to serve the app/API on (default 8787)
//   HARMONY_HUBS  comma-separated hub IPs to add on startup, e.g. 10.0.0.26
//   DATA_DIR      where the hub list is saved (default ./data)
//   WEB_ROOT      built web app folder (default ../web/dist)
//   API_TOKEN     optional; if set, apps must send it to use the API

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from './api.js';
import { HubManager } from './hubManager.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 8787);
const dataDir = path.resolve(process.env.DATA_DIR ?? 'data');
const webRoot = path.resolve(process.env.WEB_ROOT ?? path.join(here, '../../web/dist'));
const seeds = (process.env.HARMONY_HUBS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const manager = new HubManager(dataDir);
await manager.init(seeds);

const server = createApi({ manager, webRoot, token: process.env.API_TOKEN || undefined });
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use; is another copy of Harmony Revive running?`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
server.listen(port, () => {
  console.log(`Harmony Revive running on http://localhost:${port}`);
  for (const hub of manager.list()) console.log(`  hub: ${hub.id}`);
});

const shutdown = () => {
  manager.stopAll();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2_000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
