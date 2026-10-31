# Harmony Revive

Cloud-free control for Logitech Harmony Hub + Elite remotes, from iPhone, Android and any web browser.

Logitech has stopped making Harmony remotes, and the older Harmony Remote software was shut down in 2025. Harmony Revive talks to your hub directly over your home network, using the hub's own local API. It never contacts Logitech's servers.

**Nothing is flashed or modified on your hub or remotes.** The app only sends the same commands Home Assistant and other local integrations use, so there is no bricking risk. Your Elite remotes keep working exactly as they do today.

## What it does (v0.1)

- Start and stop Activities, and turn everything off, with live status from the hub
- A full remote for the running Activity: D-pad, volume, channel, transport, number pad, and every other button
- Control any individual device directly
- Hold to repeat for volume, channel and arrows
- Several hubs, switchable from the header
- Installs to the home screen on iPhone and Android, and works in any desktop browser

## How it works

```
 iPhone / Android / browser  ──HTTP + WebSocket──▶  Harmony Revive server  ──local WebSocket :8088──▶  Harmony Hub
                                                     (any always-on computer                          ──IR / RF──▶ TV, AVR…
                                                      on your network)
```

The small server runs on any always-on computer on your home network: a Raspberry Pi, a NAS, a Mac mini, or a PC. Phones and browsers can't talk to the hub directly because of browser security rules, so the server sits in between. It is also where future features will live, like adding new devices without Logitech's cloud.

## Setup

You need the hub's IP address. In the Harmony app it's on the hub's **Versions** screen (for example `10.0.0.26`). A DHCP reservation for the hub in your router keeps that address from changing.

### Option A: Docker (Raspberry Pi, NAS, any computer)

```sh
git clone https://github.com/Schaefer50/harmony-revive.git
cd harmony-revive
# edit HARMONY_HUBS in docker-compose.yml if your hub isn't 10.0.0.26
docker compose up -d --build
```

### Option B: Node.js (Mac, PC, Linux)

Requires Node.js 20 or newer.

```sh
git clone https://github.com/Schaefer50/harmony-revive.git
cd harmony-revive
npm install
npm run build
HARMONY_HUBS=10.0.0.26 npm start
```

### Open the app

On your phone or computer (same Wi-Fi), open `http://<server-ip>:8787`, where `<server-ip>` is the IP of the computer running the server.

- **iPhone:** in Safari, tap Share → **Add to Home Screen**.
- **Android:** in Chrome, tap ⋮ → **Add to Home screen** (or **Install app**).

You can add more hubs from ⚙ Settings in the app.

### Settings

| Variable       | Default       | Meaning                                                     |
| -------------- | ------------- | ----------------------------------------------------------- |
| `HARMONY_HUBS` | (none)        | Comma-separated hub IPs to add at startup                   |
| `PORT`         | `8787`        | Port the app is served on                                   |
| `DATA_DIR`     | `./data`      | Where the hub list is saved                                 |
| `API_TOKEN`    | (none)        | If set, the app asks for this token before it can do anything |

## Troubleshooting

- **"Connecting to hub…" never finishes:** check the hub's IP, and that the server computer is on the same network as the hub (not a guest Wi-Fi). Open `http://<server-ip>:8787/api/hubs` to see the exact error.
- **A button does nothing:** the app sends the same command the Harmony app would. If the button doesn't work there either, the IR code itself is the problem.

## Development

```sh
npm install
npm run mock-hub              # fake hub on 127.0.0.1:18088
HARMONY_HUBS=127.0.0.1:18088 npm run dev   # server on :8787
npm run dev:web               # UI with hot reload on :5173
npm test                      # protocol + API tests against the fake hub
```

- `server/src/hub.ts`: Harmony Hub local protocol client
- `server/src/api.ts`: REST + WebSocket API for the apps
- `web/src`: React app (installable PWA)

## Roadmap

1. **Now:** local control of everything already set up on your hubs.
2. **Next:** native iPhone/Android app wrappers, a home-screen widget, and Siri/Google shortcuts.
3. **Then:** add new devices without Logitech's cloud. The stock hub can't accept new IR codes locally, so new gear will be driven by a cheap ESP32 IR blaster ($10–15) from the same app, using open IR code databases. Roku, smart TVs and other network-controlled gear will be driven over the network.
4. **Later, optional:** support for the open-source [HarmonyNG](https://github.com/iranl/harmony-ng) hub firmware. It would let new devices sync to the Elite remotes themselves, at the cost of rooting the hub. This step is only for a spare hub, and only after the firmware has matured.

## Credits

The hub protocol was reverse-engineered by the community, especially [aioharmony](https://github.com/Harmony-Libs/aioharmony) (Home Assistant) and [harmonyhub-api](https://github.com/JordanMartin/harmonyhub-api).

Not affiliated with Logitech. Harmony is a trademark of Logitech.
