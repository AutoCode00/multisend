// Router, navbar wallet button, footer. Routes: /  ·  /app  ·  /r/:ids  ·  anything else → 404 page.
import { $, $$, LOGO, short, toast, esc } from './ui.js';
import { wallet, onWallet, connect, hasWallet, netKeyOf, friendly } from './chain.js';
import { renderFooter } from './footer.js';
import { pip, bob } from './pip.js';

const BASE = window.MS_BASE || '/';
const view = $('#view');
let cleanup = null;

if (window.gsap) {
  const plugins = [window.ScrollTrigger, window.SplitText, window.MotionPathPlugin].filter(Boolean);
  gsap.registerPlugin(...plugins);
}

$$('[data-logo]').forEach((el) => (el.innerHTML = LOGO));

export const currentPath = () => location.pathname.slice(BASE.length).replace(/\/+$/, '');

export function go(href, { replace = false } = {}) {
  const url = new URL(href, document.baseURI);
  if (url.origin !== location.origin) return (location.href = href);
  const samePage = url.pathname === location.pathname && url.search === location.search;
  if (samePage && url.hash) {
    history[replace ? 'replaceState' : 'pushState'](null, '', url.href);
    return scrollToHash(url.hash);
  }
  history[replace ? 'replaceState' : 'pushState'](null, '', url.href);
  render();
}

function scrollToHash(hash, smooth = true) {
  const el = hash && document.getElementById(decodeURIComponent(hash.slice(1)));
  if (el) el.scrollIntoView({ behavior: smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto' });
}

async function render() {
  try { cleanup?.(); } catch { /* ignore */ }
  cleanup = null;
  window.ScrollTrigger?.getAll().forEach((t) => t.kill());
  closeMenu();
  const path = currentPath();
  let mod;
  if (path === '') mod = await import('./home.js');
  else if (path === 'app') mod = await import('./app.js');
  else if (/^r\/[\d,]+$/.test(path)) mod = await import('./receipt.js');
  document.body.dataset.route = path.split('/')[0] || 'home';
  $$('.nav-links a').forEach((a) => a.removeAttribute('aria-current'));
  if (!mod) {
    document.title = 'Not found — BOT Multisend';
    view.innerHTML = `<section class="wrap empty"><div>${pip('frown', { size: 140 })}</div><h1>This page doesn't look right</h1><p>Pip couldn't find anything at <code>/${esc(path)}</code>. Maybe the link was cut short?</p><a class="btn btn-mint" href="./" data-link>Back home</a></section>`;
    bob(view);
  } else {
    cleanup = await mod.mount(view, { path, go });
  }
  if (location.hash) requestAnimationFrame(() => scrollToHash(location.hash, false));
  else window.scrollTo(0, 0);
  view.focus({ preventScroll: true });
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || a.target === '_blank') return;
  e.preventDefault();
  go(a.getAttribute('href'));
});
window.addEventListener('popstate', render);

// ─── nav ───
const menuBtn = $('#navMenu');
const links = $('#navLinks');
function closeMenu() { links.classList.remove('open'); menuBtn.setAttribute('aria-expanded', 'false'); }
menuBtn.addEventListener('click', () => {
  const open = !links.classList.contains('open');
  links.classList.toggle('open', open);
  menuBtn.setAttribute('aria-expanded', String(open));
});

const walletBtn = $('#walletBtn');
function paintWallet() {
  if (!wallet.account) {
    walletBtn.innerHTML = 'Connect wallet';
    walletBtn.title = '';
    return;
  }
  const onBot = !!netKeyOf(wallet.chainId);
  walletBtn.innerHTML = `<span class="wallet-dot ${onBot ? '' : 'warn'}"></span><span class="mono">${short(wallet.account)}</span>`;
  walletBtn.title = onBot ? `Connected · ${netKeyOf(wallet.chainId) === 'testnet' ? 'BOT Chain Testnet' : 'BOT Chain'}` : 'Wrong network — click to switch to BOT Chain';
}
onWallet(paintWallet);
walletBtn.addEventListener('click', async () => {
  if (!hasWallet()) {
    toast('MetaMask not found — install it from metamask.io', 'warn');
    window.open('https://metamask.io/download/', '_blank', 'noopener');
    return;
  }
  try {
    // In the app, connect to whichever network is selected there; elsewhere, mainnet.
    const key = window.__msNet || 'mainnet';
    await connect(wallet.account && netKeyOf(wallet.chainId) ? netKeyOf(wallet.chainId) : key);
    toast('Wallet connected', 'ok');
  } catch (e) {
    toast(friendly(e), 'err');
  }
});

renderFooter($('#footer'));
render();
