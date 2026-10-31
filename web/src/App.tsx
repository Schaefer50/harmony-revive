import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, getToken, setToken, subscribe, type HubConfig, type HubState } from './api';
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
  const targetGroups =
    activities.find((a) => a.id === target)?.groups ?? devices.find((d) => d.id === target)?.groups ?? null;

  const press = (command: string) => {
    if (!hub || !target) return;
    api.press(hub.id, target, command).catch(fail);
  };

  const busy = hub?.activityStatus === 'starting' || hub?.activityStatus === 'stopping';

  return (
    <div className="app">
      <header>
        <div className="hub-picker">
          <span className={`dot ${online && hub?.connected ? 'ok' : 'bad'}`} />
          {hubs.length > 1 ? (
            <select value={hub?.id ?? ''} onChange={(e) => setHubId(e.target.value)}>
              {hubs.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          ) : (
            <strong>{hub?.name ?? 'Harmony Revive'}</strong>
          )}
        </div>
        <div className="header-actions">
          <button type="button" className="icon" aria-label="Settings" onClick={() => setSettingsOpen(true)}>
            ⚙
          </button>
          {hub && (
            <button
              type="button"
              className="power"
              aria-label="All off"
              disabled={!hub.connected || hub.currentActivityId === '-1'}
              onClick={() => api.powerOff(hub.id).catch(fail)}
            >
              ⏻
            </button>
          )}
        </div>
      </header>

      {!online && <div className="banner">Can't reach the Harmony Revive server. Reconnecting…</div>}
      {online && hub && !hub.connected && (
        <div className="banner">
          Connecting to hub at {hub.host}… {hub.error ? `(${hub.error})` : ''}
        </div>
      )}

      {hubs.length === 0 && online ? (
        <Settings
          hubs={hubs}
          needsToken={needsToken}
          onTokenSaved={() => setNeedsToken(false)}
          onError={fail}
          inline
        />
      ) : (
        <main>
          <section className="activities">
            {activities.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`activity ${a.id === runningId ? 'active' : ''}`}
                disabled={!hub?.connected || busy}
                onClick={() => hub && api.startActivity(hub.id, a.id).catch(fail)}
              >
                {a.label}
                {a.id === hub?.currentActivityId && hub?.activityStatus === 'starting' && <small>starting…</small>}
              </button>
            ))}
          </section>

          {(devices.length > 0 || running) && (
            <nav className="targets">
              {running && (
                <button
                  type="button"
                  className={target === running.id ? 'on' : ''}
                  onClick={() => setTarget(running.id)}
                >
                  {running.label}
                </button>
              )}
              {devices.map((d) => (
                <button key={d.id} type="button" className={target === d.id ? 'on' : ''} onClick={() => setTarget(d.id)}>
                  {d.label}
                </button>
              ))}
            </nav>
          )}

          {targetGroups ? (
            <Remote key={target} groups={targetGroups} onPress={press} />
          ) : (
            hub?.connected && <p className="empty">Start an activity, or pick a device above to control it directly.</p>
          )}
        </main>
      )}

      {settingsOpen && (
        <div className="sheet-backdrop" onClick={() => setSettingsOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
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
            The Harmony app's Versions screen for your hub shows its IP address (listed as Hub IP
            Address, e.g. 10.0.0.26).
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
