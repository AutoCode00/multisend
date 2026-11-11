// Home page: 8 sections following the Tempo layout (light, line-art, white cards).
import { CONFIG } from './config.js';
import { $, $$, ICON, LOGO, esc, hasGsap, reduced, compact, fmtInt } from './ui.js';
import { stats, contractAddress } from './chain.js';
import { pip, bob } from './pip.js';

const CHEV = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const G = '#CFCFCF'; // line-art grey

// Abstract "motion blur" backgrounds standing in for photos.
const PHOTOS = [
  'radial-gradient(38% 46% at 62% 52%, #c2472d 0, transparent 70%), radial-gradient(30% 40% at 30% 70%, #d9b88a 0, transparent 70%), linear-gradient(100deg, #17110d 0%, #3c2a1b 35%, #6f4a25 55%, #1b1815 100%)',
  'radial-gradient(46% 60% at 32% 40%, #a9cfbd 0, transparent 70%), radial-gradient(30% 40% at 75% 65%, #3d6b5b 0, transparent 70%), linear-gradient(100deg, #0d1815 0%, #25443a 45%, #0a100f 100%)',
  'radial-gradient(50% 70% at 34% 60%, #94b9dc 0, transparent 70%), radial-gradient(30% 40% at 80% 30%, #27496b 0, transparent 70%), linear-gradient(100deg, #05080d 0%, #15304b 50%, #04060a 100%)',
  'radial-gradient(42% 50% at 70% 48%, #dba55f 0, transparent 70%), radial-gradient(40% 60% at 24% 62%, #5f935c 0, transparent 70%), linear-gradient(100deg, #11150e 0%, #2b3921 50%, #0b0e09 100%)',
];

const SOLUTIONS = [
  {
    t: 'Hackathon prizes',
    d: 'Pay every winner the second judging ends. One list, one transaction, one link to post.',
    art: `<svg viewBox="0 0 400 300" fill="none" stroke="${G}" stroke-width="1.2" font-family="Geist Mono" font-size="11">
      <path d="M20 280h360"/>
      <rect x="60" y="150" width="84" height="130" rx="10"/><rect x="158" y="90" width="84" height="190" rx="10" stroke="#0A0A0A"/><rect x="256" y="190" width="84" height="90" rx="10"/>
      <g stroke="none" fill="#9C9C9C"><text x="102" y="222" text-anchor="middle" font-size="26" font-family="Geist">2</text><text x="298" y="244" text-anchor="middle" font-size="26" font-family="Geist">3</text></g>
      <text x="200" y="196" text-anchor="middle" font-size="34" font-family="Geist" fill="#0A0A0A" stroke="none">1</text>
      <g stroke="none"><rect x="163" y="56" width="74" height="22" rx="5" fill="#0A0A0A"/><text x="200" y="71" text-anchor="middle" fill="#fff">1,000 BOT</text>
      <rect x="68" y="118" width="68" height="22" rx="5" fill="#E9E9E9"/><text x="102" y="133" text-anchor="middle" fill="#555">500 BOT</text>
      <rect x="264" y="158" width="68" height="22" rx="5" fill="#E9E9E9"/><text x="298" y="173" text-anchor="middle" fill="#555">250 BOT</text></g></svg>`,
  },
  {
    t: 'Airdrops',
    d: 'Reward early users and community members — hundreds of wallets, split into safe-sized batches.',
    art: `<svg viewBox="0 0 400 300" font-family="Geist Mono" font-size="11">${Array.from({ length: 150 }, (_, i) => {
      const a = i * 2.39996, r = 9.5 * Math.sqrt(i + 1);
      const x = 200 + Math.cos(a) * r * 1.5, y = 190 + Math.sin(a) * r;
      return y < 300 ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${i % 11 === 0 ? 3 : 1.6}" fill="${i % 11 === 0 ? '#0A0A0A' : '#BDBDBD'}"/>` : '';
    }).join('')}
      <path d="M200 190 C 170 120, 120 110, 92 96" fill="none" stroke="#0A0A0A" stroke-width="1"/><path d="M200 190 C 250 150, 290 150, 318 168" fill="none" stroke="${G}" stroke-width="1"/>
      <rect x="52" y="74" width="62" height="22" rx="5" fill="#0A0A0A"/><text x="83" y="89" text-anchor="middle" fill="#fff">+50 BOT</text>
      <rect x="300" y="160" width="62" height="22" rx="5" fill="#8A8A8A"/><text x="331" y="175" text-anchor="middle" fill="#fff">+50 BOT</text></svg>`,
  },
  {
    t: 'Paying contributors',
    d: 'Monthly tips, bounties and grants in BOT or your own token, with a receipt for the books.',
    art: `<svg viewBox="0 0 400 300" fill="none" stroke="${G}" stroke-width="1.2" font-family="Geist Mono" font-size="11">
      ${[40, 95, 150, 205, 260].map((y, i) => `<path d="M236 150 C 290 150, 280 ${y}, 330 ${y}" ${i === 4 ? 'stroke="#0A0A0A"' : ''}/><rect x="330" y="${y - 12}" width="54" height="24" rx="6" fill="#fff" stroke="#E0E0E0"/><text x="357" y="${y + 4}" text-anchor="middle" fill="#333" stroke="none">${['design', 'docs', 'bugfix', 'i18n', 'tests'][i]}</text>`).join('')}
      <path d="M52 150h100"/><rect x="16" y="132" width="36" height="36" rx="9" fill="#fff" stroke="#E0E0E0"/><path d="M26 150h7M33 150l8-6M33 150h9M33 150l8 6" stroke="#0A0A0A" stroke-width="1.6" stroke-linecap="round"/>
      <rect x="152" y="134" width="84" height="32" rx="9" fill="#0A0A0A" stroke="none"/><text x="194" y="154" text-anchor="middle" fill="#fff" stroke="none">USDX</text></svg>`,
  },
];

const PRIMS = [
  { t: 'CSV in', d: 'Upload a file, paste a list, or paste addresses with one amount for everyone. Header optional, any separator, 1,000+ rows.', link: 'Add recipients' },
  { t: 'Checks first', d: 'Bad addresses, duplicates, zero amounts, contracts and your own wallet — flagged row by row before anything is signed.', link: 'Check a list' },
  { t: 'Receipts out', d: 'Every batch gets a public page anyone can open to check they were paid — plus a CSV download and explorer links.', link: 'See how receipts work' },
];
const row = (ic, a, v) => `<div class="ui-row"><span>${ic}</span><span>${a}</span><span class="amt">${v}</span></div>`;
const PRIM_VIEWS = [
  `<div class="ui-card"><div class="ui-top"><span>Recipients</span><span class="badge grey">winners.csv</span></div><div class="ui-big">128 rows</div>
    <div class="ui-seg"><span class="on">CSV</span><span>Paste</span><span>Same amount</span></div>
    <div class="ui-drop"><b>Drop a CSV here</b> · address,amount</div>
    <div class="ui-rows">${row('1', '0x8f3a…21c4', '25')}${row('2', '0x4b1e…9a07', '100')}${row('3', '0x77d0…be12', '40')}</div></div>`,
  `<div class="ui-card"><div class="ui-top"><span>Check</span><span class="badge red">2 to fix</span></div><div class="ui-big">126 of 128 OK</div>
    <div class="ui-rows">${row('✅', '0x8f3a…21c4', '<span class="badge green">OK</span>')}${row('❌', '0x12ab…9f3', '<span class="badge red">Wrong length</span>')}${row('⚠️', '0x4b1e…9a07', '<span class="badge amber">Duplicate</span>')}${row('ℹ️', '0xc0de…0001', '<span class="badge blue">Contract</span>')}${row('✅', '0x77d0…be12', '<span class="badge green">OK</span>')}</div>
    <div class="ui-seg"><span class="on">Fix all</span><span>Merge</span><span>Keep first</span></div></div>`,
  `<div class="ui-card"><div class="ui-top"><span>Batch #42 · Hackathon Week 5 prizes</span><span class="badge green">Confirmed</span></div><div class="ui-big">3,200 BOT</div>
    <div class="ui-bars">${Array.from({ length: 64 }, (_, i) => `<i style="height:${10 + Math.pow(i / 63, 2.2) * 90}%"></i>`).join('')}</div>
    <div class="ui-rows">${row('✓', '0x8f3a…21c4', '25 BOT')}${row('✓', '0x4b1e…9a07', '100 BOT')}${row('✓', '0x77d0…be12', '40 BOT')}</div>
    <div class="ui-seg"><span class="on">/r/42</span><span>Download CSV</span><span>Copy link</span></div></div>`,
];

const STORIES = [
  { tag: 'Hackathon', t: 'Paying 20 hackathon winners before the closing call ends', d: 'Export the results sheet, drop it in, merge one wallet pasted twice — one transaction, one receipt link in the chat.', stat: '20 winners · 1 transaction' },
  { tag: 'Community', t: 'Airdropping 500 community wallets the same 50 BOT', d: 'Paste the addresses, set one amount. 3 contracts flagged, 7 duplicates removed, split into batches that fit a block.', stat: '500 wallets · 3 transactions' },
  { tag: 'DAO', t: 'Monthly contributor tips in the DAO’s own token', d: 'Paste the token address, approve exactly the month’s total — never more — and download the CSV for the books.', stat: '12 contributors · every month' },
  { tag: 'Refunds', t: 'Refunding a failed mint, every buyer a different amount', d: 'Upload the buyers CSV, preview 84 refunds against your balance, and let buyers open the receipt to see they were paid.', stat: '84 refunds · 1 transaction' },
];

const FAQ = [
  ['How many addresses can I send to?', 'As many as you like. Each transaction carries up to 200 recipients (the contract allows 300), and Multisend shrinks a batch automatically if it would use more than 80% of a block. A list of 1,000 is about 5 transactions — you confirm each one.'],
  ['What does it cost?', 'Just gas. There are no fees, no subscriptions and no token. The contract is free to use and never holds your funds — everything that comes in goes straight out in the same transaction.'],
  ['What if one address fails?', 'The whole batch reverts, so nobody is half-paid. Before you send, Multisend simulates every batch; if one would fail it finds the exact row by splitting the batch in halves, highlights it and tells you why.'],
  ['Does it work with my token?', 'Any standard ERC-20 on BOT Chain, including tokens that don’t return a value on transfer. Paste the token address and its name, symbol, decimals and your balance load. Tokens that take a fee on transfer will deliver less than listed — we warn you.'],
  ['Can I try it on testnet first?', 'Yes — flip the Mainnet / Testnet switch in the app. Grab free test BOT from the faucet, send a small batch, check the receipt, then do the real thing.'],
];

const SAFE = [
  { ic: ICON.shield, t: 'Exact approvals only', d: 'For tokens you approve the batch total — never “unlimited”. When the batch is done the allowance is back to zero.', tag: 'Approvals' },
  { ic: ICON.vault, t: 'Nothing held by the contract', d: 'No deposits, no balances, no admin. Funds go from your wallet to recipients inside one transaction.', tag: 'Custody' },
  { ic: ICON.stack, t: 'Whole batch or nothing', d: 'If any transfer fails the entire batch reverts. Nobody is paid twice, nobody is half-paid.', tag: 'Atomic' },
  { ic: ICON.eye, t: 'Preview before every send', d: 'Every send shows the total and recipient count to confirm, after addresses, amounts and balance are checked.', tag: 'Preview' },
];

function heroArcs() {
  // Large thin arcs sweeping in from the top, like drafting lines.
  const arcs = [[1050, -1560, 1830], [1050, -1560, 1842], [380, -520, 760], [380, -520, 770], [1500, -900, 1150], [1500, -900, 1161], [900, -260, 480]];
  return `<svg class="hero-arcs" viewBox="0 0 2100 380" aria-hidden="true" fill="none" stroke="#DCDCDC" stroke-width="1.3">
    ${arcs.map(([x, y, r]) => `<circle class="arc" cx="${x}" cy="${y}" r="${r}" pathLength="1"/>`).join('')}
    <g stroke="#C4C4C4">${[[700, 252], [1010, 268], [1290, 250], [240, 60]].map(([x, y]) => `<path d="M${x} ${y - 6}v12M${x + 5} ${y - 6}v12"/>`).join('')}</g></svg>`;
}

function fanDiagram() {
  const rows = 11;
  const paths = Array.from({ length: rows }, (_, k) => {
    const y = 110 + k * 28;
    const x = 640 + (rows - 1 - k) * 24;
    return { d: `M70 250 C 230 250, 250 ${y}, 400 ${y} H ${x} Q ${x + 70} ${y}, ${x + 70} ${y + 70} V 470`, y, end: x + 70, on: k === 5 };
  });
  return `<svg viewBox="0 0 1000 560" aria-hidden="true" fill="none" stroke="${G}" stroke-width="1.2" font-family="Geist Mono" font-size="12" id="fan">
    <path d="M20 470h960"/><path d="M20 476h960" stroke="#E6E6E6"/>
    ${paths.map((p, i) => `<path class="fan-path" id="fan${i}" d="${p.d}" ${p.on ? 'stroke="#0A0A0A" stroke-width="1.5"' : ''}/>`).join('')}
    <g stroke="#DADADA" stroke-dasharray="2 3"><path d="M470 86v330M550 86v330"/></g>
    <path d="M470 86h80M470 416h80" stroke="#BDBDBD"/>
    ${paths.map((p) => `<circle cx="510" cy="${p.y}" r="${p.on ? 6.5 : 5.5}" fill="#F5F5F5" stroke="${p.on ? '#0A0A0A' : '#BDBDBD'}" ${p.on ? 'stroke-width="1.6"' : ''}/><circle cx="400" cy="${p.y}" r="2" fill="#F5F5F5" stroke="#BDBDBD"/>`).join('')}
    ${paths.map((p) => `<circle cx="${p.end}" cy="470" r="${p.on ? 9 : 3}" fill="${p.on ? '#F5F5F5' : '#0A0A0A'}" stroke="${p.on ? '#0A0A0A' : 'none'}"/>${p.on ? `<circle cx="${p.end}" cy="470" r="3.5" fill="#0A0A0A" stroke="none"/>` : ''}`).join('')}
    <circle cx="70" cy="250" r="11" fill="#F5F5F5" stroke="#0A0A0A"/><circle cx="70" cy="250" r="3.5" fill="#0A0A0A" stroke="none"/>
    <g stroke="none" fill="#0A0A0A"><text x="510" y="70" text-anchor="middle" letter-spacing="2" font-weight="600">MULTISEND</text><text x="70" y="216" text-anchor="middle" fill="#6B6B6B">YOUR WALLET</text>
      <text x="830" y="512" text-anchor="middle" font-family="Geist" font-size="22" font-weight="700" letter-spacing="-1">BOT CHAIN</text><text x="830" y="532" text-anchor="middle" fill="#6B6B6B">recipients · chain 677</text></g>
    <g id="fanDots"></g></svg>`;
}

function page() {
  return `
  <section class="hero" id="top">
    ${heroArcs()}
    <div class="wrap">
      <div class="hero-copy">
        <h1 id="heroTitle">Pay everyone at internet speed.</h1>
        <p class="hero-sub">Send BOT or any token to hundreds of wallets in one transaction — checked before, receipted after.</p>
        <div class="hero-cta">
          <a class="btn btn-mint btn-lg" href="app" data-link>Send a batch</a>
          <a class="btn btn-outline btn-lg" href="app?net=testnet" data-link>Try on testnet</a>
        </div>
      </div>
    </div>
    <div class="wrap" style="max-width:1500px">
      <div class="hero-media" id="heroStage">
        <canvas class="hero-canvas" id="rings" aria-hidden="true"></canvas>
        <div class="hero-wallet" aria-hidden="true">${LOGO}</div>
        <span class="hero-tag dark" style="left:17%;top:26%">0x8f3a…21c4 <b>+25 BOT</b></span>
        <span class="hero-tag" style="right:15%;top:20%">0x4b1e…9a07 <b>+100 BOT</b></span>
        <span class="hero-tag" style="right:21%;top:76%">128 recipients · <b>1 tx ✓</b></span>
        <span class="hero-tag" style="left:22%;top:74%">Hackathon Week 5 prizes</span>
      </div>
    </div>
  </section>

  <section class="section" id="use-cases">
    <div class="wrap">
      <span class="eyebrow reveal">Use cases</span>
      <h2 class="h2 reveal" style="margin-bottom:56px">Built for every payout</h2>
      <div class="grid-3">
        ${SOLUTIONS.map((s) => `<a class="card solution reveal" href="app" data-link><h3>${s.t} ${CHEV}</h3><p>${s.d}</p><div class="sol-art">${s.art}</div></a>`).join('')}
      </div>
    </div>
  </section>

  <section class="section" id="how" style="padding-top:20px">
    <div class="wrap">
      <span class="eyebrow reveal">How it works</span>
      <h2 class="h2 reveal" style="margin-bottom:56px">Powerful little primitives</h2>
      <div class="prims reveal">
        <div class="prim-list" id="primList">
          ${PRIMS.map((p, i) => `<div class="prim"><h3><button class="prim-btn" type="button" aria-expanded="${i === 0}" aria-controls="prim${i}" data-prim="${i}">${p.t}</button></h3>
            <div class="prim-body" id="prim${i}" style="${i === 0 ? 'height:auto' : ''}"><div><p>${p.d}</p><a class="more" href="${i === 2 ? './#receipts' : 'app'}" data-link>${p.link} ${CHEV}</a></div></div></div>`).join('')}
        </div>
        <div class="prim-panel" aria-hidden="true">${PRIM_VIEWS.map((v, i) => `<div class="prim-view ${i === 0 ? 'on' : ''}" data-view="${i}">${v}</div>`).join('')}</div>
      </div>
    </div>
  </section>

  <section class="section" id="stories" style="padding-top:20px;overflow:hidden">
    <div class="wrap">
      <span class="eyebrow reveal">Walkthroughs</span>
      <h2 class="h2 reveal">From spreadsheet to “everyone’s paid”</h2>
      <div class="slider reveal" id="slider" tabindex="0" aria-roledescription="carousel" aria-label="Use-case walkthroughs (use the arrow keys)">
        <div class="slider-head">
          <a class="btn btn-outline" href="app" data-link>Try it with your list</a>
          <div class="slider-ctrl">
            <span class="slider-count" id="sliderCount" aria-live="polite">1 of ${STORIES.length}</span>
            <button class="slider-btn prev" type="button" aria-label="Previous" data-dir="-1">${CHEV}</button>
            <button class="slider-btn next" type="button" aria-label="Next" data-dir="1">${CHEV}</button>
          </div>
        </div>
        <div class="slider-viewport"><div class="slider-track" id="sliderTrack">
          ${STORIES.map((s, i) => `<article class="slide" style="--photo:${PHOTOS[i]}" aria-roledescription="slide" aria-label="${i + 1} of ${STORIES.length}">
            <span class="slide-tag">${LOGO} ${s.tag}</span>
            <div><h3>${s.t}</h3><p>${s.d}</p><p class="mono" style="font-size:13px;margin-top:14px;opacity:.95">${s.stat}</p></div>
          </article>`).join('')}
        </div></div>
      </div>
    </div>
  </section>

  <section class="section" id="receipts" style="padding-top:20px">
    <div class="wrap">
      <span class="eyebrow reveal">Live numbers</span>
      <h2 class="h2 reveal" style="margin-bottom:56px">Every payout, on the record</h2>
      <div class="metrics">
        <div>
          <div class="stat-list">
            <div class="stat reveal"><b class="num" data-count="sent">0</b><span>BOT sent</span><small>through the contract, all-time</small></div>
            <div class="stat reveal"><b class="num" data-count="recipients">0</b><span>recipients paid</span><small>BOT and tokens</small></div>
            <div class="stat reveal"><b class="num" data-count="batches">0</b><span>batches</span><small>each with a public receipt</small></div>
          </div>
          <p class="live-note" id="liveNote">Reading the contract…</p>
        </div>
        <div class="phone-panel reveal">
          <div class="phone" aria-label="A receipt page on a phone">
            <div class="phone-screen"><div class="phone-notch"></div>
              <div class="phone-scroll" id="phoneScroll">
                <div class="phone-head">${pip('check', { size: 44 })}<div><h4>Hackathon Week 5 prizes</h4><small>Batch #42 · confirmed</small></div></div>
                <div class="phone-total"><b>3,200 BOT</b><span>128 recipients · 1 tx</span></div>
                ${Array.from({ length: 28 }, (_, i) => {
                  const h = ((i + 7) * 2654435761 % 0xffffffff).toString(16).padStart(8, '0');
                  return `<div class="phone-row"><span>0x${h.slice(0, 4)}…${h.slice(4, 8)}</span><span>${[25, 100, 40, 10, 250, 15, 60][i % 7]} <em>✓</em></span></div>`;
                }).join('')}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="section" id="safe" style="padding-top:20px">
    <div class="wrap">
      <span class="eyebrow reveal">Safety</span>
      <h2 class="h2 reveal" style="margin-bottom:56px">Safe by default</h2>
      <div class="grid-4">${SAFE.map((s, i) => `<article class="edu reveal"><div class="edu-img" style="--photo:${PHOTOS[(i + 1) % 4]}"><span class="edu-ic">${s.ic}</span></div><h3>${s.t}</h3><p>${s.d}</p><small>${s.tag}</small></article>`).join('')}</div>
    </div>
  </section>

  <section class="section" id="faq" style="padding-top:20px">
    <div class="wrap">
      <span class="eyebrow reveal">FAQ</span>
      <div class="faq">
        <h2 class="h2 reveal">Questions, answered</h2>
        <div class="faq-list">${FAQ.map(([q, a], i) => `<div class="faq-item reveal"><h3><button class="faq-q" type="button" aria-expanded="false" aria-controls="faq${i}" id="faqq${i}">${q}</button></h3>
          <div class="faq-a" id="faq${i}" role="region" aria-labelledby="faqq${i}"><div>${a}</div></div></div>`).join('')}</div>
      </div>
    </div>
  </section>

  <section class="section" id="start" style="padding-top:20px">
    <div class="wrap">
      <span class="eyebrow reveal">Get started</span>
      <h2 class="h2 reveal" style="margin-bottom:56px;max-width:20ch">One wallet in, everyone paid</h2>
      <div class="split">
        <div class="split-list">
          <div class="split-item reveal"><h3>Paying people?</h3><p>Drop in a CSV, check it, send. Your first batch takes about a minute.</p>
            <a class="btn btn-mint" style="margin-top:20px" href="app" data-link>Send a batch</a></div>
          <div class="split-item reveal"><h3>Building?</h3><p>Call the contract from your own app or script. Two functions, one event, no fees.</p>
<pre class="code" aria-label="Example contract call"><span class="c">// ethers v6 · BOT Chain mainnet (677)</span>
<span class="k">const</span> abi = [
 <span class="s">"function sendNative(address[],uint256[],string) payable"</span>,
 <span class="s">"function sendToken(address,address[],uint256[],string)"</span>,
];
<span class="k">const</span> ms = <span class="k">new</span> Contract(MULTISEND, abi, signer);
<span class="k">await</span> ms.sendNative(to, amounts, <span class="s">"Week 5"</span>, { value: total });</pre>
            <a class="more" id="useContract" href="${CONFIG.networks.mainnet.explorer}" target="_blank" rel="noopener">Use the contract ${ICON.ext}</a></div>
        </div>
        <div class="split-diagram reveal">${fanDiagram()}</div>
      </div>
    </div>
  </section>`;
}

// ─── hero rings (canvas): one wallet, rings of recipients lighting up as payments arrive ───
function rings(canvas) {
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, cx = 0, cy = 0, step = 80, dots = [], order = [], packets = [], pulses = [], last = 0, idx = 0, running = true;
  const RINGS = 7, SQ = 0.5;
  const ell = (r) => { ctx.beginPath(); ctx.ellipse(cx, cy, r, r * SQ, 0, 0, Math.PI * 2); };

  function layout() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    W = r.width; H = r.height;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx = W / 2; cy = H * 0.54;
    step = Math.max(58, W / 15);
    dots = [];
    for (let i = 0; i < RINGS; i++) {
      const rad = 100 + i * step, n = 8 + i * 6;
      for (let j = 0; j < n; j++) dots.push({ rad, a: i * 0.37 + (j / n) * Math.PI * 2, lit: 0 });
    }
    order = dots.map((_, i) => i).sort(() => Math.random() - 0.5);
  }

  function draw(t) {
    ctx.clearRect(0, 0, W, H);
    for (let i = 0; i < RINGS; i++) {
      ell(100 + i * step);
      ctx.strokeStyle = `rgba(0,0,0,${0.13 - i * 0.012})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    for (const p of pulses) {
      const k = (t - p.t0) / 2800;
      ell(70 + k * W * 0.6);
      ctx.strokeStyle = `rgba(0,0,0,${0.16 * (1 - k)})`;
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
    pulses = pulses.filter((p) => t - p.t0 < 2800);
    for (const p of packets) {
      const k = Math.min(1, (t - p.t0) / p.dur), e = 1 - Math.pow(1 - k, 3), d = dots[p.dot];
      const rad = 50 + (d.rad - 50) * e, a = d.a - (1 - e) * 0.9;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad * SQ, 2.4, 0, Math.PI * 2);
      ctx.fillStyle = '#0A0A0A';
      ctx.fill();
      if (k >= 1) { p.done = true; d.lit = t; }
    }
    packets = packets.filter((p) => !p.done);
    for (const d of dots) {
      const x = cx + Math.cos(d.a) * d.rad, y = cy + Math.sin(d.a) * d.rad * SQ;
      const glow = d.lit ? Math.max(0, 1 - (t - d.lit) / 3400) : 0;
      if (glow > 0.15) { ctx.beginPath(); ctx.arc(x, y, 7 + glow * 6, 0, Math.PI * 2); ctx.fillStyle = `rgba(18,161,80,${glow * 0.16})`; ctx.fill(); }
      ctx.beginPath();
      ctx.arc(x, y, 3 + glow * 1.4, 0, Math.PI * 2);
      ctx.fillStyle = glow > 0 ? `rgba(18,161,80,${0.4 + glow * 0.6})` : '#C9C9C9';
      ctx.fill();
    }
  }

  function tick() {
    if (!running) return;
    const t = performance.now();
    if (t - last > 85) { last = t; packets.push({ dot: order[idx++ % order.length], t0: t, dur: 900 + Math.random() * 500 }); }
    if (!pulses.length || t - pulses[pulses.length - 1].t0 > 2600) pulses.push({ t0: t });
    draw(t);
  }

  layout();
  const ro = new ResizeObserver(() => { layout(); if (reduced()) draw(performance.now()); });
  ro.observe(canvas);
  if (reduced() || !window.gsap) {
    const t = performance.now();
    dots.forEach((d, i) => { if (i % 3 === 0) d.lit = t; });
    draw(t);
    return () => ro.disconnect();
  }
  gsap.ticker.add(tick);
  const io = new IntersectionObserver(([e]) => { running = e.isIntersecting; });
  io.observe(canvas);
  return () => { gsap.ticker.remove(tick); ro.disconnect(); io.disconnect(); };
}

// ─── slider ─────────────────────────────────────────────────
function slider(root) {
  const track = $('#sliderTrack', root);
  const slides = $$('.slide', root);
  const count = $('#sliderCount', root);
  let i = 0;
  const show = (n) => {
    i = (n + slides.length) % slides.length;
    const x = -i * (slides[0].offsetWidth + 20);
    if (hasGsap()) gsap.to(track, { x, duration: 0.8, ease: 'power3.inOut' });
    else track.style.transform = `translateX(${x}px)`;
    slides.forEach((s, k) => { s.setAttribute('aria-hidden', String(k !== i)); s.style.opacity = k < i ? '0' : '1'; });
    count.textContent = `${i + 1} of ${slides.length}`;
  };
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dir]');
    if (b) show(i + Number(b.dataset.dir));
    const s = e.target.closest('.slide');
    if (s && slides.indexOf(s) !== i) show(slides.indexOf(s));
  });
  const onKey = (e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
    const r = root.getBoundingClientRect();
    const visible = r.top < innerHeight * 0.75 && r.bottom > innerHeight * 0.25;
    if (!visible && !root.contains(document.activeElement)) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); show(i + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); show(i - 1); }
  };
  const onResize = () => show(i);
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);
  return () => { document.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize); };
}

// ─── accordions (primitives + FAQ) ──────────────────────────
const setHeight = (el, open) => (hasGsap() ? gsap.to(el, { height: open ? 'auto' : 0, duration: 0.45, ease: 'power2.inOut' }) : (el.style.height = open ? 'auto' : '0'));

function prims(root) {
  const btns = $$('.prim-btn', root), views = $$('.prim-view', root);
  let timer;
  const show = (n) => {
    btns.forEach((b, k) => { b.setAttribute('aria-expanded', String(k === n)); setHeight($('#' + b.getAttribute('aria-controls')), k === n); });
    views.forEach((v, k) => v.classList.toggle('on', k === n));
    if (hasGsap()) gsap.fromTo(views[n], { y: 18, opacity: 0, scale: 0.98 }, { y: 0, opacity: 1, scale: 1, duration: 0.5, ease: 'power3.out' });
  };
  btns.forEach((b, k) => b.addEventListener('click', () => { clearInterval(timer); show(k); }));
  if (!reduced()) timer = setInterval(() => {
    const r = root.querySelector('.prims').getBoundingClientRect();
    if (r.top < innerHeight && r.bottom > 0) show((btns.findIndex((b) => b.getAttribute('aria-expanded') === 'true') + 1) % btns.length);
  }, 5000);
  return () => clearInterval(timer);
}

function faq(root) {
  $$('.faq-q', root).forEach((q) => q.addEventListener('click', () => {
    const open = q.getAttribute('aria-expanded') !== 'true';
    q.setAttribute('aria-expanded', String(open));
    setHeight($('#' + q.getAttribute('aria-controls')), open);
  }));
}

// ─── fan diagram: payments travelling the lines (MotionPath) ───
function fan(root) {
  if (!hasGsap() || !window.MotionPathPlugin) return;
  const g = $('#fanDots', root), paths = $$('.fan-path', root);
  paths.forEach((p, k) => {
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('r', '3.2');
    c.setAttribute('fill', k === 5 ? '#12A150' : '#0A0A0A');
    c.setAttribute('stroke', 'none');
    g.append(c);
    gsap.to(c, { motionPath: { path: p, align: p, alignOrigin: [0.5, 0.5] }, duration: 3.2, ease: 'power1.inOut', repeat: -1, delay: k * 0.28, repeatDelay: 0.6, scrollTrigger: { trigger: '#fan', start: 'top 90%', toggleActions: 'play pause resume pause' } });
  });
}

// ─── live numbers ───────────────────────────────────────────
async function liveNumbers(root) {
  const note = $('#liveNote', root);
  const els = Object.fromEntries($$('[data-count]', root).map((e) => [e.dataset.count, e]));
  let values = { sent: 0, recipients: 0, batches: 0 };
  try {
    const s = await stats('mainnet');
    if (s) {
      values = { sent: Number(window.ethers.formatEther(s.nativeSent)), recipients: Number(s.recipients), batches: Number(s.batches) };
      note.textContent = `Live from ${contractAddress('mainnet').slice(0, 10)}… on BOT Chain mainnet`;
    } else note.textContent = 'The mainnet contract isn’t deployed yet — these go live the moment it is.';
  } catch {
    note.textContent = 'Couldn’t reach BOT Chain right now — showing 0 for the moment.';
  }
  const fmt = (k, v) => (k === 'sent' ? compact(v) : fmtInt(Math.round(v)));
  for (const [k, el] of Object.entries(els)) {
    if (!hasGsap()) { el.textContent = fmt(k, values[k]); continue; }
    const o = { v: 0 };
    gsap.to(o, { v: values[k], duration: 1.8, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 85%' }, onUpdate: () => (el.textContent = fmt(k, o.v)) });
  }
}

export async function mount(view) {
  document.title = 'BOT Multisend — pay everyone in one click';
  view.innerHTML = page();
  const addr = contractAddress('mainnet');
  if (addr) $('#useContract', view).href = `${CONFIG.networks.mainnet.explorer}/address/${addr}#code`;
  const cleanups = [rings($('#rings', view)), slider($('#slider', view)), prims(view)];
  faq(view);
  bob(view);
  liveNumbers(view);

  if (hasGsap()) {
    if (window.SplitText) {
      const split = new SplitText('#heroTitle', { type: 'words' });
      gsap.fromTo(split.words, { yPercent: 50, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.9, ease: 'power3.out', stagger: 0.07 });
      cleanups.push(() => split.revert());
    }
    gsap.fromTo('.hero-sub, .hero-cta', { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, ease: 'power2.out', stagger: 0.1, delay: 0.35 });
    gsap.fromTo('.hero-arcs .arc', { strokeDasharray: 1, strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 2.4, ease: 'power2.inOut', stagger: 0.12 });
    gsap.fromTo('.hero-media', { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 1, ease: 'power3.out', delay: 0.5 });
    gsap.fromTo('.hero-wallet', { scale: 0.6 }, { scale: 1, duration: 1, ease: 'back.out(1.6)', delay: 0.8 });
    gsap.fromTo('.hero-tag', { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.6, stagger: 0.2, delay: 1.2 });
    gsap.to('.hero-tag', { yPercent: -18, duration: 2.4, ease: 'sine.inOut', yoyo: true, repeat: -1, stagger: 0.4, delay: 2.2 });
    const below = $$('.reveal', view).filter((el) => el.getBoundingClientRect().top > innerHeight * 0.9);
    gsap.set(below, { opacity: 0, y: 28 });
    ScrollTrigger.batch(below, { start: 'top 90%', once: true, onEnter: (els) => gsap.to(els, { y: 0, opacity: 1, duration: 0.8, ease: 'power3.out', stagger: 0.08, overwrite: true }) });
    const ps = $('#phoneScroll', view);
    gsap.to(ps, { y: () => -(ps.scrollHeight - 540), duration: 14, ease: 'none', repeat: -1, yoyo: true, repeatDelay: 1.2, delay: 1.5, scrollTrigger: { trigger: ps, start: 'top 90%', toggleActions: 'play pause resume pause' } });
    fan(view);
  }
  return () => cleanups.forEach((c) => c?.());
}
