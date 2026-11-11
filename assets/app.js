// /app — Asset · Recipients · Check · Preview · Send (+ History).
import { CONFIG } from './config.js';
import { $, $$, esc, short, toast, modal, copy, download, ICON, STATUS_ICON, hasGsap, timeAgo } from './ui.js';
import * as L from './lists.js';
import * as C from './chain.js';
import { pip, miniPlane, bob } from './pip.js';

const ethers = window.ethers;
const STEPS = [
  { key: 'asset', label: 'Asset', sub: 'What to send' },
  { key: 'recipients', label: 'Recipients', sub: 'Who gets it' },
  { key: 'check', label: 'Check', sub: 'Fix problems' },
  { key: 'preview', label: 'Preview', sub: 'Totals & gas' },
  { key: 'send', label: 'Send', sub: 'Sign batches' },
];
const DRAFT_KEY = 'multisend.draft';
const SESSIONS_KEY = 'multisend.sessions';
const NAME_MAX = 64;

// ─── persistence ─────────────────────────────────────────────
const store = {
  get(k, fallback, s = localStorage) { try { return JSON.parse(s.getItem(k)) ?? fallback; } catch { return fallback; } },
  set(k, v, s = localStorage) { try { s.setItem(k, JSON.stringify(v)); } catch { /* full or blocked */ } },
};
export const loadSessions = () => store.get(SESSIONS_KEY, []);
function saveSession(sess) {
  const all = loadSessions().filter((s) => s.id !== sess.id);
  all.unshift(sess);
  store.set(SESSIONS_KEY, all.slice(0, 25));
}

export async function mount(view, { go }) {
  document.title = 'Send a batch — BOT Multisend';
  const params = new URLSearchParams(location.search);
  const draft = store.get(DRAFT_KEY, {}, sessionStorage);

  const S = {
    net: params.get('net') === 'testnet' ? 'testnet' : draft.net || 'mainnet',
    step: 0,
    maxStep: 0,
    view: 'send', // or 'history'
    asset: C.nativeAsset(),
    tokenInput: draft.tokenInput || '',
    tokenError: '',
    tokenLoading: false,
    tab: draft.tab || 'csv',
    inputs: { csvName: '', csvText: '', paste: draft.paste || '', same: draft.same || '', sameAmount: draft.sameAmount || '' },
    map: null, // column mapping for CSV
    raw: [], // rows before validation
    rows: [], // validated rows
    contracts: new Set(),
    contractsChecked: new Set(),
    contractsNet: null,
    lookup: null, // {done,total}
    failing: new Map(), // row id → preflight reason
    filter: 'all',
    name: draft.name || '',
    balance: null,
    nativeBalance: null,
    allowance: null,
    plan: null,
    planning: false,
    session: null,
    busy: false,
  };
  if (draft.assetType === 'token' && draft.tokenInput) S.asset = { ...C.nativeAsset(), type: 'token', pending: true };
  window.__msNet = S.net;

  const saveDraft = () =>
    store.set(DRAFT_KEY, { net: S.net, tab: S.tab, paste: S.inputs.paste, same: S.inputs.same, sameAmount: S.inputs.sameAmount, name: S.name, assetType: S.asset.type, tokenInput: S.tokenInput }, sessionStorage);

  // ─── layout ───
  view.innerHTML = `
  <section class="app"><div class="wrap">
    <div class="app-head">
      <div><h1 id="appTitle">Send a batch</h1><p id="appSub">Pay everyone in one click — checked before, receipted after.</p></div>
      <div class="seg" role="group" aria-label="Network" id="netSeg">
        <button type="button" data-net="mainnet"><span class="dot"></span>Mainnet</button>
        <button type="button" data-net="testnet"><span class="dot test"></span>Testnet</button>
      </div>
    </div>
    <div class="app-grid">
      <nav aria-label="Steps"><ol class="stepper card" id="stepper"></ol></nav>
      <div id="centre"></div>
      <aside class="card summary" id="summary" aria-label="Summary"></aside>
    </div>
  </div></section>
  <div class="mbar" id="mbar"></div>`;

  const centre = $('#centre', view);
  const life = new AbortController(); // removes every listener this mount adds to shared elements
  let table = null;
  const unsub = C.onWallet(() => {
    recheck();
    paint();
    refreshBalances().then(() => { if (S.step === 3 && S.view === 'send') buildPlan(); });
  });

  // ─── derived ───
  const dec = () => S.asset.decimals ?? 18;
  const sym = () => S.asset.symbol || 'BOT';
  const fmt = (v) => L.formatAmount(v ?? 0n, dec());
  const valid = () => S.rows.filter((r) => !r.issues.some((i) => L.BLOCKING.has(i.type)));
  const summary = () => L.summarize(S.rows);
  const contract = () => C.contractAddress(S.net);
  const onRightNet = () => C.wallet.account && C.wallet.chainId === C.net(S.net).chainId;
  const locked = () => !!S.session && S.session.chunks.some((c) => c.status === 'done' || c.status === 'pending');

  function recheck() {
    S.rows = L.checkRows(S.raw, { decimals: dec(), self: C.wallet.account, contracts: S.contractsNet === S.net ? S.contracts : new Set() });
    for (const r of S.rows) {
      const why = S.failing.get(r.id);
      if (why) { r.issues.unshift({ type: 'invalid', note: why }); r.status = 'invalid'; }
    }
    S.plan = null;
  }

  // ─── parsing ───
  function parseInputs() {
    S.failing.clear();
    if (S.tab === 'csv') {
      if (!S.inputs.csvText) { S.raw = []; S.map = null; return recheck(); }
      const table = L.readCsv(S.inputs.csvText);
      const g = L.guessColumns(table);
      const keep = S.map && S.map.columns === g.columns && S.map.user ? { address: S.map.address, amount: S.map.amount } : {};
      S.map = { ...g, ...keep, user: !!keep.address || keep.address === 0 };
      S.raw = L.toRows(g.rows, S.map, g.header ? 1 : 0);
    } else if (S.tab === 'paste') {
      S.map = null;
      S.raw = L.toRows(L.readPaste(S.inputs.paste), { address: 0, amount: 1 });
    } else {
      S.map = null;
      S.raw = L.sameAmountRows(L.readAddresses(S.inputs.same), S.inputs.sameAmount);
    }
    recheck();
  }

  // ─── balances ───
  async function refreshBalances() {
    const acct = C.wallet.account;
    if (!acct || S.asset.pending) { S.balance = S.nativeBalance = S.allowance = null; return; }
    try {
      const [b, nb] = await Promise.all([C.balanceOf(S.net, S.asset, acct), C.reader(S.net).getBalance(acct)]);
      S.balance = b; S.nativeBalance = nb;
      S.allowance = S.asset.type === 'token' && contract() ? await C.allowance(S.net, S.asset.address, acct) : null;
    } catch { /* RPC hiccup — leave as is */ }
    paintSummary();
    if (S.step === 0) paintCentre();
  }

  async function loadToken() {
    const a = S.tokenInput.trim();
    S.tokenError = '';
    if (!ethers.isAddress(a)) { S.tokenError = 'That doesn’t look like a token address (0x + 40 characters).'; return paintCentre(); }
    S.tokenLoading = true; paintCentre();
    try {
      S.asset = await C.loadToken(S.net, a, C.wallet.account);
      S.balance = S.asset.balance;
      saveDraft();
      recheck();
      refreshBalances();
    } catch (e) {
      S.asset = { ...C.nativeAsset(), type: 'token', pending: true };
      S.tokenError = C.friendly(e);
    }
    S.tokenLoading = false;
    paint();
  }

  // ─── contract lookups (ℹ️ contract address) ───
  async function lookupContracts() {
    if (S.contractsNet !== S.net) { S.contracts = new Set(); S.contractsChecked = new Set(); S.contractsNet = S.net; }
    const todo = [...new Set(S.rows.filter((r) => r.address).map((r) => r.address.toLowerCase()))].filter((a) => !S.contractsChecked.has(a));
    if (!todo.length) return;
    S.lookup = { done: 0, total: todo.length };
    paintCentre();
    try {
      const found = await C.findContracts(S.net, todo, (done, total) => {
        S.lookup = { done, total };
        const p = $('#lookup', view);
        if (p) p.textContent = `Checking which addresses are contracts… ${done.toLocaleString()} / ${total.toLocaleString()}`;
      });
      found.forEach((a) => S.contracts.add(a));
      todo.forEach((a) => S.contractsChecked.add(a));
    } catch { toast('Couldn’t reach BOT Chain to check for contract addresses', 'warn'); }
    S.lookup = null;
    recheck();
    paint();
  }

  // ─── gas planning ───
  const heuristicGas = (n) => BigInt(S.asset.type === 'native' ? 45000 + n * 36000 : 60000 + n * 34000);
  const totalOf = (rows) => rows.reduce((s, r) => s + r.amount, 0n);
  const batchName = (i, n) => {
    const base = S.name.trim();
    if (n === 1) return base;
    const suffix = ` (${i + 1}/${n})`;
    let b = base;
    while (new TextEncoder().encode(b + suffix).length > NAME_MAX) b = b.slice(0, -1);
    return b ? b + suffix : `Part ${i + 1} of ${n}`;
  };

  /** estimateGas for a set of rows; throws on revert. Returns {gas, exact}. */
  async function estimate(rows, name = S.name) {
    const c = C.multisend(S.net);
    const acct = C.wallet.account;
    if (!c || !acct) return { gas: heuristicGas(rows.length), exact: false };
    const to = rows.map((r) => r.address), am = rows.map((r) => r.amount), total = totalOf(rows);
    try {
      if (S.asset.type === 'native') {
        if (S.nativeBalance != null && S.nativeBalance < total) return { gas: heuristicGas(rows.length), exact: false };
        return { gas: await c.sendNative.estimateGas(to, am, name, { from: acct, value: total }), exact: true };
      }
      if (S.allowance == null || S.allowance < total || (S.balance != null && S.balance < total)) return { gas: heuristicGas(rows.length), exact: false };
      return { gas: await c.sendToken.estimateGas(S.asset.address, to, am, name, { from: acct }), exact: true };
    } catch (e) {
      if (/insufficient funds/i.test(e?.shortMessage || e?.message || '')) return { gas: heuristicGas(rows.length), exact: false };
      throw e;
    }
  }

  /** Binary-search the rows to find the one that makes the batch revert. */
  async function findBreaking(rows) {
    if (rows.length === 1) return rows[0];
    const mid = rows.length >> 1;
    for (const half of [rows.slice(0, mid), rows.slice(mid)]) {
      try { await estimate(half); } catch { return findBreaking(half); }
    }
    return null;
  }

  async function preflightFail(rows, e) {
    const bad = await findBreaking(rows).catch(() => null);
    const reason = C.friendly(e);
    if (bad) {
      const why = S.asset.type === 'native' ? 'This address rejects BOT transfers (preflight failed)' : 'Token transfer to this address fails (preflight)';
      S.failing.set(bad.id, why);
      recheck();
      return { row: bad, reason: why };
    }
    return { row: null, reason };
  }

  async function buildPlan() {
    if (S.planning) return;
    S.planning = true; S.plan = null; paint();
    const rows = valid();
    try {
      await refreshBalances();
      const p = C.reader(S.net);
      const [block, fee] = await Promise.all([p.getBlock('latest'), p.getFeeData()]);
      const limit = block?.gasLimit || 30_000_000n;
      const cap = (limit * BigInt(Math.round(CONFIG.gasShare * 100))) / 100n;
      const gasPrice = fee.gasPrice ?? fee.maxFeePerGas ?? 0n;
      const chunks = [];
      const queue = L.chunk(rows, CONFIG.batchSize);
      let anyExact = false;
      while (queue.length) {
        const part = queue.shift();
        let est;
        try { est = await estimate(part); } catch (e) {
          const f = await preflightFail(part, e);
          S.planning = false;
          S.plan = { error: f.row ? `Row ${f.row.line} would make the batch fail: ${f.reason}` : `Preflight failed: ${f.reason}` , badRow: f.row?.id };
          S.step = 2; S.filter = 'issues';
          paint();
          if (f.row) table?.scrollToRow(f.row.id);
          return;
        }
        if (est.gas > cap && part.length > 1) {
          const mid = Math.ceil(part.length / 2);
          queue.unshift(part.slice(0, mid), part.slice(mid));
          continue;
        }
        anyExact ||= est.exact;
        chunks.push({ rows: part, total: totalOf(part), gas: est.gas });
      }
      // keep original order of chunks
      const gasTotal = chunks.reduce((s, c) => s + c.gas, 0n);
      S.plan = { chunks, gasPrice, gasTotal, fee: gasTotal * gasPrice, limit, exact: anyExact, total: totalOf(rows) };
    } catch (e) {
      S.plan = { error: 'Couldn’t plan the batches: ' + C.friendly(e) };
    }
    S.planning = false;
    paint();
  }

  // ─── send session ───
  function newSession() {
    const n = S.plan.chunks.length;
    S.session = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      net: S.net,
      sender: C.wallet.account,
      asset: { type: S.asset.type, address: S.asset.address, symbol: S.asset.symbol, decimals: S.asset.decimals },
      name: S.name.trim(),
      createdAt: Date.now(),
      chunks: S.plan.chunks.map((c, i) => ({
        to: c.rows.map((r) => r.address),
        amounts: c.rows.map((r) => r.amount.toString()),
        lines: c.rows.map((r) => r.line),
        total: c.total.toString(),
        name: batchName(i, n),
        status: 'todo',
        txHash: null,
        batchId: null,
        error: null,
      })),
    };
    saveSession(S.session);
  }

  const remaining = () => S.session.chunks.filter((c) => c.status !== 'done').reduce((s, c) => s + BigInt(c.total), 0n);

  async function approve() {
    const need = remaining();
    const ok = await modal({
      title: `Approve ${fmt(need)} ${sym()}`,
      body: `<p>This lets the Multisend contract move <b>exactly ${esc(fmt(need))} ${esc(sym())}</b> — the total of the batches left to send. Never more, never “unlimited”.</p><p style="margin-top:10px" class="mono">Spender: ${esc(contract())}</p>`,
      actions: [{ label: 'Cancel', value: false }, { label: 'Approve in MetaMask', value: true, kind: 'mint' }],
    });
    if (!ok) return;
    S.busy = true; paintCentre();
    try {
      const signer = await C.getSigner(S.net);
      const t = new ethers.Contract(S.asset.address, C.ERC20_ABI, signer);
      let tx;
      try { tx = await t.approve(contract(), need); } catch (e) {
        if (C.isRejected(e) || !S.allowance) throw e;
        // Some tokens (USDT-style) need the allowance reset to 0 first.
        await (await t.approve(contract(), 0n)).wait();
        tx = await t.approve(contract(), need);
      }
      toast('Approval sent — waiting for confirmation…');
      await tx.wait();
      S.allowance = await C.allowance(S.net, S.asset.address, C.wallet.account);
      toast(`Approved ${fmt(need)} ${sym()} ✓`, 'ok');
    } catch (e) {
      toast(C.friendly(e), C.isRejected(e) ? 'warn' : 'err');
    }
    S.busy = false;
    paint();
  }

  async function sendChunk(i) {
    const sess = S.session;
    const ch = sess.chunks[i];
    if (S.busy || ch.status === 'done' || ch.status === 'pending') return;
    // Another tab (or an earlier click) may already have sent this batch.
    const saved = loadSessions().find((x) => x.id === sess.id)?.chunks[i];
    if (saved && (saved.status === 'done' || saved.status === 'pending')) { Object.assign(ch, saved); paint(); return toast('This batch was already sent', 'warn'); }
    const n = sess.chunks.length;
    const total = BigInt(ch.total);
    if (!C.hasWallet()) {
      const go2 = await modal({ title: 'Install MetaMask to send', body: '<p>You can build and check your list without a wallet, but sending needs MetaMask (or another browser wallet) connected to BOT Chain.</p>', actions: [{ label: 'Not now', value: false }, { label: 'Get MetaMask', value: true, kind: 'mint' }] });
      if (go2) window.open('https://metamask.io/download/', '_blank', 'noopener');
      return;
    }
    const ok = await modal({
      title: n > 1 ? `Send batch ${i + 1} of ${n}` : 'Send batch',
      body: `<div class="confirm-big">${esc(L.formatAmount(total, sess.asset.decimals))} ${esc(sess.asset.symbol)}</div>
        <div class="confirm-sub">to <b>${ch.to.length.toLocaleString()} recipient${ch.to.length === 1 ? '' : 's'}</b> on ${esc(C.net(sess.net).name)}</div>
        <p style="margin-top:12px">If any single transfer fails, the whole batch reverts and nobody in it is paid. ${ch.name ? `Name: “${esc(ch.name)}”.` : ''}</p>`,
      actions: [{ label: 'Cancel', value: false }, { label: 'Confirm & sign', value: true, kind: 'mint' }],
    });
    if (!ok || S.busy || ch.status === 'done' || ch.status === 'pending') return;
    S.busy = true; ch.error = null; paintCentre();
    try {
      const signer = await C.getSigner(sess.net);
      const from = await signer.getAddress();
      if (from.toLowerCase() !== sess.sender.toLowerCase()) throw new Error(`Switch MetaMask back to ${short(sess.sender)} — this batch was planned for that wallet.`);
      const c = C.multisend(sess.net, signer);
      const to = ch.to, am = ch.amounts.map(BigInt);
      // Preflight right before signing.
      let gas;
      try {
        gas = sess.asset.type === 'native'
          ? await c.sendNative.estimateGas(to, am, ch.name, { value: total })
          : await c.sendToken.estimateGas(sess.asset.address, to, am, ch.name);
      } catch (e) {
        if (sess.asset.type === 'token') {
          const al = await C.allowance(sess.net, sess.asset.address, from);
          S.allowance = al;
          if (al < total) throw new Error(`Allowance too low (${L.formatAmount(al, sess.asset.decimals)} ${sess.asset.symbol}) — re-approve the exact total first.`);
        }
        const rows = S.rows.filter((r) => to.includes(r.address));
        const f = rows.length ? await preflightFail(rows, e) : { row: null, reason: C.friendly(e) };
        throw new Error(f.row ? `Row ${f.row.line} (${short(f.row.address)}) would make this batch fail — remove it in Check.` : `Preflight failed: ${f.reason}`);
      }
      const opts = { gasLimit: (gas * 12n) / 10n };
      const tx = sess.asset.type === 'native'
        ? await c.sendNative(to, am, ch.name, { ...opts, value: total })
        : await c.sendToken(sess.asset.address, to, am, ch.name, opts);
      ch.status = 'pending'; ch.txHash = tx.hash; saveSession(sess);
      paintCentre();
      flock(to.length);
      const rc = await tx.wait();
      if (rc.status !== 1) throw new Error('The transaction failed on-chain.');
      const ev = rc.logs.map((l) => { try { return C.iface.parseLog(l); } catch { return null; } }).find((x) => x?.name === 'BatchSent');
      ch.status = 'done'; ch.batchId = ev ? Number(ev.args.id) : null;
      saveSession(sess);
      toast(`Batch ${i + 1} of ${n} confirmed ✓`, 'ok');
      refreshBalances();
    } catch (e) {
      ch.status = ch.txHash && ch.status === 'pending' ? 'failed' : 'todo';
      ch.error = C.friendly(e);
      if (ch.status === 'failed') ch.txHash = ch.txHash; // keep link to the failed tx
      saveSession(sess);
      toast(ch.error, C.isRejected(e) ? 'warn' : 'err');
    }
    S.busy = false;
    paint();
  }

  const receiptHref = (sess) => {
    const ids = sess.chunks.filter((c) => c.status === 'done' && c.batchId != null).map((c) => c.batchId);
    return ids.length ? `r/${ids.join(',')}${sess.net === 'testnet' ? '?net=testnet' : ''}` : null;
  };

  // ─── Pip flock (MotionPath) ───
  function flock(n) {
    const stage = $('#sendStage', view);
    if (!stage) return;
    const dots = $$('.rdot', stage);
    if (!hasGsap() || !window.MotionPathPlugin) { dots.forEach((d) => d.classList.add('lit')); return; }
    const sr = stage.getBoundingClientRect();
    const p = $('.pip', stage).getBoundingClientRect();
    const sx = p.left - sr.left + p.width * 0.7, sy = p.top - sr.top + p.height * 0.3;
    gsap.fromTo($('.pip .pip-body', stage), { scale: 1 }, { scale: 0.85, duration: 0.2, yoyo: true, repeat: 1, transformOrigin: '50% 50%' });
    const count = Math.min(dots.length, Math.max(6, Math.min(n, 18)));
    dots.slice(0, count).forEach((d, k) => {
      const tx = parseFloat(d.style.left) / 100 * sr.width, ty = parseFloat(d.style.top) / 100 * sr.height;
      const plane = document.createElement('div');
      plane.innerHTML = miniPlane();
      const el = plane.firstChild;
      stage.append(el);
      const midX = (sx + tx) / 2, midY = Math.min(sy, ty) - 40 - Math.random() * 40;
      gsap.to(el, {
        duration: 1.1 + Math.random() * 0.5,
        delay: k * 0.06,
        ease: 'power1.inOut',
        motionPath: { path: [{ x: sx, y: sy }, { x: midX, y: midY }, { x: tx - 9, y: ty - 7 }], curviness: 1.4, autoRotate: true },
        onComplete: () => { d.classList.add('lit'); gsap.to(el, { opacity: 0, scale: 0.4, duration: 0.25, onComplete: () => el.remove() }); },
      });
    });
  }

  // ─── painting ───
  function paint() {
    window.__msNet = S.net;
    $$('#netSeg button', view).forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.net === S.net));
      b.disabled = locked();
    });
    paintStepper();
    paintCentre();
    paintSummary();
  }

  function canGo(step) {
    const s = summary();
    if (step <= 0) return true;
    if (S.asset.pending) return false;
    if (step === 1) return true;
    if (step === 2) return S.raw.length > 0;
    if (step >= 3) return s.ready;
    return false;
  }

  function paintStepper() {
    const st = $('#stepper', view);
    st.innerHTML = STEPS.map((x, i) => {
      const done = i < S.step && S.view === 'send';
      const disabled = (!canGo(i) || i > S.maxStep + 1 || (locked() && i < 4)) && i !== S.step;
      return `<li><button type="button" data-step="${i}" class="${done ? 'done' : ''}" ${S.step === i && S.view === 'send' ? 'aria-current="step"' : ''} ${disabled ? 'disabled' : ''}>
        <span class="n">${done ? ICON.check : i + 1}</span><span class="lbl">${x.label}<small>${x.sub}</small></span></button></li>`;
    }).join('') + `<li class="history-link"><button type="button" data-history ${S.view === 'history' ? 'aria-current="step"' : ''}><span class="n">↺</span><span class="lbl">History<small>Your past batches</small></span></button></li>`;
  }

  function goStep(i) {
    if (i === S.step && S.view === 'send') return;
    if (i === 4 && !S.session) {
      if (!S.plan || S.plan.error) i = 3; // plan first
      else newSession(); // freeze the plan into a send session
    }
    if (i < 4 && S.session && !locked()) S.session = null; // nothing sent yet — safe to re-plan
    S.view = 'send';
    S.step = i;
    S.maxStep = Math.max(S.maxStep, i);
    if (i === 2) lookupContracts();
    if (i === 3 && !S.plan) buildPlan();
    paint();
    if (hasGsap()) gsap.fromTo(centre, { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, ease: 'power2.out', overwrite: true });
    centre.scrollIntoView({ block: 'nearest' });
    if (innerWidth <= 860) window.scrollTo({ top: 0 });
  }

  function primaryAction() {
    const s = summary();
    if (S.view === 'history') return { label: 'Back to sending', fn: () => goStep(S.step) };
    switch (S.step) {
      case 0: return { label: 'Next: recipients', fn: () => goStep(1), disabled: !!S.asset.pending };
      case 1: return { label: s.count ? `Check ${s.count.toLocaleString()} rows` : 'Add recipients first', fn: () => goStep(2), disabled: !s.count };
      case 2: return { label: s.blocking ? `Fix ${s.blocking} problem${s.blocking === 1 ? '' : 's'} first` : 'Next: preview', fn: () => goStep(3), disabled: !s.ready || !!S.lookup };
      case 3: {
        if (!C.wallet.account) return { label: C.hasWallet() ? 'Connect wallet' : 'Install MetaMask to send', fn: connectWallet };
        if (!onRightNet()) return { label: `Switch to ${C.net(S.net).name}`, fn: switchNet };
        return { label: 'Continue to send', fn: () => goStep(4), disabled: !S.plan || !!S.plan.error || S.planning || !contract() || shortfall() > 0n };
      }
      case 4: {
        if (!S.session) return { label: 'Plan the batch first', fn: () => goStep(3), disabled: true };
        const next = S.session.chunks.findIndex((c) => c.status !== 'done');
        if (next < 0) { const h = receiptHref(S.session); return { label: 'View receipt', fn: () => h && go(h) }; }
        if (needsApproval()) return { label: `Approve ${fmt(remaining())} ${sym()}`, fn: approve, disabled: S.busy };
        const n = S.session.chunks.length;
        return { label: n > 1 ? `Send batch ${next + 1} of ${n}` : 'Send batch', fn: () => sendChunk(next), disabled: S.busy };
      }
    }
    return { label: 'Next', fn: () => {} };
  }

  const needsApproval = () => S.session && S.session.asset.type === 'token' && (S.allowance == null || S.allowance < BigInt(S.session.chunks.find((c) => c.status !== 'done')?.total || '0'));
  function shortfall() {
    if (!S.plan || S.plan.error || S.balance == null) return 0n;
    const total = S.plan.total;
    if (S.asset.type === 'native') return total + S.plan.fee > S.balance ? total + S.plan.fee - S.balance : 0n;
    return total > S.balance ? total - S.balance : 0n;
  }
  const gasShort = () => S.asset.type === 'token' && S.plan && !S.plan.error && S.nativeBalance != null && S.plan.fee > S.nativeBalance;

  async function connectWallet() {
    if (!C.hasWallet()) { window.open('https://metamask.io/download/', '_blank', 'noopener'); return; }
    try { await C.connect(S.net); recheck(); await refreshBalances(); if (S.step === 3) buildPlan(); } catch (e) { toast(C.friendly(e), 'err'); }
    paint();
  }
  async function switchNet() {
    try { await C.ensureNetwork(S.net); await refreshBalances(); if (S.step === 3) buildPlan(); } catch (e) { toast(C.friendly(e), 'err'); }
    paint();
  }

  function paintSummary() {
    const s = summary();
    const a = primaryAction();
    const plan = S.plan && !S.plan.error ? S.plan : null;
    const bal = S.balance;
    const total = s.total;
    const sf = shortfall();
    const txs = plan ? plan.chunks.length : Math.max(1, Math.ceil(valid().length / CONFIG.batchSize));
    const balCell = !C.wallet.account ? '<span>—</span>' : bal == null ? '<span>…</span>' : `<span class="${(S.asset.type === 'native' ? bal >= total : bal >= total) ? 'ok' : 'bad'}">${fmt(bal)} ${esc(sym())} ${bal >= total ? '✓' : '✗'}</span>`;
    const issues = s.blocking ? `<span class="bad">${s.blocking} to fix</span>` : s.warnings ? `<span class="warn">${s.warnings} warning${s.warnings === 1 ? '' : 's'}</span>` : s.count ? '<span class="ok">None ✓</span>' : '<span>—</span>';
    $('#summary', view).innerHTML = `
      <h3>Summary</h3>
      <div class="sum-total">${fmt(total)} <small>${esc(sym())}</small></div>
      <div class="sum-sub">${s.count ? `${(s.count - s.blocking).toLocaleString()} recipient${s.count - s.blocking === 1 ? '' : 's'}` : 'No recipients yet'}${S.name.trim() ? ` · “${esc(S.name.trim())}”` : ''}</div>
      <div class="sum-rows">
        <div class="sum-row"><span>Asset</span><span>${S.asset.pending ? 'Token (not loaded)' : esc(sym())}</span></div>
        <div class="sum-row"><span>Your balance</span>${balCell}</div>
        <div class="sum-row"><span>Transactions</span><span>${s.count ? txs + (S.asset.type === 'token' ? ' + approve' : '') : '—'}</span></div>
        <div class="sum-row"><span>Est. gas</span><span>${plan ? `${L.formatAmount(plan.fee, 18, 5)} BOT${plan.exact ? '' : ' ~'}` : S.planning ? 'estimating…' : '—'}</span></div>
        <div class="sum-row"><span>Issues</span>${issues}</div>
      </div>
      ${sf > 0n ? `<div class="note err" style="margin:0 0 14px"><span>✗</span><span>Short by ${fmt(sf)} ${esc(sym())}${S.asset.type === 'native' ? ' (incl. gas)' : ''}</span></div>` : ''}
      <button class="btn btn-mint btn-block btn-lg" type="button" id="primaryBtn" ${a.disabled ? 'disabled' : ''}>${esc(a.label)}</button>
      <div class="sum-net"><span class="wallet-dot ${S.net === 'testnet' ? 'warn' : ''}"></span>${esc(C.net(S.net).name)} · ${C.net(S.net).chainId}</div>`;
    $('#mbar', view).innerHTML = `<div><b>${fmt(total)} ${esc(sym())}</b><small>${s.count ? `${(s.count - s.blocking).toLocaleString()} recipients · ${txs} tx` : 'No recipients yet'}${s.blocking ? ` · ${s.blocking} to fix` : ''}</small></div>
      <button class="btn btn-mint" type="button" id="mPrimary" ${a.disabled ? 'disabled' : ''}>${esc(/^Next: /.test(a.label) ? 'Next' : a.label)}</button>`;
    $('#primaryBtn', view).onclick = a.fn;
    $('#mPrimary', view).onclick = a.fn;
  }

  // ─── centre panels ───
  function paintCentre() {
    table = null;
    if (S.view === 'history') return paintHistory();
    const fn = [stepAsset, stepRecipients, stepCheck, stepPreview, stepSend][S.step];
    centre.innerHTML = fn();
    bind();
    bob(centre);
  }

  const netNote = () => {
    const n = C.net(S.net);
    let out = '';
    if (!contract()) out += `<div class="note warn"><span>⚠️</span><span>Multisend isn’t deployed on ${esc(n.name)} yet, so sending is off. You can still build and check a list. (Deploy it with <a href="deploy.html">deploy.html</a>, then add the address to <code>assets/config.js</code>.)</span></div>`;
    if (S.net === 'testnet') out += `<div class="note info"><span>🧪</span><span>Testnet mode — free test BOT from the <a href="${CONFIG.links.faucet}" target="_blank" rel="noopener">faucet</a>. Nothing here is real money.</span></div>`;
    if (C.wallet.account && !onRightNet()) out += `<div class="note warn"><span>⚠️</span><span>Your wallet is on another network. <button class="btn btn-sm btn-outline" type="button" data-switch style="margin-left:8px">Switch to ${esc(n.name)}</button></span></div>`;
    return out;
  };

  function stepAsset() {
    const isToken = S.asset.type === 'token';
    const a = S.asset;
    return `<div class="card panel">
      <h2>What to send</h2><p class="hint">Send BOT, or any ERC-20 token on ${esc(C.net(S.net).name)}.</p>
      ${netNote()}
      <div class="choice-grid">
        <button type="button" class="choice" data-asset="native" aria-pressed="${!isToken}">
          <span class="ic"><img src="assets/botchain-mark.png" alt=""></span><span><b>BOT</b><small>Native coin · 18 decimals</small></span><span class="radio"></span></button>
        <button type="button" class="choice" data-asset="token" aria-pressed="${isToken}">
          <span class="ic">ERC</span><span><b>Token</b><small>Paste a token address</small></span><span class="radio"></span></button>
      </div>
      ${isToken ? `<div class="field"><label for="tokenAddr">Token address</label>
        <div class="input-row"><input class="input mono" id="tokenAddr" placeholder="0x…" spellcheck="false" autocomplete="off" value="${esc(S.tokenInput)}">
        <button class="btn btn-outline" type="button" data-load ${S.tokenLoading ? 'disabled' : ''}>${S.tokenLoading ? 'Loading…' : 'Load'}</button></div></div>
        ${S.tokenError ? `<div class="note err"><span>❌</span><span>${esc(S.tokenError)}</span></div>` : ''}
        ${!a.pending ? `<div class="token-card"><span class="ic">${esc(a.symbol.slice(0, 3))}</span><span><b>${esc(a.name)} (${esc(a.symbol)})</b><small>${esc(short(a.address, 6))} · ${a.decimals} decimals</small></span>
          <span class="bal">${S.balance != null ? `${fmt(S.balance)}<br><small>your balance</small>` : '<small>connect to see<br>your balance</small>'}</span></div>
          <div class="note warn"><span>⚠️</span><span>If this token takes a fee on every transfer, recipients will receive less than listed. Approvals are always for the exact total.</span></div>` : ''}` : `
        <div class="token-card"><span class="ic" style="background:#fff"><img src="assets/botchain-mark.png" alt="" style="width:26px;height:26px"></span><span><b>BOT</b><small>Native coin of BOT Chain</small></span>
          <span class="bal">${S.balance != null ? `${fmt(S.balance)}<br><small>your balance</small>` : '<small>connect to see<br>your balance</small>'}</span></div>`}
      <div class="panel-actions"><span></span><button class="btn btn-mint" type="button" data-next="1" ${S.asset.pending ? 'disabled' : ''}>Next: recipients ${ICON.arrow}</button></div>
    </div>`;
  }

  function mapperHtml() {
    const m = S.map;
    if (!m || (m.confident && !m.user && m.columns <= 2)) return '';
    const opts = (sel) => Array.from({ length: m.columns }, (_, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${esc(m.header?.[i] || `Column ${i + 1}`)}${m.rows[0]?.[i] ? ` — e.g. ${esc(String(m.rows[0][i]).slice(0, 18))}` : ''}</option>`).join('');
    return `<div class="mapper"><h3>Which column is the address?</h3><p class="hint">This file has ${m.columns} column${m.columns === 1 ? '' : 's'}${m.header ? ' with a header row' : ''}. Pick the address and amount columns.</p>
      <div class="mapper-grid"><div class="field" style="margin:0"><label for="mapAddr">Address column</label><select class="select" id="mapAddr">${opts(m.address)}</select></div>
      <div class="field" style="margin:0"><label for="mapAmt">Amount column</label><select class="select" id="mapAmt">${opts(m.amount)}</select></div></div></div>`;
  }

  function stepRecipients() {
    const s = summary();
    const tabs = [['csv', 'CSV upload'], ['paste', 'Paste list'], ['same', 'Same amount']];
    let body = '';
    if (S.tab === 'csv') {
      body = `<label class="drop" id="drop" tabindex="0">
          ${ICON.upload}<b>${S.inputs.csvName ? 'Replace file' : 'Drop a CSV here, or click to choose'}</b>
          <small>Columns <code>address,amount</code> · header optional · comma, tab or semicolon</small>
          ${S.inputs.csvName ? `<span class="file">${esc(S.inputs.csvName)} · ${S.raw.length.toLocaleString()} rows</span>` : ''}
          <input type="file" id="csvFile" accept=".csv,.tsv,.txt,text/csv" hidden></label>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;gap:10px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" type="button" data-template>${ICON.down} Download template</button>
          ${S.inputs.csvName ? '<button class="btn btn-ghost btn-sm" type="button" data-clear>Clear</button>' : ''}</div>
        ${mapperHtml()}`;
    } else if (S.tab === 'paste') {
      body = `<div class="field" style="margin-top:0"><label for="pasteBox">One recipient per line: address, amount</label>
        <textarea class="textarea" id="pasteBox" spellcheck="false" placeholder="0x8f3a…21c4, 25&#10;0x4b1e…9a07 100&#10;0x77d0…be12&#9;40">${esc(S.inputs.paste)}</textarea>
        <small class="hint">Spaces, commas and tabs all work.</small></div>`;
    } else {
      body = `<div class="field" style="margin-top:0"><label for="sameBox">Addresses (any separator)</label>
        <textarea class="textarea" id="sameBox" spellcheck="false" placeholder="0x8f3a…21c4&#10;0x4b1e…9a07&#10;0x77d0…be12">${esc(S.inputs.same)}</textarea></div>
        <div class="field"><label for="sameAmt">Amount for everyone (${esc(sym())})</label><input class="input mono" id="sameAmt" inputmode="decimal" placeholder="50" value="${esc(S.inputs.sameAmount)}" style="max-width:240px"></div>`;
    }
    return `<div class="card panel">
      <h2>Who gets it</h2><p class="hint">Upload a CSV, paste a list, or send everyone the same amount.</p>
      <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${S.tab === k}">${l}</button>`).join('')}</div>
      ${body}
      ${s.count > 1000 ? `<div class="note warn"><span>⚠️</span><span>${s.count.toLocaleString()} rows — that’s about ${Math.ceil(s.count / CONFIG.batchSize)} transactions, each confirmed separately in MetaMask.</span></div>` : ''}
      ${s.count ? `<div class="checkbar"><span class="pill ok"><b>${s.count.toLocaleString()}</b> rows read</span>${s.blocking ? `<span class="pill bad"><b>${s.blocking}</b> to fix</span>` : ''}<span class="pill"><b>${fmt(s.total)}</b> ${esc(sym())}</span></div><div id="tableHost"></div>` : ''}
      <div class="panel-actions"><button class="btn btn-outline" type="button" data-next="0">Back</button><button class="btn btn-mint" type="button" data-next="2" ${s.count ? '' : 'disabled'}>Next: check ${ICON.arrow}</button></div>
    </div>`;
  }

  function stepCheck() {
    const s = summary();
    const c = s.counts;
    const pills = [
      ['all', 'All', s.count, ''],
      ['ok', '✅ OK', c.ok, 'ok'],
      ['invalid', '❌ Invalid', c.invalid + c.badAmount, 'bad'],
      ['dup', '⚠️ Duplicates', c.dup, 'warn'],
      ['zero', '⚠️ Zero', c.zero, 'warn'],
      ['self', '⚠️ Your address', c.self, 'warn'],
      ['contract', 'ℹ️ Contracts', c.contract, 'info'],
    ].filter(([k, , n]) => k === 'all' || n > 0);
    const firstBad = S.rows.find((r) => L.BLOCKING.has(r.status));
    const dupGroups = c.dup ? new Set(S.rows.filter((r) => r.issues.some((i) => i.type === 'dup')).map((r) => r.address.toLowerCase())).size : 0;
    const say = S.lookup ? `<span id="lookup">Checking which addresses are contracts… ${S.lookup.done} / ${S.lookup.total}</span>`
      : firstBad ? `This one doesn’t look right — row ${firstBad.line}: ${esc(firstBad.issues[0].note)}.${s.blocking > 1 ? ` (${s.blocking - 1} more)` : ''}`
      : s.warnings ? `Looks sendable! ${s.warnings} row${s.warnings === 1 ? '' : 's'} worth a second look.`
      : `All ${s.count.toLocaleString()} look good. Ready when you are!`;
    return `<div class="card panel">
      <h2>Check</h2><p class="hint">Every row is checked before anything is signed. Click a filter to see just those rows.</p>
      ${S.plan?.error ? `<div class="note err"><span>❌</span><span>${esc(S.plan.error)}</span></div>` : ''}
      <div class="pip-say">${pip(firstBad ? 'frown' : 'happy', { size: 76 })}<div class="bubble">${say}</div></div>
      <div class="checkbar">${pills.map(([k, l, n, cls]) => `<button type="button" class="pill ${cls}" data-filter="${k}" aria-pressed="${S.filter === k}">${l} <b>${n.toLocaleString()}</b></button>`).join('')}
        ${s.blocking || c.zero || c.self || c.dup ? '<button class="btn btn-mint btn-sm" type="button" data-fixall style="margin-left:auto">Fix all</button>' : ''}</div>
      ${dupGroups ? `<div class="dupbar"><span>⚠️ ${dupGroups === 1 ? '1 address appears' : `${dupGroups} addresses appear`} more than once.</span>
        <button class="btn btn-sm btn-outline" type="button" data-dup="merge">Merge amounts</button>
        <button class="btn btn-sm btn-outline" type="button" data-dup="first">Keep first</button>
        <button class="btn btn-sm btn-outline" type="button" data-dup="remove">Remove all</button></div>` : ''}
      <div id="tableHost"></div>
      <div class="panel-actions"><button class="btn btn-outline" type="button" data-next="1">Back</button><button class="btn btn-mint" type="button" data-next="3" ${s.ready && !S.lookup ? '' : 'disabled'}>Next: preview ${ICON.arrow}</button></div>
    </div>`;
  }

  function stepPreview() {
    const s = summary();
    const plan = S.plan && !S.plan.error ? S.plan : null;
    const bal = S.balance;
    const sf = shortfall();
    const big = `<div class="big-sum">
        <div><b>${(s.count - s.blocking).toLocaleString()}</b><span>recipients</span></div>
        <div><b>${fmt(s.total)}</b><span>${esc(sym())} total</span></div>
        <div><b class="${bal == null ? '' : sf > 0n ? 'bad' : 'ok'}">${bal == null ? '—' : fmt(bal)}</b><span>your balance ${bal == null ? (C.wallet.account ? '' : '(connect)') : sf > 0n ? '✗' : '✓'}</span></div>
        <div><b>${plan ? plan.chunks.length : S.planning ? '…' : '—'}</b><span>transaction${plan?.chunks.length === 1 ? '' : 's'}${S.asset.type === 'token' ? ' + 1 approve' : ''}</span></div>
        <div><b>${plan ? L.formatAmount(plan.fee, 18, 5) : S.planning ? '…' : '—'}</b><span>est. gas (BOT)${plan && !plan.exact ? ' · rough' : ''}</span></div>
        <div><b>${s.warnings || 0}</b><span>warning${s.warnings === 1 ? '' : 's'}</span></div>
      </div>`;
    const notes = [];
    if (!C.wallet.account) notes.push(`<div class="note info"><span>ℹ️</span><span>Connect your wallet to check your balance and get an exact gas estimate.</span></div>`);
    if (sf > 0n) notes.push(`<div class="note err"><span>✗</span><span>Not enough ${esc(sym())}: you’re short by <b>${fmt(sf)} ${esc(sym())}</b>${S.asset.type === 'native' ? ' (including gas)' : ''}.</span></div>`);
    if (gasShort()) notes.push(`<div class="note err"><span>✗</span><span>Not enough BOT for gas (about ${L.formatAmount(plan.fee, 18, 5)} BOT needed).</span></div>`);
    if (S.plan?.error) notes.push(`<div class="note err"><span>❌</span><span>${esc(S.plan.error)}</span></div>`);
    if (plan && plan.chunks.length > 5) notes.push(`<div class="note warn"><span>⚠️</span><span>This list needs ${plan.chunks.length} transactions. You’ll confirm each one in MetaMask; confirmed batches are never resent.</span></div>`);
    if (plan && !plan.exact && C.wallet.account) notes.push(`<div class="note info"><span>ℹ️</span><span>Gas is a rough estimate${S.asset.type === 'token' ? ' until the approval is in place' : ''}. Each batch is simulated again right before you sign.</span></div>`);
    return `<div class="card panel">
      <h2>Preview</h2><p class="hint">Everything that will happen, before it happens.</p>
      ${netNote()}
      ${big}
      ${notes.join('')}
      <div class="field"><label for="batchName">Batch name (optional — shown on the receipt)</label>
        <input class="input" id="batchName" maxlength="${NAME_MAX}" placeholder="Hackathon Week 5 prizes" value="${esc(S.name)}"></div>
      ${plan ? `<div class="plan-list">${plan.chunks.map((c, i) => `<div class="plan-item"><span class="mono">#${i + 1}</span><span>${c.rows.length.toLocaleString()} recipients · <b>${fmt(c.total)} ${esc(sym())}</b></span><span class="mono">~${Number(c.gas).toLocaleString()} gas</span></div>`).join('')}</div>`
        : S.planning ? '<div class="plan-list"><div class="plan-item skeleton" style="height:50px"></div></div>' : ''}
      <div class="panel-actions"><button class="btn btn-outline" type="button" data-next="2">Back</button>
        <span style="display:flex;gap:8px"><button class="btn btn-ghost" type="button" data-replan ${S.planning ? 'disabled' : ''}>Re-estimate</button></span></div>
    </div>`;
  }

  function stepSend() {
    if (!S.session) return `<div class="card panel"><h2>Send</h2><p class="hint">Plan your batch in Preview first.</p></div>`;
    const sess = S.session;
    const n = sess.chunks.length;
    const doneN = sess.chunks.filter((c) => c.status === 'done').length;
    const allDone = doneN === n;
    const next = sess.chunks.findIndex((c) => c.status !== 'done');
    const href = receiptHref(sess);
    const dotsN = Math.min(24, sess.chunks.reduce((s, c) => s + c.to.length, 0));
    const lit = Math.round(dotsN * (doneN / n));
    const dots = Array.from({ length: dotsN }, (_, k) => {
      const a = -1.05 + (k / Math.max(1, dotsN - 1)) * 2.1;
      const r = 32 + (k % 3) * 9;
      return `<span class="rdot ${k < lit ? 'lit' : ''}" style="left:${62 + Math.cos(a) * r * 0.55}%;top:${50 + Math.sin(a) * r}%"></span>`;
    }).join('');
    const approveRow = sess.asset.type === 'token' ? `<div class="batch ${needsApproval() ? '' : 'done'}"><span class="bn">${needsApproval() ? 'A' : ICON.check}</span>
        <span><b>Approve exact total</b><small>${needsApproval() ? `${fmt(remaining())} ${esc(sess.asset.symbol)} — never unlimited` : `Allowance ${fmt(S.allowance ?? 0n)} ${esc(sess.asset.symbol)} ✓`}</small></span>
        ${needsApproval() && !allDone ? `<button class="btn btn-mint btn-sm" type="button" data-approve ${S.busy ? 'disabled' : ''}>Approve ${fmt(remaining())} ${esc(sess.asset.symbol)}</button>` : '<span class="st-done">Done</span>'}</div>` : '';
    return `<div class="card panel">
      <h2>${allDone ? 'All sent!' : 'Send'}</h2>
      <p class="hint">${allDone ? `${n > 1 ? `${n} batches` : 'Your batch'} confirmed on ${esc(C.net(sess.net).name)}. Everyone on the list has been paid.` : `${n > 1 ? `${n} transactions` : 'One transaction'} · ${L.formatAmount(BigInt(sess.chunks.reduce((s, c) => s + BigInt(c.total), 0n)), sess.asset.decimals)} ${esc(sess.asset.symbol)} to ${sess.chunks.reduce((s, c) => s + c.to.length, 0).toLocaleString()} recipients.`}</p>
      ${!allDone ? netNote() : ''}
      <div class="send-stage" id="sendStage">${pip(allDone ? 'check' : 'happy', { size: 110 })}<div class="dots">${dots}</div></div>
      <div class="batch-list">
        ${approveRow}
        ${sess.chunks.map((c, i) => {
          const st = c.status;
          const label = n > 1 ? `Send batch ${i + 1} of ${n}` : 'Send batch';
          const action = st === 'done' ? `<a class="link" href="${C.explorerTx(sess.net, c.txHash)}" target="_blank" rel="noopener">Confirmed ✓ ${ICON.ext}</a>`
            : st === 'pending' ? `<a class="link st-pending" href="${C.explorerTx(sess.net, c.txHash)}" target="_blank" rel="noopener">Pending… ${ICON.ext}</a>`
            : `<button class="btn btn-${i === next ? 'mint' : 'outline'} btn-sm" type="button" data-send="${i}" ${i !== next || S.busy || needsApproval() ? 'disabled' : ''}>${st === 'failed' || c.error ? 'Retry' : label}</button>`;
          return `<div class="batch ${st}"><span class="bn">${st === 'done' ? ICON.check : i + 1}</span>
            <span><b>Batch ${i + 1}${n > 1 ? ` of ${n}` : ''}</b><small>${c.to.length.toLocaleString()} recipients · ${L.formatAmount(BigInt(c.total), sess.asset.decimals)} ${esc(sess.asset.symbol)}${c.batchId != null ? ` · receipt #${c.batchId}` : ''}</small>
            ${c.error ? `<small class="st-failed">${esc(c.error)}${st === 'failed' && c.txHash ? ` · <a class="link" href="${C.explorerTx(sess.net, c.txHash)}" target="_blank" rel="noopener">failed tx</a>` : ''}</small>` : ''}</span>${action}</div>`;
        }).join('')}
      </div>
      ${doneN > 0 && !allDone ? `<div class="note warn"><span>⏸</span><span>${doneN} of ${n} batches sent. You can leave and come back — <b>Continue sending</b> never resends confirmed batches.</span></div>` : ''}
      <div class="panel-actions">
        ${allDone || doneN === 0 ? `<button class="btn btn-outline" type="button" data-new>${allDone ? 'Send another batch' : 'Back to preview'}</button>` : '<span></span>'}
        ${href ? `<span style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-ghost" type="button" data-copylink="${href}">${ICON.copy} Copy receipt link</button><a class="btn btn-mint" href="${href}" data-link>View receipt ${ICON.arrow}</a></span>` : ''}
      </div>
    </div>`;
  }

  async function paintHistory() {
    const acct = C.wallet.account;
    const local = loadSessions().filter((s) => s.net === S.net && s.chunks.some((c) => c.status !== 'done') && s.chunks.some((c) => c.status === 'done'));
    centre.innerHTML = `<div class="card panel"><h2>History</h2><p class="hint">Your past batches on ${esc(C.net(S.net).name)}, read from the contract.</p>
      ${local.length ? `<h3 style="font-size:15px;margin-top:20px">Unfinished</h3><div class="history">${local.map((s) => `<button type="button" class="hist" data-resume="${s.id}" style="text-align:left;font:inherit;color:inherit;cursor:pointer">
        <span><b>${esc(s.name || 'Untitled batch')}</b><small>${s.chunks.filter((c) => c.status === 'done').length} of ${s.chunks.length} batches sent · ${timeAgo(s.createdAt)}</small></span><span class="mono">${esc(s.asset.symbol)}</span><span class="btn btn-sm btn-mint">Continue sending</span></button>`).join('')}</div>` : ''}
      <div id="histList" class="history">${!acct ? '<p class="hint">Connect your wallet to see the batches you’ve sent.</p>' : !contract() ? '<p class="hint">Multisend isn’t deployed on this network yet.</p>' : '<div class="skeleton" style="height:60px"></div><div class="skeleton" style="height:60px"></div>'}</div>
      ${!acct ? `<div class="panel-actions"><span></span><button class="btn btn-mint" type="button" data-connect>Connect wallet</button></div>` : ''}</div>`;
    bind();
    if (!acct || !contract()) return;
    try {
      const ids = [...(await C.multisend(S.net).batchesOf(acct))].map(Number).reverse().slice(0, 20);
      const list = $('#histList', view);
      if (!ids.length) { if (list) list.innerHTML = `<div class="tempty">${pip('happy', { size: 70 })}<p style="margin-top:8px">No batches yet. Your first one will show up here.</p></div>`; bob(list || view); return; }
      const batches = await Promise.all(ids.map((id) => C.loadBatch(S.net, id).catch(() => null)));
      const metas = {};
      for (const b of batches.filter(Boolean)) if (!metas[b.token]) metas[b.token] = await C.assetMeta(S.net, b.token).catch(() => ({ symbol: 'TOKEN', decimals: 18 }));
      if (!$('#histList', view)) return;
      $('#histList', view).innerHTML = batches.filter(Boolean).map((b) => {
        const m = metas[b.token];
        return `<a class="hist" href="r/${b.id}${S.net === 'testnet' ? '?net=testnet' : ''}" data-link>
          <span><b>${esc(b.name || `Batch #${b.id}`)}</b><small>#${b.id} · ${b.count.toLocaleString()} recipients</small></span>
          <span class="when mono" style="color:var(--muted)">${timeAgo(b.time)}</span>
          <span class="mono">${L.formatAmount(b.total, m.decimals)} ${esc(m.symbol)}</span></a>`;
      }).join('');
    } catch (e) {
      const list = $('#histList', view);
      if (list) list.innerHTML = `<div class="note err"><span>❌</span><span>Couldn’t load history: ${esc(C.friendly(e))}</span></div>`;
    }
  }

  // ─── virtualised table ───
  function mountTable(host) {
    const filterFn = {
      all: () => true,
      issues: (r) => r.status !== 'ok',
      ok: (r) => r.status === 'ok',
      invalid: (r) => r.issues.some((i) => i.type === 'invalid' || i.type === 'badAmount'),
      dup: (r) => r.issues.some((i) => i.type === 'dup'),
      zero: (r) => r.issues.some((i) => i.type === 'zero'),
      self: (r) => r.issues.some((i) => i.type === 'self'),
      contract: (r) => r.issues.some((i) => i.type === 'contract'),
    }[S.step === 2 ? S.filter : 'all'] || (() => true);
    const rows = S.rows.filter(filterFn);
    host.innerHTML = `<div class="table" role="table" aria-label="Recipients" aria-rowcount="${rows.length}">
      <div class="thead" role="row"><span role="columnheader">Row</span><span role="columnheader">Address</span><span class="r" role="columnheader">Amount (${esc(sym())})</span><span role="columnheader">Status</span><span></span></div>
      <div class="tbody" id="tbody"><div class="tspacer"></div></div>
      <div class="tfoot"><span>${rows.length.toLocaleString()} of ${S.rows.length.toLocaleString()} rows</span><span>${S.rows.length > 200 ? 'scroll for more' : ''}</span></div></div>`;
    const body = $('#tbody', host);
    const spacer = $('.tspacer', host);
    const rowH = () => (matchMedia('(max-width: 860px)').matches ? 60 : 44);
    if (!rows.length) { body.innerHTML = `<div class="tempty">Nothing here${S.filter !== 'all' ? ' — try another filter' : ''}.</div>`; }
    const rowHtml = (r, i, h) => {
      const iss = r.issues[0];
      const note = iss ? iss.note + (r.issues.length > 1 ? ` (+${r.issues.length - 1})` : '') : 'OK';
      const amt = r.amount != null ? fmt(r.amount) : esc(r.rawAmount || '—');
      return `<div class="trow ${r.status}" role="row" style="top:${i * h}px" data-row="${r.id}">
        <span class="line" role="cell">${r.line}</span>
        <span class="addr" role="cell" title="${esc(r.address || r.rawAddress)}">${r.address ? short(r.address, 8) : esc(r.rawAddress || '—')}</span>
        <span class="amt" role="cell">${amt}</span>
        <span class="st" role="cell" title="${esc(r.issues.map((x) => x.note).join(' · '))}"><span aria-hidden="true">${STATUS_ICON[r.status]}</span><span>${esc(note)}</span></span>
        <button class="icon-btn x" type="button" data-remove="${r.id}" aria-label="Remove row ${r.line}">${ICON.trash}</button></div>`;
    };
    let frame = 0;
    const draw = () => {
      frame = 0;
      if (!rows.length) return;
      const h = rowH();
      spacer.style.height = rows.length * h + 'px';
      const view = Math.max(body.clientHeight, 560);
      const start = Math.max(0, Math.floor(body.scrollTop / h) - 8);
      const end = Math.min(rows.length, start + Math.ceil(view / h) + 16);
      spacer.innerHTML = rows.slice(start, end).map((r, k) => rowHtml(r, start + k, h)).join('');
    };
    body.addEventListener('scroll', () => { if (!frame) frame = requestAnimationFrame(draw); }, { passive: true });
    draw();
    return {
      scrollToRow(id) {
        const i = rows.findIndex((r) => r.id === id);
        if (i < 0) return;
        body.scrollTop = Math.max(0, i * rowH() - 120);
        draw();
        const el = $(`[data-row="${id}"]`, body);
        el?.classList.add('flash');
        setTimeout(() => el?.classList.remove('flash'), 1600);
        host.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      },
    };
  }

  // ─── events ───
  function readFile(file) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return toast('That file is over 10 MB — split it up first', 'warn');
    const r = new FileReader();
    r.onload = () => { S.inputs.csvName = file.name; S.inputs.csvText = String(r.result); S.map = null; parseInputs(); paint(); };
    r.onerror = () => toast('Couldn’t read that file', 'err');
    r.readAsText(file);
  }

  let debounce;
  function bind() {
    const host = $('#tableHost', centre);
    if (host && S.rows.length) table = mountTable(host);
    const drop = $('#drop', centre);
    if (drop) {
      const file = $('#csvFile', centre);
      file.onchange = () => readFile(file.files[0]);
      drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } };
      ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
      ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
      drop.addEventListener('drop', (e) => readFile(e.dataTransfer.files[0]));
    }
    const live = (id, key) => {
      const el = $(id, centre);
      if (!el) return;
      el.oninput = () => {
        S.inputs[key] = el.value;
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          parseInputs(); saveDraft();
          // repaint table + pills without losing focus
          const pos = [el.selectionStart, el.selectionEnd];
          paintCentre(); paintSummary(); paintStepper();
          const again = $(id, centre);
          again?.focus(); again?.setSelectionRange?.(...pos);
        }, 250);
      };
    };
    live('#pasteBox', 'paste'); live('#sameBox', 'same'); live('#sameAmt', 'sameAmount');
    const tok = $('#tokenAddr', centre);
    if (tok) {
      tok.oninput = () => { S.tokenInput = tok.value; saveDraft(); };
      tok.onkeydown = (e) => { if (e.key === 'Enter') loadToken(); };
      tok.onpaste = () => setTimeout(() => { S.tokenInput = tok.value; if (ethers.isAddress(tok.value.trim())) loadToken(); }, 0);
    }
    const nm = $('#batchName', centre);
    if (nm) nm.oninput = () => {
      while (new TextEncoder().encode(nm.value).length > NAME_MAX) nm.value = nm.value.slice(0, -1);
      S.name = nm.value; saveDraft(); paintSummary();
    };
    const ma = $('#mapAddr', centre), mm = $('#mapAmt', centre);
    if (ma) {
      const remap = () => { S.map = { ...S.map, address: Number(ma.value), amount: Number(mm.value), user: true }; S.raw = L.toRows(S.map.rows, S.map, S.map.header ? 1 : 0); recheck(); paint(); };
      ma.onchange = remap; mm.onchange = remap;
    }
  }

  view.addEventListener('click', async (e) => {
    if (life.signal.aborted) return;
    const t = (sel) => e.target.closest(sel);
    let b;
    if ((b = t('[data-net]'))) {
      if (locked() || S.net === b.dataset.net) return;
      S.net = b.dataset.net; window.__msNet = S.net;
      history.replaceState(null, '', S.net === 'testnet' ? 'app?net=testnet' : 'app');
      S.plan = null; S.session = null; S.failing.clear();
      if (S.asset.type === 'token' && !S.asset.pending) { S.asset = { ...C.nativeAsset(), type: 'token', pending: true }; if (S.tokenInput) loadToken(); }
      recheck(); saveDraft(); paint(); refreshBalances();
      if (C.wallet.account && !onRightNet()) switchNet();
      if (S.step === 2) lookupContracts();
      if (S.step >= 3) goStep(3);
      return;
    }
    if ((b = t('[data-step]'))) return goStep(Number(b.dataset.step));
    if (t('[data-history]')) { S.view = 'history'; paintStepper(); paintSummary(); return paintHistory(); }
    if ((b = t('[data-next]'))) return goStep(Number(b.dataset.next));
    if ((b = t('[data-asset]'))) {
      if (b.dataset.asset === 'native') { S.asset = C.nativeAsset(); S.tokenError = ''; }
      else if (S.asset.type !== 'token') { S.asset = { ...C.nativeAsset(), type: 'token', pending: true }; if (ethers.isAddress(S.tokenInput.trim())) loadToken(); }
      saveDraft(); recheck(); refreshBalances(); paint();
      if (S.asset.type === 'token') $('#tokenAddr', centre)?.focus();
      return;
    }
    if (t('[data-load]')) return loadToken();
    if ((b = t('[data-tab]'))) { S.tab = b.dataset.tab; parseInputs(); saveDraft(); return paint(); }
    if (t('[data-template]')) return download('multisend-template.csv', L.TEMPLATE_CSV);
    if (t('[data-clear]')) { S.inputs.csvName = ''; S.inputs.csvText = ''; parseInputs(); return paint(); }
    if ((b = t('[data-filter]'))) { S.filter = b.dataset.filter; return paintCentre(); }
    if ((b = t('[data-remove]'))) {
      const id = Number(b.dataset.remove);
      S.raw = S.raw.filter((r) => r.id !== id); S.failing.delete(id);
      recheck(); paintCentre(); paintSummary(); paintStepper();
      return;
    }
    if (t('[data-fixall]')) {
      const before = S.rows.length;
      S.raw = L.fixAll(S.rows, dec()); S.failing.clear(); recheck();
      toast(`Fixed — ${before - S.rows.length} row${before - S.rows.length === 1 ? '' : 's'} removed, duplicates merged`, 'ok');
      S.filter = 'all';
      return paint();
    }
    if ((b = t('[data-dup]'))) {
      S.raw = L.resolveDuplicates(S.rows, b.dataset.dup, dec()); recheck();
      toast({ merge: 'Duplicates merged', first: 'Kept the first of each', remove: 'Duplicates removed' }[b.dataset.dup], 'ok');
      return paint();
    }
    if (t('[data-replan]')) return buildPlan();
    if (t('[data-switch]')) return switchNet();
    if (t('[data-connect]')) return connectWallet();
    if (t('[data-approve]')) return approve();
    if ((b = t('[data-send]'))) return sendChunk(Number(b.dataset.send));
    if ((b = t('[data-copylink]'))) return copy(new URL(b.dataset.copylink, document.baseURI).href, 'Receipt link copied');
    if ((b = t('[data-resume]'))) return resume(b.dataset.resume);
    if (t('[data-new]')) {
      const allDone = S.session?.chunks.every((c) => c.status === 'done');
      S.session = null;
      if (allDone) { S.raw = []; S.rows = []; S.inputs = { csvName: '', csvText: '', paste: '', same: '', sameAmount: '' }; S.name = ''; S.plan = null; saveDraft(); S.maxStep = 0; return goStep(1); }
      return goStep(3);
    }
  }, { signal: life.signal });

  function resume(id) {
    const sess = loadSessions().find((s) => s.id === id);
    if (!sess) return toast('That batch isn’t saved in this browser', 'warn');
    S.session = sess;
    S.net = sess.net; window.__msNet = S.net;
    S.name = sess.name;
    S.asset = sess.asset.type === 'native' ? C.nativeAsset() : { ...C.nativeAsset(), ...sess.asset, name: sess.asset.symbol };
    // rebuild rows from the session so the table + summary reflect it
    const pairs = sess.chunks.flatMap((c) => c.to.map((a, k) => [a, L.plainAmount(BigInt(c.amounts[k]), sess.asset.decimals)]));
    S.raw = L.toRows(pairs, { address: 0, amount: 1 });
    S.tab = 'paste'; S.inputs.paste = pairs.map((p) => p.join(', ')).join('\n');
    recheck();
    S.maxStep = 4; S.step = 4; S.view = 'send';
    refreshBalances();
    paint();
    // A batch left "pending" (tab closed mid-send): look up what happened to it.
    sess.chunks.filter((c) => c.status === 'pending' && c.txHash).forEach(async (c) => {
      const rc = await C.reader(sess.net).getTransactionReceipt(c.txHash).catch(() => null);
      if (!rc) return;
      if (rc.status === 1) {
        const ev = rc.logs.map((l) => { try { return C.iface.parseLog(l); } catch { return null; } }).find((x) => x?.name === 'BatchSent');
        c.status = 'done'; c.batchId = ev ? Number(ev.args.id) : null;
      } else { c.status = 'failed'; c.error = 'The transaction failed on-chain.'; }
      saveSession(sess);
      paint();
    });
  }

  // Restore draft inputs, then decide where to start.
  if (draft.assetType === 'token' && S.tokenInput) loadToken();
  parseInputs();
  const resumeId = params.get('resume');
  if (resumeId) resume(resumeId);
  else paint();
  refreshBalances();

  return () => { life.abort(); unsub(); clearTimeout(debounce); };
}
