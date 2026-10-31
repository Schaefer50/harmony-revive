// A fake Harmony Hub speaking the same local protocol as the real one, for
// tests and for working on the UI without hardware.
//
//   npm run mock-hub            # listens on 18088
//   HARMONY_HUBS=127.0.0.1:18088 npm run dev

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';

export const REMOTE_ID = '12345678';

const act = (cmd: string, deviceId: string) =>
  `{"command"::"${cmd}","type"::"IRCommand","deviceId"::"${deviceId}"}`;

const fn = (name: string, deviceId: string, label = name) => ({ name, label, action: act(name, deviceId) });

export const MOCK_CONFIG = {
  activity: [
    { id: '-1', label: 'PowerOff', activityOrder: 0 },
    {
      id: '30001',
      label: 'Watch TV',
      activityOrder: 1,
      controlGroup: [
        { name: 'Volume', function: [fn('VolumeUp', '101', 'Volume Up'), fn('VolumeDown', '101', 'Volume Down'), fn('Mute', '101')] },
        { name: 'NavigationBasic', function: [fn('DirectionUp', '102', 'Up'), fn('DirectionDown', '102', 'Down'), fn('DirectionLeft', '102', 'Left'), fn('DirectionRight', '102', 'Right'), fn('Select', '102', 'OK')] },
        { name: 'Channel', function: [fn('ChannelUp', '102', 'Channel Up'), fn('ChannelDown', '102', 'Channel Down')] },
      ],
    },
    {
      id: '30002',
      label: 'Listen to Music',
      activityOrder: 2,
      controlGroup: [{ name: 'Volume', function: [fn('VolumeUp', '101', 'Volume Up'), fn('VolumeDown', '101', 'Volume Down')] }],
    },
  ],
  device: [
    {
      id: '101',
      label: 'Denon AV Receiver',
      manufacturer: 'Denon',
      model: 'AVR-X3700H',
      type: 'StereoReceiver',
      controlGroup: [
        { name: 'Power', function: [fn('PowerOn', '101', 'Power On'), fn('PowerOff', '101', 'Power Off')] },
        { name: 'Volume', function: [fn('VolumeUp', '101', 'Volume Up'), fn('VolumeDown', '101', 'Volume Down'), fn('Mute', '101')] },
      ],
    },
    {
      id: '102',
      label: 'Samsung TV',
      manufacturer: 'Samsung',
      model: 'QN65Q80',
      type: 'Television',
      controlGroup: [
        { name: 'Power', function: [fn('PowerToggle', '102', 'Power')] },
        { name: 'NavigationBasic', function: [fn('DirectionUp', '102', 'Up'), fn('DirectionDown', '102', 'Down'), fn('Select', '102', 'OK')] },
        { name: 'NumericBasic', function: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].map((n) => fn(n, '102')) },
      ],
    },
  ],
};

export interface MockHub {
  port: number;
  presses: { action: string; status: string }[];
  currentActivityId: string;
  /** Drop every client connection, as a hub reboot would. */
  dropConnections(): void;
  close(): Promise<void>;
}

export async function startMockHub(port = 0): Promise<MockHub> {
  const state: MockHub = {
    port: 0,
    presses: [],
    currentActivityId: '-1',
    dropConnections: () => {
      for (const c of wss.clients) c.terminate();
    },
    close: () =>
      new Promise((resolve) => {
        for (const c of wss.clients) c.terminate();
        wss.close();
        server.close(() => resolve());
      }),
  };

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const msg = JSON.parse(body || '{}');
      if (req.method === 'POST' && msg.cmd === 'setup.account?getProvisionInfo') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ cmd: msg.cmd, code: 200, msg: 'OK', data: { activeRemoteId: Number(REMOTE_ID), discoveryServer: 'https://svcs.myharmony.com/Discovery/Discovery.svc' } }));
        return;
      }
      res.writeHead(404).end();
    });
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.searchParams.get('hubId') !== REMOTE_ID) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
  });

  const notify = (activityId: string, activityStatus: number) => {
    const text = JSON.stringify({ type: 'connect.stateDigest?notify', data: { activityId, activityStatus, configVersion: 7, syncStatus: 0 } });
    for (const c of wss.clients) c.send(text);
  };

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      const { hubId, hbus } = JSON.parse(raw.toString());
      if (hubId !== REMOTE_ID) return;
      const reply = (data: unknown, code = 200) => ws.send(JSON.stringify({ cmd: hbus.cmd, code, id: hbus.id, msg: 'OK', data }));
      switch (hbus.cmd) {
        case 'vnd.logitech.harmony/vnd.logitech.harmony.engine?config':
          return reply(MOCK_CONFIG);
        case 'vnd.logitech.harmony/vnd.logitech.harmony.engine?getCurrentActivity':
          return reply({ result: state.currentActivityId });
        case 'vnd.logitech.connect/vnd.logitech.statedigest?get':
          return reply({ activityId: state.currentActivityId, activityStatus: 0, configVersion: 7, syncStatus: 0 });
        case 'connect.discoveryinfo?get':
          return reply({ friendlyName: 'Mock Living Room', remoteId: REMOTE_ID });
        case 'vnd.logitech.harmony/vnd.logitech.harmony.engine?holdAction':
          state.presses.push({ action: hbus.params.action, status: hbus.params.status });
          return reply({});
        case 'harmony.activityengine?runactivity': {
          const target = String(hbus.params.activityId);
          if (target !== '-1' && !MOCK_CONFIG.activity.some((a) => a.id === target)) {
            return reply({}, 404);
          }
          reply({}, 100);
          const off = target === '-1';
          notify(off ? state.currentActivityId : target, off ? 3 : 1);
          setTimeout(() => {
            state.currentActivityId = target;
            notify(target, off ? 0 : 2);
            ws.send(JSON.stringify({ type: 'harmony.engine?startActivityFinished', data: { activityId: target } }));
          }, 50);
          return;
        }
        default:
          return reply({}, 404);
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  state.port = (server.address() as AddressInfo).port;
  return state;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const hub = await startMockHub(Number(process.env.MOCK_PORT ?? 18088));
  console.log(`Mock Harmony Hub listening on 127.0.0.1:${hub.port}`);
}
