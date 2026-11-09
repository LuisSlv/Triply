// Tiny inline stroke icons (24×24).
const S = (body, fill = false) =>
  `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" ${fill ? 'fill="currentColor" stroke="none"' : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'}>${body}</svg>`;

export const ICON = {
  back: S('<path d="M15 18l-6-6 6-6"/>'),
  search: S('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'),
  x: S('<path d="M18 6L6 18M6 6l12 12"/>'),
  more: S('<circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/>', true),
  locate: S('<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
  plus: S('<path d="M12 5v14M5 12h14"/>'),
  check: S('<path d="M5 12.5l4.5 4.5L19 7"/>'),
  play: S('<path d="M8 5.5v13l10-6.5z"/>', true),
  stop: S('<rect x="6" y="6" width="12" height="12" rx="2"/>', true),
  star: S('<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.6l1-5.8-4.3-4.1 5.9-.9z"/>'),
  ext: S('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
  nav: S('<path d="M3 11l18-8-8 18-2-8z"/>'),
  calendar: S('<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  map: S('<path d="M9 4L3 6.5V20l6-2.5 6 2.5 6-2.5V4l-6 2.5zM9 4v13.5M15 6.5V20"/>'),
  up: S('<path d="M6 15l6-6 6 6"/>'),
  down: S('<path d="M6 9l6 6 6-6"/>'),
  trash: S('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  edit: S('<path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/>'),
  rec: S('<circle cx="12" cy="12" r="6"/>', true),
  clock: S('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  list: S('<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>'),
  refresh: S('<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>'),
  upload: S('<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>'),
  download: S('<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>'),
  info: S('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>'),
};

export const LOGO = `<svg class="logo" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="16" fill="var(--accent)"/><path d="M32 13c-8.3 0-15 6.5-15 14.6C17 39 32 52 32 52s15-13 15-24.4C47 19.5 40.3 13 32 13z" fill="#fff"/><circle cx="32" cy="27.5" r="5.6" fill="var(--accent)"/></svg>`;
