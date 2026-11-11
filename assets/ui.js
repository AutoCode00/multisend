// Small UI helpers: escaping, formatting, toast, modal, copy, download, logo, motion check.

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const short = (a, n = 4) => (a ? `${a.slice(0, 2 + n)}…${a.slice(-n)}` : '');
export const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export const hasGsap = () => !!window.gsap && !reduced();
export const fmtInt = (n) => Number(n).toLocaleString('en-US');

/** Compact number: 940210 → "940,210", 12_500_000 → "12.5M". */
export function compact(n) {
  const v = Number(n);
  if (v >= 1e9) return (v / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (v >= 1e7) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  return Math.round(v).toLocaleString('en-US');
}

export function timeAgo(ms) {
  if (!ms) return '';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

let toastTimer;
export function toast(msg, kind = 'info') {
  const t = $('#toast');
  t.textContent = msg;
  t.dataset.kind = kind;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

export async function copy(text, label = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(label + ' ✓', 'ok');
  } catch {
    toast('Copy failed — select and copy manually', 'warn');
  }
}

export function download(name, text, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Modal dialog. Returns a promise resolving to the clicked action's value (or null on cancel).
 * actions: [{ label, value, kind: 'mint'|'outline' }]
 */
let closeOpen = null;
export function modal({ title, body, actions = [{ label: 'OK', value: true, kind: 'mint' }] }) {
  closeOpen?.(null);
  const m = $('#modal');
  const prev = document.activeElement;
  m.innerHTML = `<div class="modal-back" data-close></div>
    <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
      <h3 id="modalTitle">${esc(title)}</h3>
      <div class="modal-body">${body}</div>
      <div class="modal-actions">${actions.map((a, i) => `<button type="button" class="btn btn-${a.kind || 'outline'}" data-i="${i}">${esc(a.label)}</button>`).join('')}</div>
    </div>`;
  m.hidden = false;
  document.body.classList.add('no-scroll');
  const buttons = $$('button', m);
  buttons[buttons.length - 1]?.focus();
  const ac = new AbortController();
  return new Promise((resolve) => {
    const close = (v) => {
      if (ac.signal.aborted) return;
      ac.abort();
      m.hidden = true;
      m.innerHTML = '';
      document.body.classList.remove('no-scroll');
      prev?.focus?.();
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(null);
      if (e.key === 'Tab') {
        const f = buttons;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    closeOpen = close;
    document.addEventListener('keydown', onKey, { signal: ac.signal });
    m.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) close(null);
      const b = e.target.closest('button[data-i]');
      if (b) close(actions[Number(b.dataset.i)].value);
    }, { signal: ac.signal });
  });
}

/** Our logo: one line splitting into three. */
export const LOGO = `<svg viewBox="0 0 32 32" aria-hidden="true" class="logo-svg"><g fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16h9"/><path d="M13 16 24.5 8M13 16h12.5M13 16l11.5 8"/></g><g fill="currentColor"><circle cx="25.5" cy="7.5" r="2.2"/><circle cx="27" cy="16" r="2.2"/><circle cx="25.5" cy="24.5" r="2.2"/></g></svg>`;

/** Tiny inline icons. */
export const ICON = {
  arrow: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  ext: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3H3v10h10v-3M9 3h4v4M13 3 7 9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  copy: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3 10V4a1 1 0 0 1 1-1h6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  check: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8.5 3 3 7-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  x: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  upload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  down: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v8M4.5 7.5 8 11l3.5-3.5M3 13h10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6l-7-3Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="m9 12 2 2 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  vault: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M4 9h-1M4 15H3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  stack: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 4 8 4-8 4-8-4 8-4Z M4 12l8 4 8-4M4 16l8 4 8-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  trash: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

/** Row status → icon + class. */
export const STATUS_ICON = { ok: '✅', invalid: '❌', badAmount: '❌', zero: '⚠️', dup: '⚠️', self: '⚠️', contract: 'ℹ️' };
