// Pip 📮 — a cheerful paper-plane courier with a mailbag.
// Moods: 'happy' (default), 'frown' (bad address), 'check' (receipt), 'wave'.

export function pip(mood = 'happy', { size = 120, label = 'Pip, the Multisend courier' } = {}) {
  const mouth = {
    happy: '<path d="M71 47q5 5 10 0" />',
    wave: '<path d="M71 47q5 5 10 0" />',
    check: '<path d="M70 46q6 7 12 0" />',
    frown: '<path d="M71 50q5-5 10 0" />',
  }[mood] || '';
  const brows = mood === 'frown' ? '<path class="pip-brow" d="M64 32l7 3M88 31l-7 3" />' : '';
  const badge =
    mood === 'check'
      ? '<g class="pip-badge"><circle cx="102" cy="22" r="13" fill="#12A150" stroke="#fff" stroke-width="2"/><path d="m95.5 22 4.5 4.5 8.5-9" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></g>'
      : mood === 'frown'
        ? '<g class="pip-badge"><circle cx="102" cy="22" r="12" fill="#FFB547"/><path d="M102 15v8" stroke="#0A0B0D" stroke-width="3" stroke-linecap="round"/><circle cx="102" cy="28.5" r="1.8" fill="#0A0B0D"/></g>'
        : '';
  return `<svg class="pip pip-${mood}" viewBox="0 0 130 110" width="${size}" height="${Math.round(size * 110 / 130)}" role="img" aria-label="${label}">
    <g class="pip-body">
      <path d="M6 54 120 14 74 98 58 66Z" fill="#FFFFFF" stroke="#0A0A0A" stroke-width="2" stroke-linejoin="round"/>
      <path d="M58 66 120 14 46 76Z" fill="#DADADA" stroke="#0A0A0A" stroke-width="2" stroke-linejoin="round"/>
      <path d="M58 66 120 14 66 82Z" fill="#F0F0F0" stroke="#0A0A0A" stroke-width="2" stroke-linejoin="round"/>
      <g class="pip-bag">
        <path d="M44 56 62 46" stroke="#0A0A0A" stroke-width="2" stroke-linecap="round"/>
        <rect x="30" y="56" width="22" height="17" rx="4" fill="#34C77B" stroke="#0A0A0A" stroke-width="1.6"/>
        <path d="M30 61h22" stroke="#0A0B0D" stroke-opacity=".35" stroke-width="2"/>
        <rect x="38" y="63" width="6" height="4" rx="1" fill="#0A0B0D" fill-opacity=".45"/>
      </g>
      <g class="pip-face" fill="none" stroke="#0A0B0D" stroke-width="2.6" stroke-linecap="round">
        <circle class="pip-eye" cx="68" cy="38" r="2.8" fill="#0A0B0D" stroke="none"/>
        <circle class="pip-eye" cx="84" cy="36" r="2.8" fill="#0A0B0D" stroke="none"/>
        ${brows}
        ${mouth}
      </g>
      <circle cx="62" cy="45" r="3" fill="#FF8FA3" opacity=".55"/>
      <circle cx="90" cy="42" r="3" fill="#FF8FA3" opacity=".55"/>
    </g>
    ${badge}
  </svg>`;
}

/** A tiny plane (for the flock). */
export const miniPlane = (cls = '') =>
  `<svg class="mini-plane ${cls}" viewBox="0 0 24 20" width="18" height="15" aria-hidden="true"><path d="M1 10 23 2 14 19 11 12Z" fill="#fff" stroke="#0A0A0A" stroke-width="1.2" stroke-linejoin="round"/><path d="M11 12 23 2 9 14Z" fill="#0A0A0A"/></svg>`;

/** Idle bob for any Pip in `root`. */
export function bob(root) {
  if (!window.gsap || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  root.querySelectorAll('.pip .pip-body').forEach((b) => {
    gsap.to(b, { y: -4, rotation: -2, transformOrigin: '50% 50%', duration: 1.6, ease: 'sine.inOut', yoyo: true, repeat: -1 });
  });
  root.querySelectorAll('.pip-frown .pip-body').forEach((b) => {
    gsap.fromTo(b, { x: -3 }, { x: 3, duration: 0.08, repeat: 5, yoyo: true, ease: 'none', clearProps: 'x' });
  });
}
