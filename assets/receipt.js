// /r/:ids — public receipt for one or more batches (ids comma-separated). Anyone can open it to check they were paid.
import { $, esc, short, copy, download, ICON } from './ui.js';
import * as C from './chain.js';
import * as L from './lists.js';
import { pip, bob } from './pip.js';
import { loadSessions } from './app.js';

export async function mount(view, { path }) {
  const ids = [...new Set(path.slice(2).split(',').filter(Boolean).map(Number))];
  const key = new URLSearchParams(location.search).get('net') === 'testnet' ? 'testnet' : 'mainnet';
  const n = C.net(key);
  document.title = `Receipt #${ids.join(', #')} — BOT Multisend`;
  view.innerHTML = `<section class="rcpt"><div class="wrap rcpt-grid">
    <div class="card rcpt-side"><div class="skeleton" style="height:90px;width:90px;border-radius:50%"></div><div class="skeleton" style="height:30px;margin-top:16px"></div><div class="skeleton" style="height:180px;margin-top:16px"></div></div>
    <div class="card rcpt-main"><div class="rtop"><div class="skeleton" style="height:22px;width:200px"></div></div>${'<div class="rrow"><div class="skeleton" style="height:14px;grid-column:1/-1"></div></div>'.repeat(8)}</div>
  </div></section>`;

  let batches;
  try {
    batches = await Promise.all(ids.map((id) => C.loadBatch(key, id)));
  } catch (e) {
    view.innerHTML = `<section class="wrap empty"><div>${pip('frown', { size: 140 })}</div><h1>Receipt not found</h1>
      <p>${esc(C.friendly(e))}. ${key === 'mainnet' ? `If this batch was sent on testnet, try <a class="link" href="${esc(path)}?net=testnet" data-link>the testnet receipt</a>.` : ''}</p>
      <a class="btn btn-mint" href="app" data-link>Send a batch</a></section>`;
    bob(view);
    return;
  }

  const meta = await C.assetMeta(key, batches[0].token).catch(() => ({ symbol: 'TOKEN', decimals: 18 }));
  const dec = meta.decimals;
  const total = batches.reduce((s, b) => s + b.total, 0n);
  const count = batches.reduce((s, b) => s + b.count, 0);
  const name = batches[0].name.replace(/ \(\d+\/\d+\)$/, '') || `Batch #${ids.join(', #')}`;
  const senders = [...new Set(batches.map((b) => b.sender))];
  const time = Math.max(...batches.map((b) => b.time || 0));
  const recipients = batches.flatMap((b) => (b.recipients || []).map((r) => ({ ...r, batch: b.id })));
  const decoded = batches.every((b) => b.recipients);
  document.title = `${name} — receipt · BOT Multisend`;

  // Partial progress from a send started in this browser.
  const sess = loadSessions().find((s) => s.net === key && s.chunks.some((c) => ids.includes(c.batchId)));
  const left = sess ? sess.chunks.filter((c) => c.status !== 'done') : [];

  const csv = () => ['address,amount,batch,tx', ...recipients.map((r) => `${r.address},${L.plainAmount(r.amount, dec)},${r.batch},${batches.find((b) => b.id === r.batch).txHash}`)].join('\n') + '\n';

  view.innerHTML = `<section class="rcpt"><div class="wrap rcpt-grid">
    <aside class="card rcpt-side">
      ${pip('check', { size: 96, label: 'Pip, holding a checkmark' })}
      <h1>${esc(name)}</h1>
      <p class="sub">${ids.length > 1 ? `Batches #${ids.join(', #')}` : `Batch #${ids[0]}`} · ${time ? new Date(time).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : ''}</p>
      ${left.length ? `<div class="note warn"><span>⏸</span><span>Partly sent: ${sess.chunks.length - left.length} of ${sess.chunks.length} batches are confirmed. ${left.length} still to go.
        <br><a class="btn btn-mint btn-sm" style="margin-top:10px" href="app?resume=${encodeURIComponent(sess.id)}${key === 'testnet' ? '&net=testnet' : ''}" data-link>Continue sending</a></span></div>` : `<div class="note ok"><span>✓</span><span>Confirmed on ${esc(n.name)} — every recipient below was paid.</span></div>`}
      <div class="sum-rows" style="margin-bottom:0">
        <div class="sum-row"><span>Total</span><span>${L.formatAmount(total, dec)} ${esc(meta.symbol)}</span></div>
        <div class="sum-row"><span>Recipients</span><span>${count.toLocaleString()}</span></div>
        <div class="sum-row"><span>Asset</span><span>${meta.type === 'native' ? 'BOT (native)' : `<a class="link" href="${C.explorerAddr(key, batches[0].token)}" target="_blank" rel="noopener">${esc(meta.symbol)} ${ICON.ext}</a>`}</span></div>
        <div class="sum-row"><span>Sender</span><span>${senders.map((s) => `<a class="link" href="${C.explorerAddr(key, s)}" target="_blank" rel="noopener">${short(s)}</a>`).join(', ')}</span></div>
        <div class="sum-row"><span>Network</span><span>${esc(n.name)} · ${n.chainId}</span></div>
      </div>
      <div class="txs">${batches.map((b) => `<a class="link" href="${C.explorerTx(key, b.txHash)}" target="_blank" rel="noopener">#${b.id} · ${short(b.txHash, 6)} ${ICON.ext}</a>`).join('')}</div>
      <div class="rcpt-actions">
        <button class="btn btn-outline btn-sm" type="button" id="dlCsv" ${decoded ? '' : 'disabled'}>${ICON.down} Download CSV</button>
        <button class="btn btn-outline btn-sm" type="button" id="copyLink">${ICON.copy} Copy link</button>
      </div>
      <div class="field paid-check"><label for="paidQ">Were you paid? Paste your address</label>
        <input class="input mono" id="paidQ" placeholder="0x…" spellcheck="false" autocomplete="off"><small class="hint" id="paidA" aria-live="polite"></small></div>
    </aside>
    <div class="card rcpt-main">
      <div class="rtop"><b>${count.toLocaleString()} recipients</b><span class="mono" style="color:var(--muted);font-size:13px">${L.formatAmount(total, dec)} ${esc(meta.symbol)}</span></div>
      <div class="rlist" id="rlist">${decoded ? recipients.map((r, i) => `<div class="rrow" data-addr="${r.address.toLowerCase()}"><span class="line">${i + 1}</span>
        <a class="addr link" style="color:var(--text)" href="${C.explorerAddr(key, r.address)}" target="_blank" rel="noopener">${r.address}</a>
        <span class="amt">${L.formatAmount(r.amount, dec)} ${esc(meta.symbol)}</span><span class="ok" title="Paid">${ICON.check}</span></div>`).join('')
        : `<div class="tempty">These batches were sent through another contract, so the recipient list can’t be rebuilt here. Open the transaction${batches.length > 1 ? 's' : ''} on the explorer to see every transfer.</div>`}</div>
    </div>
  </div></section>`;
  bob(view);
  if (window.gsap && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    gsap.from('.rcpt-side .pip', { scale: 0.4, rotation: -20, opacity: 0, duration: 0.8, ease: 'back.out(1.8)' });
    gsap.from('.pip-badge', { scale: 0, transformOrigin: '50% 50%', duration: 0.5, delay: 0.5, ease: 'back.out(3)' });
    gsap.from('.rrow', { opacity: 0, x: 12, duration: 0.4, stagger: { each: 0.02, amount: 0.8 }, ease: 'power2.out' });
  }

  $('#dlCsv', view).onclick = () => download(`multisend-receipt-${ids.join('-')}.csv`, csv());
  $('#copyLink', view).onclick = () => copy(location.href, 'Receipt link copied');
  const q = $('#paidQ', view), a = $('#paidA', view);
  q.oninput = () => {
    view.querySelectorAll('.rrow.hit').forEach((r) => r.classList.remove('hit'));
    const v = q.value.trim().toLowerCase();
    if (!v) return (a.textContent = '');
    if (!/^0x[0-9a-f]{40}$/.test(v)) return (a.textContent = 'Paste the full 0x address.');
    const hits = [...view.querySelectorAll(`.rrow[data-addr="${v}"]`)];
    if (!hits.length) { a.innerHTML = '<span style="color:var(--amber)">Not in this receipt.</span>'; return; }
    hits.forEach((h) => h.classList.add('hit'));
    const sum = recipients.filter((r) => r.address.toLowerCase() === v).reduce((s, r) => s + r.amount, 0n);
    a.innerHTML = `<span style="color:var(--mint)">Yes — you were paid ${L.formatAmount(sum, dec)} ${esc(meta.symbol)} ✓</span>`;
    const list = $('#rlist', view);
    list.scrollTop = hits[0].offsetTop - list.offsetTop - 60;
  };
}
