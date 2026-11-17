import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, getToken, setToken, subscribe, type HubConfig, type HubState } from './api';
import { activityIcon, deviceIcon, gradientFor, Icons } from './icons';
import { Remote } from './Remote';

const SELECTED_HUB_KEY = 'harmony-revive.hub';

function loadSelectedHub(): string | null {
  try {
    return localStorage.getItem(SELECTED_HUB_KEY);
  } catch {
    return null;
  }
}

export function App() {
  const [hubs, setHubs] = useState<HubState[]>([]);
  const [hubId, setHubId] = useState<string | null>(loadSelectedHub);
  const [config, setConfig] = useState<HubConfig | null>(null);
  const [target, setTarget] = useState<string | null>(null); // activity or device id
  const [online, setOnline] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [needsToken, setNeedsToken] = useState(false);

  const hub = hubs.find((h) => h.id === hubId) ?? hubs[0] ?? null;

  const fail = useCallback((err: unknown) => {
    if (err instanceof ApiError && err.status === 401) setNeedsToken(true);
    setToast((err as Error).message);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3_500);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(
    () =>
      subscribe(
        (e) => {
          if (e.type === 'snapshot') setHubs(e.hubs);
          else if (e.type === 'hub')
            setHubs((prev) => {
              const i = prev.findIndex((h) => h.id === e.hub.id);
              if (i < 0) return [...prev, e.hub];
              const next = prev.slice();
              next[i] = e.hub;
              return next;
            });
          else if (e.type === 'removed') setHubs((prev) => prev.filter((h) => h.id !== e.id));
        },
        setOnline,
      ),
    [needsToken],
  );

  useEffect(() => {
    api.hubs().then(setHubs).catch(fail);
  }, [fail, needsToken]);

  useEffect(() => {
    if (hub?.id) {
      try {
        localStorage.setItem(SELECTED_HUB_KEY, hub.id);
      } catch {
        /* private mode */
      }
    }
  }, [hub?.id]);

  // Reload buttons whenever the hub (re)connects; config can change on the hub.
  useEffect(() => {
    if (!hub?.id || !hub.connected) return;
    let cancelled = false;
    api
      .config(hub.id)
      .then((c) => !cancelled && setConfig(c))
      .catch(fail);
    return () => {
      cancelled = true;
    };
  }, [hub?.id, hub?.connected, fail]);

  // Follow the running activity unless the user picked a device by hand.
  const runningId = hub && hub.currentActivityId !== '-1' ? hub.currentActivityId : null;
  useEffect(() => {
    setTarget(runningId);
  }, [runningId, hub?.id]);

  const activities = config?.activities ?? [];
  const devices = config?.devices ?? [];
  const running = activities.find((a) => a.id === runningId) ?? null;
  const targetKind = activities.some((a) => a.id === target) ? 'activity' : 'device';
  const targetGroups =
    activities.find((a) => a.id === target)?.groups ?? devices.find((d) => d.id === target)?.groups ?? null;

  const press = (command: string) => {
    if (!hub || !target) return;
    api.press(hub.id, target, command).catch(fail);
  };

  const busy = hub?.activityStatus === 'starting' || hub?.activityStatus === 'stopping';
  const starting = hub?.activityStatus === 'starting';

  return (
    <div className="app">
      <header>
        <button type="button" className="hub-picker" onClick={() => hubs.length > 1 && setSettingsOpen(true)}>
          <span className={`dot ${online && hub?.connected ? 'ok' : 'bad'}`} />
          <span className="hub-name">{hub?.name ?? 'Harmony Revive'}</span>
          {hubs.length > 1 && <span className="chev">▾</span>}
        </button>
        <button type="button" className="icon" aria-label="Settings" onClick={() => setSettingsOpen(true)}>
          <Icons.remote className="ic" />
        </button>
      </header>

      {!online && <div className="banner">Can't reach the Harmony Revive server. Reconnecting…</div>}
      {online && hub && !hub.connected && (
        <div className="banner">
          Connecting to hub at {hub.host}… {hub.error ? `(${hub.error})` : ''}
        </div>
      )}

      {hubs.length === 0 && online ? (
        <Settings hubs={hubs} needsToken={needsToken} onTokenSaved={() => setNeedsToken(false)} onError={fail} inline />
      ) : (
        <main>
          {running ? (
            <NowPlaying
              label={running.label}
              status={hub?.activityStatus === 'starting' ? 'Starting…' : 'On now'}
              onOff={() => hub && api.powerOff(hub.id).catch(fail)}
              offBusy={busy}
            />
          ) : (
            <div className="idle-hero">
              <Icons.power className="idle-ic" />
              <div>
                <strong>Everything's off</strong>
                <span>Pick an activity to get started</span>
              </div>
            </div>
          )}

          <section className="activities">
            {activities.map((a) => {
              const Icon = Icons[activityIcon(a.label)];
              const isOn = a.id === runningId;
              const isStarting = starting && a.id === hub?.currentActivityId;
              return (
                <button
                  key={a.id}
                  type="button"
                  className={`activity ${isOn ? 'active' : ''}`}
                  style={{ ['--art' as string]: gradientFor(a.label) }}
                  disabled={!hub?.connected || busy}
                  onClick={() => hub && api.startActivity(hub.id, a.id).catch(fail)}
                >
                  <span className="art" aria-hidden="true">
                    <Icon className="art-ic" />
                  </span>
                  <span className="activity-label">{a.label}</span>
                  <span className="activity-state">
                    {isStarting ? 'Starting…' : isOn ? 'On' : 'Start'}
                  </span>
                </button>
              );
            })}
          </section>

          {(devices.length > 0 || running) && (
            <nav className="targets" aria-label="Control a device">
              {running && (
                <Chip icon="remote" label={running.label} on={target === running.id} onClick={() => setTarget(running.id)} />
              )}
              {devices.map((d) => (
                <Chip
                  key={d.id}
                  icon={deviceIcon(d.label, d.type)}
                  label={d.label}
                  on={target === d.id}
                  onClick={() => setTarget(d.id)}
                />
              ))}
            </nav>
          )}

          {targetGroups ? (
            <div className={`remote-wrap ${targetKind}`}>
              <Remote key={target} groups={targetGroups} onPress={press} />
            </div>
          ) : (
            hub?.connected && <p className="empty">Start an activity, or pick a device above to control it directly.</p>
          )}
        </main>
      )}

      {settingsOpen && (
        <div className="sheet-backdrop" onClick={() => setSettingsOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            {hubs.length > 1 && (
              <div className="hub-switch">
                {hubs.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    className={h.id === hub?.id ? 'on' : ''}
                    onClick={() => {
                      setHubId(h.id);
                      setSettingsOpen(false);
                    }}
                  >
                    <span className={`dot ${h.connected ? 'ok' : 'bad'}`} />
                    {h.name}
                  </button>
                ))}
              </div>
            )}
            <Settings
              hubs={hubs}
              needsToken={needsToken}
              onTokenSaved={() => setNeedsToken(false)}
              onError={fail}
              onRefresh={hub ? () => api.refresh(hub.id).then(setConfig).catch(fail) : undefined}
            />
            <button type="button" className="close" onClick={() => setSettingsOpen(false)}>
              Done
            </button>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function NowPlaying({
  label,
  status,
  onOff,
  offBusy,
}: {
  label: string;
  status: string;
  onOff: () => void;
  offBusy: boolean;
}) {
  const Icon = Icons[activityIcon(label)];
  return (
    <div className="now-playing" style={{ ['--art' as string]: gradientFor(label) }}>
      <span className="np-art" aria-hidden="true">
        <Icon className="np-ic" />
      </span>
      <div className="np-text">
        <small>{status}</small>
        <strong>{label}</strong>
      </div>
      <button type="button" className="np-off" onClick={onOff} disabled={offBusy} aria-label="Turn everything off">
        <Icons.power className="ic" />
        <span>Off</span>
      </button>
    </div>
  );
}

function Chip({
  icon,
  label,
  on,
  onClick,
}: {
  icon: keyof typeof Icons;
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  const Icon = Icons[icon];
  return (
    <button type="button" className={`chip ${on ? 'on' : ''}`} onClick={onClick}>
      <Icon className="chip-ic" />
      {label}
    </button>
  );
}

function Settings({
  hubs,
  needsToken,
  onTokenSaved,
  onError,
  onRefresh,
  inline,
}: {
  hubs: HubState[];
  needsToken: boolean;
  onTokenSaved: () => void;
  onError: (e: unknown) => void;
  onRefresh?: () => void;
  inline?: boolean;
}) {
  const [host, setHost] = useState('');
  const [token, setTokenInput] = useState(getToken());
  const [adding, setAdding] = useState(false);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    try {
      await api.addHub(host.trim());
      setHost('');
    } catch (err) {
      onError(err);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className={`settings ${inline ? 'inline' : ''}`}>
      {inline && (
        <>
          <h2>Add your Harmony Hub</h2>
          <p className="hint">
            The Harmony app's Versions screen for your hub shows its IP address (listed as Hub IP Address, e.g.
            10.0.0.26).
          </p>
        </>
      )}

      {needsToken && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setToken(token.trim());
            onTokenSaved();
          }}
        >
          <label>
            API token
            <input value={token} onChange={(e) => setTokenInput(e.target.value)} placeholder="From API_TOKEN on the server" />
          </label>
          <button type="submit">Save token</button>
        </form>
      )}

      <form onSubmit={add}>
        <label>
          Hub IP address
          <input
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="10.0.0.26"
            inputMode="decimal"
            autoCapitalize="off"
            autoCorrect="off"
          />
        </label>
        <button type="submit" disabled={!host.trim() || adding}>
          {adding ? 'Adding…' : 'Add hub'}
        </button>
      </form>

      {hubs.length > 0 && (
        <ul className="hub-list">
          {hubs.map((h) => (
            <li key={h.id}>
              <span className={`dot ${h.connected ? 'ok' : 'bad'}`} />
              <span className="grow">
                {h.name}
                <small>{h.host}</small>
              </span>
              <button
                type="button"
                className="link danger"
                onClick={() => {
                  if (confirm(`Remove ${h.name} from this app? (Nothing on the hub changes.)`)) {
                    api.removeHub(h.id).catch(onError);
                  }
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {onRefresh && (
        <button type="button" className="secondary" onClick={onRefresh}>
          Reload buttons from hub
        </button>
      )}
    </div>
  );
}
