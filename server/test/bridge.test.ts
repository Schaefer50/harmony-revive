import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import WebSocket from 'ws';
import { createApi } from '../src/api.js';
import { HarmonyHub } from '../src/hub.js';
import { HubManager } from '../src/hubManager.js';
import { startMockHub, type MockHub } from './mockHub.js';

const until = async (cond: () => boolean, ms = 3_000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe('HarmonyHub client', () => {
  let mock: MockHub;
  let hub: HarmonyHub;

  before(async () => {
    mock = await startMockHub();
    hub = new HarmonyHub('127.0.0.1', { port: mock.port });
    await hub.start();
  });
  after(async () => {
    hub.stop();
    await mock.close();
  });

  test('connects and loads config', () => {
    assert.equal(hub.connected, true);
    assert.equal(hub.name, 'Mock Living Room');
    assert.deepEqual(
      hub.config.activities.map((a) => a.label),
      ['Watch TV', 'Listen to Music'],
    );
    assert.deepEqual(
      hub.config.devices.map((d) => d.label),
      ['Denon AV Receiver', 'Samsung TV'],
    );
    assert.equal(hub.currentActivityId, '-1');
    assert.equal(hub.activityStatus, 'off');
  });

  test('presses a device button with the hub action string, press then release', async () => {
    mock.presses.length = 0;
    await hub.pressCommand('101', 'VolumeUp');
    await until(() => mock.presses.length === 2);
    assert.deepEqual(
      mock.presses.map((p) => p.status),
      ['press', 'release'],
    );
    assert.equal(mock.presses[0].action, '{"command"::"VolumeUp","type"::"IRCommand","deviceId"::"101"}');
  });

  test('starts an activity and tracks state from notifications', async () => {
    await hub.startActivity('30001');
    await until(() => hub.currentActivityId === '30001' && hub.activityStatus === 'on');
    await hub.powerOff();
    await until(() => hub.currentActivityId === '-1' && hub.activityStatus === 'off');
  });

  test('rejects an unknown activity', async () => {
    await assert.rejects(hub.startActivity('99999'), /rejected/);
  });

  test('reconnects after the hub drops the connection', async () => {
    mock.dropConnections();
    await until(() => !hub.connected);
    await until(() => hub.connected, 5_000);
    await hub.pressCommand('102', 'Select');
  });
});

describe('bridge API', () => {
  let mock: MockHub;
  let dataDir: string;
  let manager: HubManager;
  let base: string;
  let server: ReturnType<typeof createApi>;
  const token = 'secret';

  const api = (p: string, init: RequestInit = {}) =>
    fetch(base + p, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...init.headers },
    });

  before(async () => {
    mock = await startMockHub();
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harmony-revive-'));
    manager = new HubManager(dataDir);
    await manager.init([]);
    server = createApi({ manager, token });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(async () => {
    manager.stopAll();
    await new Promise((r) => server.close(r));
    await mock.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const hubId = () => `127.0.0.1:${mock.port}`;

  test('requires the token', async () => {
    const res = await fetch(base + '/api/hubs');
    assert.equal(res.status, 401);
  });

  test('adds a hub and persists it', async () => {
    const res = await api('/api/hubs', { method: 'POST', body: JSON.stringify({ host: '127.0.0.1', port: mock.port }) });
    assert.equal(res.status, 201);
    await until(() => manager.get(hubId())?.connected === true && manager.get(hubId())!.config.devices.length > 0);
    const saved = JSON.parse(await fs.readFile(path.join(dataDir, 'hubs.json'), 'utf8'));
    assert.deepEqual(saved, [{ host: '127.0.0.1', port: mock.port }]);
  });

  test('rejects a bad host', async () => {
    const res = await api('/api/hubs', { method: 'POST', body: JSON.stringify({ host: 'http://evil/' }) });
    assert.equal(res.status, 400);
  });

  test('serves config and presses buttons', async () => {
    const id = encodeURIComponent(hubId());
    const config = await (await api(`/api/hubs/${id}/config`)).json();
    assert.equal(config.devices[1].label, 'Samsung TV');

    mock.presses.length = 0;
    const res = await api(`/api/hubs/${id}/press`, { method: 'POST', body: JSON.stringify({ targetId: '30001', command: 'Mute' }) });
    assert.equal(res.status, 200);
    await until(() => mock.presses.length === 2);

    const bad = await api(`/api/hubs/${id}/press`, { method: 'POST', body: JSON.stringify({ targetId: '101', command: 'Nope' }) });
    assert.equal(bad.status, 404);
  });

  test('pushes live activity changes over the events socket', async () => {
    const ws = new WebSocket(base.replace('http', 'ws') + `/api/events?token=${token}`);
    const messages: any[] = [];
    ws.on('message', (d) => messages.push(JSON.parse(d.toString())));
    await until(() => messages.some((m) => m.type === 'snapshot'));

    const id = encodeURIComponent(hubId());
    const res = await api(`/api/hubs/${id}/activity`, { method: 'POST', body: JSON.stringify({ activityId: '30002' }) });
    assert.equal(res.status, 200);
    await until(() => messages.some((m) => m.type === 'hub' && m.hub.currentActivityId === '30002' && m.hub.activityStatus === 'on'));
    ws.close();
  });

  test('removes a hub', async () => {
    const res = await api(`/api/hubs/${encodeURIComponent(hubId())}`, { method: 'DELETE' });
    assert.equal(res.status, 200);
    assert.equal(manager.list().length, 0);
  });
});
