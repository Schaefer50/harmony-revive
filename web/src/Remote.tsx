import { useEffect, useMemo, useRef, useState } from 'react';
import type { CommandGroup, HubCommand } from './api';

interface RemoteProps {
  groups: CommandGroup[];
  onPress: (command: string) => void;
}

// Harmony uses fairly consistent command names across devices; these pull the
// common ones into a physical-remote layout. Anything else lands in "More".
const POWER = ['PowerToggle', 'PowerOn', 'PowerOff'];
const NAV = ['DirectionUp', 'DirectionDown', 'DirectionLeft', 'DirectionRight', 'Select', 'OK'];
const MENU = ['Home', 'Menu', 'Guide', 'Info', 'Back', 'Return', 'Exit', 'Options'];
const VOLUME = ['VolumeUp', 'VolumeDown', 'Mute'];
const CHANNEL = ['ChannelUp', 'ChannelDown', 'PrevChannel'];
const TRANSPORT = ['SkipBack', 'Rewind', 'Play', 'Pause', 'Stop', 'FastForward', 'SkipForward', 'Record'];
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
const digitName = (c: HubCommand) => c.name.replace(/^Number/, '');

const ICONS: Record<string, string> = {
  DirectionUp: '▲',
  DirectionDown: '▼',
  DirectionLeft: '◀',
  DirectionRight: '▶',
  VolumeUp: '+',
  VolumeDown: '−',
  ChannelUp: '▲',
  ChannelDown: '▼',
  Play: '▶',
  Pause: '❚❚',
  Stop: '■',
  Rewind: '◀◀',
  FastForward: '▶▶',
  SkipBack: '⏮',
  SkipForward: '⏭',
  Record: '●',
};

/** Fires on press, then repeats while held (volume, channel, arrows). */
function useHold(fire: () => void, repeat: boolean) {
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const stop = () => {
    timers.current.forEach(clearTimeout);
    timers.current.forEach(clearInterval);
    timers.current = [];
  };
  useEffect(() => stop, []);
  return {
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      fire();
      if (repeat) {
        timers.current.push(setTimeout(() => timers.current.push(setInterval(fire, 150)), 450));
      }
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  };
}

function Key({
  cmd,
  onPress,
  className = '',
  repeat = false,
  label,
}: {
  cmd: HubCommand;
  onPress: (c: string) => void;
  className?: string;
  repeat?: boolean;
  label?: string;
}) {
  const hold = useHold(() => {
    navigator.vibrate?.(8);
    onPress(cmd.name);
  }, repeat);
  return (
    <button type="button" className={`key ${className}`} title={cmd.label} aria-label={cmd.label} {...hold}>
      {label ?? ICONS[cmd.name] ?? cmd.label}
    </button>
  );
}

export function Remote({ groups, onPress }: RemoteProps) {
  const [showMore, setShowMore] = useState(false);
  const [showDigits, setShowDigits] = useState(false);

  const byName = useMemo(() => {
    const m = new Map<string, HubCommand>();
    for (const g of groups) for (const c of g.commands) if (!m.has(c.name)) m.set(c.name, c);
    return m;
  }, [groups]);

  const pick = (names: string[]) => names.map((n) => byName.get(n)).filter((c): c is HubCommand => !!c);
  const digits = useMemo(() => {
    const m = new Map<string, HubCommand>();
    for (const c of byName.values()) {
      const d = digitName(c);
      if (DIGITS.includes(d) && !m.has(d)) m.set(d, c);
    }
    return m;
  }, [byName]);

  const shown = new Set([...POWER, ...NAV, ...MENU, ...VOLUME, ...CHANNEL, ...TRANSPORT]);
  for (const c of digits.values()) shown.add(c.name);
  const rest = groups
    .map((g) => ({ ...g, commands: g.commands.filter((c) => !shown.has(c.name)) }))
    .filter((g) => g.commands.length > 0);

  const up = byName.get('DirectionUp');
  const down = byName.get('DirectionDown');
  const left = byName.get('DirectionLeft');
  const right = byName.get('DirectionRight');
  const select = byName.get('Select') ?? byName.get('OK');
  const hasNav = !!(up || down || left || right || select);

  const volUp = byName.get('VolumeUp');
  const volDown = byName.get('VolumeDown');
  const mute = byName.get('Mute');
  const chUp = byName.get('ChannelUp');
  const chDown = byName.get('ChannelDown');
  const prev = byName.get('PrevChannel');

  if (byName.size === 0) {
    return <p className="empty">No buttons for this one.</p>;
  }

  return (
    <div className="remote">
      {pick([...POWER, ...MENU]).length > 0 && (
        <div className="row wrap">
          {pick([...POWER, ...MENU]).map((c) => (
            <Key key={c.name} cmd={c} onPress={onPress} className="pill" />
          ))}
        </div>
      )}

      {hasNav && (
        <div className="dpad">
          {up && <Key cmd={up} onPress={onPress} className="d-up" repeat />}
          {left && <Key cmd={left} onPress={onPress} className="d-left" repeat />}
          {select && <Key cmd={select} onPress={onPress} className="d-ok" label="OK" />}
          {right && <Key cmd={right} onPress={onPress} className="d-right" repeat />}
          {down && <Key cmd={down} onPress={onPress} className="d-down" repeat />}
        </div>
      )}

      {(volUp || volDown || chUp || chDown || mute || prev) && (
        <div className="rockers">
          {(volUp || volDown) && (
            <div className="rocker">
              {volUp && <Key cmd={volUp} onPress={onPress} repeat />}
              <span>VOL</span>
              {volDown && <Key cmd={volDown} onPress={onPress} repeat />}
            </div>
          )}
          <div className="rocker-mid">
            {mute && <Key cmd={mute} onPress={onPress} className="pill" />}
            {prev && <Key cmd={prev} onPress={onPress} className="pill" label="Last" />}
          </div>
          {(chUp || chDown) && (
            <div className="rocker">
              {chUp && <Key cmd={chUp} onPress={onPress} repeat />}
              <span>CH</span>
              {chDown && <Key cmd={chDown} onPress={onPress} repeat />}
            </div>
          )}
        </div>
      )}

      {pick(TRANSPORT).length > 0 && (
        <div className="row transport">
          {pick(TRANSPORT).map((c) => (
            <Key key={c.name} cmd={c} onPress={onPress} className={c.name === 'Record' ? 'rec' : ''} />
          ))}
        </div>
      )}

      {digits.size > 0 && (
        <section>
          <button type="button" className="disclosure" onClick={() => setShowDigits((v) => !v)}>
            {showDigits ? '▾' : '▸'} Number pad
          </button>
          {showDigits && (
            <div className="numpad">
              {DIGITS.map((d) => {
                const c = digits.get(d);
                return c ? (
                  <Key key={d} cmd={c} onPress={onPress} label={d} className={d === '0' ? 'zero' : ''} />
                ) : null;
              })}
            </div>
          )}
        </section>
      )}

      {rest.length > 0 && (
        <section>
          <button type="button" className="disclosure" onClick={() => setShowMore((v) => !v)}>
            {showMore ? '▾' : '▸'} More buttons ({rest.reduce((n, g) => n + g.commands.length, 0)})
          </button>
          {showMore &&
            rest.map((g) => (
              <div key={g.name} className="group">
                <h4>{g.name.replace(/([a-z])([A-Z])/g, '$1 $2')}</h4>
                <div className="row wrap">
                  {g.commands.map((c) => (
                    <Key key={c.name} cmd={c} onPress={onPress} className="pill" label={c.label} />
                  ))}
                </div>
              </div>
            ))}
        </section>
      )}
    </div>
  );
}
