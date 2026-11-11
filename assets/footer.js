// Footer: one big receipt summarising everything Multisend has ever sent (live from the mainnet contract).
import { CONFIG, MAINNET_CONTRACT_ADDRESS } from './config.js';
import { LOGO, ICON, short, copy, compact, fmtInt, hasGsap, esc } from './ui.js';
import { stats, multisend, reader, iface, contractAddress, explorerAddr, explorerTx } from './chain.js';

const L = CONFIG.links;

/** Barcode from a hex string: each nibble → a bar width. */
export function barcode(hex) {
  const h = (hex || window.ethers?.id('BOT Multisend') || '').replace(/^0x/, '');
  let x = 0;
  const bars = [];
  for (const c of h) {
    const v = parseInt(c, 16);
    const w = 1 + (v % 3);
    if (v % 2 === 0) bars.push(`<rect x="${x}" y="0" width="${w}" height="54"/>`);
    x += w + 1;
  }
  return `<svg viewBox="0 0 ${x} 54" preserveAspectRatio="none" aria-hidden="true" fill="#17181B">${bars.join('')}</svg>`;
}

const row = (k, v, id) => `<div class="r-row"><span class="k">${k}</span><span class="dots"></span><span class="v"${id ? ` id="${id}"` : ''}>${v}</span></div>`;

export function renderFooter(el) {
  const addr = MAINNET_CONTRACT_ADDRESS || contractAddress('mainnet');
  const explorer = addr ? explorerAddr('mainnet', addr) : CONFIG.networks.mainnet.explorer;
  el.innerHTML = `
  <svg class="footer-rings" viewBox="0 0 1400 1400" aria-hidden="true">
    ${[140, 240, 340, 440, 540, 640].map((r, i) => `<circle cx="700" cy="700" r="${r}" fill="none" stroke="#0A0A0A" stroke-opacity="${0.11 - i * 0.014}" stroke-width="1"/>`).join('')}
  </svg>
  <div class="wrap">
    <div class="footer-grid">
      <div>
        <div class="footer-brand">
          <a class="brand" href="./" data-link><span class="brand-mark">${LOGO}</span><span>Multisend</span></a>
          <p>Pay everyone in one click. Send BOT or any token to hundreds of wallets on BOT Chain.</p>
        </div>
        <div class="footer-cols" style="margin-top:40px">
          <div class="fcol"><h4>Product</h4>
            <a href="app" data-link>Send a batch</a>
            <a href="./#receipts" data-link>Receipts</a>
            <a href="#" data-template>CSV template</a>
          </div>
          <div class="fcol"><h4>Learn</h4>
            <a href="./#how" data-link>How it works</a>
            <a href="./#faq" data-link>FAQ</a>
            <a href="${L.docs}" target="_blank" rel="noopener">BOT Chain docs</a>
            <a href="${L.faucet}" target="_blank" rel="noopener">Faucet</a>
          </div>
        </div>
      </div>

      <div class="receipt-col">
        <div class="receipt-wrap">
          <div class="receipt" aria-label="Multisend all-time receipt">
            <h4>BOT MULTISEND — RECEIPT</h4>
            <div class="r-sub">ALL-TIME · LIVE FROM THE CONTRACT</div>
            ${row('BATCHES', '—', 'fBatches')}
            ${row('RECIPIENTS', '—', 'fRecipients')}
            ${row('BOT SENT', '—', 'fSent')}
            <hr class="r-rule">
            ${row('NETWORK', 'BOT Chain · 677')}
            <div class="r-row"><span class="k">CONTRACT</span><span class="dots"></span>
              <span class="v r-contract">${addr ? `${short(addr)} <button type="button" data-copy="${addr}" aria-label="Copy contract address">${ICON.copy}</button>` : 'not deployed yet'}</span></div>
            <a class="btn btn-mint btn-sm r-explorer" href="${explorer}" target="_blank" rel="noopener">View on explorer ${ICON.ext}</a>
            <hr class="r-rule">
            <div class="r-foot"><div class="r-thanks">Thank you for<br>paying people ♥<br><span style="color:#8A8A8A;font-size:11px">STAMPED ON BOT CHAIN</span></div><a class="r-stamp" href="${L.botchain}" target="_blank" rel="noopener" aria-label="BOT Chain website (opens in a new tab)"><img src="assets/botchain-mark.png" alt=""></a></div>
            <div class="r-barcode"><div id="fBarcode" style="width:100%">${barcode(addr)}</div><small id="fBarcodeLabel">${addr ? 'CONTRACT ' + short(addr, 6) : 'NO BATCHES YET'}</small></div>
          </div>
        </div>
      </div>

      <div class="footer-cols right">
        <div class="fcol"><h4>Social</h4>
          <a href="${L.x}" target="_blank" rel="noopener">X</a>
          <a href="${L.telegram}" target="_blank" rel="noopener">Telegram</a>
        </div>
        <div class="fcol"><h4>Network</h4>
          <a href="${L.botchain}" target="_blank" rel="noopener">botchain.ai</a>
          <a href="${CONFIG.networks.mainnet.explorer}" target="_blank" rel="noopener">scan.botchain.ai</a>
        </div>
      </div>
    </div>
    <div class="footer-bottom">
      <span>© 2026 BOT Multisend · the contract never holds your funds</span>
      <a class="footer-net" href="${L.botchain}" target="_blank" rel="noopener" aria-label="Built on BOT Chain"><span>Built on</span><img src="assets/botchain-logo-ink.png" alt="BOT Chain"></a>
    </div>
  </div>`;

  el.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-copy]');
    if (c) copy(c.dataset.copy, 'Contract address copied');
    if (e.target.closest('[data-template]')) {
      e.preventDefault();
      const { TEMPLATE_CSV } = await import('./lists.js');
      const { download } = await import('./ui.js');
      download('multisend-template.csv', TEMPLATE_CSV);
    }
  });

  if (hasGsap()) {
    gsap.to(el.querySelectorAll('.footer-rings circle'), { attr: { 'stroke-opacity': 0.025 }, duration: 2.4, stagger: { each: 0.35, repeat: -1, yoyo: true }, ease: 'sine.inOut' });
  }
  loadStats(el).catch(() => {});
}

async function loadStats(el) {
  const s = await stats('mainnet');
  if (!s) return;
  const set = (id, v) => { const n = el.querySelector('#' + id); if (n) n.textContent = v; };
  set('fBatches', fmtInt(s.batches));
  set('fRecipients', fmtInt(s.recipients));
  set('fSent', compact(Number(window.ethers.formatEther(s.nativeSent))));
  if (s.batches > 0n) {
    const c = multisend('mainnet');
    const id = s.batches - 1n;
    const block = Number(await c.batchBlock(id));
    const logs = await reader('mainnet').getLogs({ address: c.target, fromBlock: block, toBlock: block, topics: [iface.getEvent('BatchSent').topicHash, window.ethers.toBeHex(id, 32)] });
    if (logs[0]) {
      el.querySelector('#fBarcode').innerHTML = `<a href="${explorerTx('mainnet', logs[0].transactionHash)}" target="_blank" rel="noopener" aria-label="Latest batch transaction">${barcode(logs[0].transactionHash)}</a>`;
      el.querySelector('#fBarcodeLabel').textContent = `LATEST BATCH #${id} · ${esc(short(logs[0].transactionHash, 6))}`;
    }
  }
}
