/** Inline stroke icons (24-unit grid), drawn for this app. */
const PATHS: Record<string, string> = {
  search: 'M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15zM16 16l5 5',
  settings:
    'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7.7 7.7 0 0 1-2 1.2L14.8 21h-4l-.3-2.4a7.7 7.7 0 0 1-2-1.2l-1.9.7-2-3.4 1.6-1.2a7.6 7.6 0 0 1 0-2.4L4.6 9.9l2-3.4 1.9.7a7.7 7.7 0 0 1 2-1.2L10.8 3h4l.3 2.4a7.7 7.7 0 0 1 2 1.2l1.9-.7 2 3.4-1.6 1.2a7.6 7.6 0 0 1 0 2.4z',
  play: 'M7 4.5v15l12-7.5z',
  star: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  retry: 'M4 12a8 8 0 1 0 2.3-5.6M4 4v4.5h4.5',
  back: 'M15 5l-7 7 7 7',
  next: 'M9 5l7 7-7 7',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5h.01',
  tv: 'M3.5 6.5h17v11h-17zM8.5 21h7',
  ball: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5l3.8 2.8-1.5 4.4H9.7l-1.5-4.4z',
};

export function Icon({ name, size = 28 }: { name: keyof typeof PATHS | string; size?: number }) {
  const d = PATHS[name] || PATHS.info;
  return (
    <svg class="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
