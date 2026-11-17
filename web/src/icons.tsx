// Inline SVG icons, picked by guessing an activity/device "kind" from its label
// and Harmony device type. Keeps the UI looking like a modern remote app
// without shipping an icon font or raster art.

type IconProps = { className?: string };
const svg = (path: React.ReactNode) => (p: IconProps) => (
  <svg viewBox="0 0 24 24" className={p.className} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {path}
  </svg>
);

export const Icons = {
  tv: svg(<><rect x="2" y="4" width="20" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></>),
  movie: svg(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 4v16M17 4v16M3 9h4M17 9h4M3 15h4M17 15h4" /></>),
  music: svg(<><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>),
  game: svg(<><rect x="2" y="7" width="20" height="10" rx="5" /><path d="M7 11v2M6 12h2M15.5 11.5h.01M18 13.5h.01" /></>),
  stream: svg(<><circle cx="12" cy="12" r="2" /><path d="M8.5 8.5a5 5 0 000 7M15.5 8.5a5 5 0 010 7M5.5 5.5a9 9 0 000 13M18.5 5.5a9 9 0 010 13" /></>),
  speaker: svg(<><rect x="5" y="2" width="14" height="20" rx="2" /><circle cx="12" cy="15" r="3.5" /><circle cx="12" cy="6" r="1" /></>),
  receiver: svg(<><rect x="2" y="7" width="20" height="10" rx="1.5" /><path d="M6 11h3M6 13.5h3" /><circle cx="17" cy="12" r="1.6" /></>),
  cable: svg(<><rect x="2" y="7" width="20" height="10" rx="1.5" /><path d="M6 12h6" /><circle cx="17" cy="12" r="1.4" /></>),
  roku: svg(<><rect x="2" y="7" width="20" height="10" rx="1.5" /><path d="M6 12h5" /><circle cx="16.5" cy="12" r="1.6" /></>),
  lights: svg(<><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 00-4 10.5c.7.7 1 1.3 1 2.5h6c0-1.2.3-1.8 1-2.5A6 6 0 0012 3z" /></>),
  power: svg(<><path d="M12 4v8" /><path d="M7.5 7a7 7 0 109 0" /></>),
  remote: svg(<><rect x="7" y="2" width="10" height="20" rx="4" /><circle cx="12" cy="7" r="1.6" /><path d="M12 12v.01M12 15v.01M12 18v.01" /></>),
};

export type IconName = keyof typeof Icons;

const RULES: [RegExp, IconName][] = [
  [/watch|tv|television|cable|antenna|broadcast/, 'tv'],
  [/movie|blu-?ray|dvd|cinema|plex|kodi|theater|theatre/, 'movie'],
  [/music|spotify|sonos|audio|radio|vinyl|record/, 'music'],
  [/game|xbox|playstation|ps\d|nintendo|switch|wii/, 'game'],
  [/roku|apple ?tv|fire ?tv|chromecast|shield|stream|netflix|hulu|disney/, 'stream'],
  [/light|lamp|hue|lutron/, 'lights'],
];

const DEVICE_RULES: [RegExp, IconName][] = [
  [/receiver|avr|amp|denon|yamaha|onkyo|marantz|sonos ?amp/, 'receiver'],
  [/speaker|soundbar|sonos|bose/, 'speaker'],
  [/roku|apple ?tv|fire ?tv|shield|chromecast/, 'roku'],
  [/cable|satellite|directv|dish|tivo|xfinity|comcast/, 'cable'],
  [/game|xbox|playstation|ps\d|nintendo|switch/, 'game'],
  [/blu-?ray|dvd|player/, 'movie'],
  [/light|lamp|hue|lutron/, 'lights'],
  [/tv|television|samsung|lg|sony|vizio|tcl|hisense/, 'tv'],
  [/receiver|stereo/, 'receiver'],
];

function match(text: string, rules: [RegExp, IconName][]): IconName | null {
  const t = text.toLowerCase();
  for (const [re, name] of rules) if (re.test(t)) return name;
  return null;
}

export function activityIcon(label: string): IconName {
  return match(label, RULES) ?? 'tv';
}

export function deviceIcon(label: string, type = ''): IconName {
  return match(`${label} ${type}`, DEVICE_RULES) ?? 'remote';
}

// A stable warm/cool gradient per activity, so tiles read as distinct "cards"
// like streaming apps, derived from the label so it never flickers on refresh.
const GRADIENTS = [
  ['#5b8cff', '#8b5bff'],
  ['#ff7a59', '#ff5b9e'],
  ['#2bd4a7', '#2b9fd4'],
  ['#ffb648', '#ff7a59'],
  ['#a78bfa', '#6366f1'],
  ['#34d399', '#10b981'],
  ['#f472b6', '#a855f7'],
  ['#22d3ee', '#3b82f6'],
];

export function gradientFor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const [a, b] = GRADIENTS[h % GRADIENTS.length];
  return `linear-gradient(135deg, ${a}, ${b})`;
}
