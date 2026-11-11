// Recipient list logic: parsing (CSV / paste / same amount), validation, fixes, batching, CSV out.
// Pure functions — the browser passes window.ethers / window.Papa, tests pass the npm packages.

const ORDER = { invalid: 0, badAmount: 1, zero: 2, self: 3, dup: 4, contract: 5, ok: 6 };
export const BLOCKING = new Set(['invalid', 'badAmount']);
export const LABELS = {
  ok: 'OK',
  invalid: 'Invalid address',
  badAmount: 'Bad amount',
  zero: 'Zero amount',
  self: 'Your own address',
  dup: 'Duplicate',
  contract: 'Contract address',
};

const deps = { ethers: globalThis.ethers, Papa: globalThis.Papa };
export function useDeps(d) { Object.assign(deps, d); }
const E = () => deps.ethers || globalThis.ethers;

// ─── reading text ────────────────────────────────────────────────────────────

/** CSV text → string[][] (PapaParse picks the delimiter: comma, tab, semicolon). */
export function readCsv(text) {
  const Papa = deps.Papa || globalThis.Papa;
  const out = Papa.parse(text.replace(/^﻿/, ''), { skipEmptyLines: 'greedy' });
  return out.data.map((r) => r.map((c) => String(c ?? '').trim())).filter((r) => r.some(Boolean));
}

/** Pasted lines like "0xabc…, 25" or "0xabc… 25" or tab-separated. */
export function readPaste(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split(/[\s,;]+/).filter(Boolean));
}

/** Addresses only (any separator), for "same amount". */
export function readAddresses(text) {
  return text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
}

const looksAddress = (s) => /^0x[0-9a-fA-F]{40}$/.test(String(s).trim());
const looksAmount = (s) => /^[\d.,_]+$/.test(String(s).trim()) && /\d/.test(s);

/**
 * Works out which column is the address and which is the amount.
 * Returns { header: string[]|null, rows: string[][], address, amount, confident, columns }.
 */
export function guessColumns(table) {
  if (!table.length) return { header: null, rows: [], address: 0, amount: 1, confident: true, columns: 2 };
  const first = table[0];
  const hasHeader = !first.some(looksAddress);
  const header = hasHeader ? first : null;
  const rows = hasHeader ? table.slice(1) : table;
  const columns = Math.max(...table.map((r) => r.length));
  const sample = rows.slice(0, 50);
  const score = (fn) => Array.from({ length: columns }, (_, i) => sample.filter((r) => fn(r[i] ?? '')).length);
  const addrScore = score(looksAddress);
  const amtScore = score(looksAmount);

  const named = (re) => (header ? header.findIndex((h) => re.test(h)) : -1);
  let address = named(/address|wallet|recipient|account|^to$/i);
  let amount = named(/amount|value|qty|quantity|tokens?|bot|sum/i);
  if (address < 0) address = addrScore.indexOf(Math.max(...addrScore));
  if (amount < 0 || amount === address) {
    let best = -1;
    amtScore.forEach((s, i) => { if (i !== address && (best < 0 || s > amtScore[best])) best = i; });
    amount = best;
  }
  const addrOk = sample.length > 0 && addrScore[address] >= Math.ceil(sample.length / 2);
  const amtOk = amount >= 0 && amtScore[amount] >= Math.ceil(sample.length / 2);
  const confident = addrOk && (amtOk || columns === 1) && columns <= 2;
  return { header, rows, address, amount, confident, columns };
}

// ─── amounts ─────────────────────────────────────────────────────────────────

/** "1,000.50" → bigint in base units. Throws a short, human message. */
export function parseAmount(raw, decimals) {
  let s = String(raw ?? '').trim().replace(/[_\s]/g, '');
  if (!s) throw new Error('Missing amount');
  if (s.includes(',') && s.includes('.')) s = s.replace(/,/g, ''); // 1,000.50
  else if (/^\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, ''); // 1,000
  else if (/^\d+,\d+$/.test(s)) s = s.replace(',', '.'); // 2,5 (decimal comma)
  if (s.startsWith('.')) s = '0' + s;
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(s.startsWith('-') ? 'Negative amount' : 'Not a number');
  const [int, rawFrac = ''] = s.split('.');
  const frac = rawFrac.replace(/0+$/, '');
  if (frac.length > decimals) throw new Error(`Too many decimals (max ${decimals})`);
  return E().parseUnits(frac ? `${int}.${frac}` : int, decimals);
}

/** bigint → "1,234.5" (trimmed, grouped). */
export function formatAmount(value, decimals, maxFrac = 6) {
  const neg = value < 0n;
  const s = E().formatUnits(neg ? -value : value, decimals);
  let [int, frac = ''] = s.split('.');
  frac = frac.replace(/0+$/, '');
  if (frac.length > maxFrac) frac = frac.slice(0, maxFrac).replace(/0+$/, '') || '';
  int = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + int + (frac ? '.' + frac : '');
}

/** bigint → plain decimal string for CSV ("1234.5"). */
export const plainAmount = (value, decimals) => E().formatUnits(value, decimals).replace(/\.0$/, '');

// ─── rows ────────────────────────────────────────────────────────────────────

let uid = 0;

/** Raw cells → rows {id, line, rawAddress, rawAmount}. `lineOffset` = 1 if a header was skipped. */
export function toRows(cells, map, lineOffset = 0) {
  return cells.map((r, i) => ({
    id: ++uid,
    line: i + 1 + lineOffset,
    rawAddress: (r[map.address] ?? '').trim(),
    rawAmount: map.amount >= 0 ? (r[map.amount] ?? '').trim() : '',
  }));
}

export function sameAmountRows(addresses, amount) {
  return addresses.map((a, i) => ({ id: ++uid, line: i + 1, rawAddress: a, rawAmount: String(amount ?? '').trim() }));
}

export function normaliseAddress(raw) {
  const ethers = E();
  const s = String(raw).trim();
  if (!/^0x[0-9a-fA-F]{40}$/i.test(s)) {
    if (/^[0-9a-fA-F]{40}$/.test(s)) return { error: 'Missing 0x prefix' };
    if (/\.(eth|bot)$/i.test(s)) return { error: 'Names are not supported — use the 0x address' };
    if (/^0x[0-9a-fA-F]*$/i.test(s)) return { error: `Wrong length (${s.length - 2} of 40 characters)` };
    return { error: 'Not an address' };
  }
  const mixed = s !== s.toLowerCase() && s.slice(2) !== s.slice(2).toUpperCase();
  if (mixed && !ethers.isAddress(s)) return { error: 'Checksum does not match — possible typo' };
  const address = ethers.getAddress(s.toLowerCase());
  if (address === ethers.ZeroAddress) return { error: 'Zero address (would burn funds)' };
  return { address };
}

/**
 * Validates every row. opts: { decimals, self (address|null), contracts (Set of lowercase addresses) }.
 * Adds: address, amount (bigint|null), issues: [{type, note}], status (worst issue or 'ok').
 */
export function checkRows(rows, { decimals = 18, self = null, contracts = new Set() } = {}) {
  const seen = new Map();
  const me = self ? self.toLowerCase() : null;
  const out = rows.map((r) => {
    const issues = [];
    const a = normaliseAddress(r.rawAddress);
    if (a.error) issues.push({ type: 'invalid', note: a.error });
    let amount = null;
    try {
      amount = parseAmount(r.rawAmount, decimals);
      if (amount === 0n) issues.push({ type: 'zero', note: 'Amount is 0' });
    } catch (e) {
      issues.push({ type: 'badAmount', note: e.message });
    }
    const key = a.address?.toLowerCase();
    if (key) {
      if (me && key === me) issues.push({ type: 'self', note: 'This is your connected wallet' });
      if (contracts.has(key)) issues.push({ type: 'contract', note: 'Contract — may not accept BOT' });
      if (seen.has(key)) seen.get(key).push(r.id);
      else seen.set(key, [r.id]);
    }
    return { ...r, address: a.address || null, amount, issues };
  });
  const dupIds = new Set([...seen.values()].filter((ids) => ids.length > 1).flat());
  for (const r of out) {
    if (dupIds.has(r.id)) {
      const n = seen.get(r.address.toLowerCase()).length;
      r.issues.push({ type: 'dup', note: `Appears ${n}× in the list` });
    }
    r.issues.sort((x, y) => ORDER[x.type] - ORDER[y.type]);
    r.status = r.issues[0]?.type || 'ok';
  }
  return out;
}

/** Duplicates: 'merge' (sum amounts into the first row), 'first' (keep first), 'remove' (drop all copies). */
export function resolveDuplicates(rows, mode, decimals = 18) {
  const groups = new Map();
  for (const r of rows) {
    const k = r.address?.toLowerCase();
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const drop = new Set();
  const replace = new Map();
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    if (mode === 'remove') g.forEach((r) => drop.add(r.id));
    else {
      g.slice(1).forEach((r) => drop.add(r.id));
      if (mode === 'merge') {
        const total = g.reduce((s, r) => s + (r.amount ?? 0n), 0n);
        replace.set(g[0].id, { ...g[0], rawAmount: plainAmount(total, decimals) });
      }
    }
  }
  return rows.filter((r) => !drop.has(r.id)).map((r) => replace.get(r.id) || r);
}

/** [Fix all]: drop invalid / bad / zero / own-address rows, merge duplicates. Contracts stay (info only). */
export function fixAll(rows, decimals = 18) {
  const kept = rows.filter((r) => !r.issues.some((i) => ['invalid', 'badAmount', 'zero', 'self'].includes(i.type)));
  return resolveDuplicates(kept, 'merge', decimals);
}

export function summarize(rows) {
  const counts = Object.fromEntries(Object.keys(ORDER).map((k) => [k, 0]));
  let total = 0n;
  for (const r of rows) {
    for (const t of new Set(r.issues.map((i) => i.type))) counts[t]++;
    if (!r.issues.length) counts.ok++;
    if (r.amount != null && !r.issues.some((i) => BLOCKING.has(i.type))) total += r.amount;
  }
  const blocking = rows.filter((r) => r.issues.some((i) => BLOCKING.has(i.type))).length;
  const warnings = rows.filter((r) => !r.issues.some((i) => BLOCKING.has(i.type)) && r.issues.some((i) => i.type !== 'contract')).length;
  return { count: rows.length, total, counts, blocking, warnings, ready: rows.length > 0 && blocking === 0 };
}

/** Split into chunks of at most `size`. */
export function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export function toCsv(rows, decimals, extra) {
  const head = ['address', 'amount', ...(extra ? Object.keys(extra(rows[0] || {}, 0)) : [])];
  const lines = rows.map((r, i) => [r.address, plainAmount(r.amount, decimals), ...(extra ? Object.values(extra(r, i)) : [])].join(','));
  return [head.join(','), ...lines].join('\n') + '\n';
}

export const TEMPLATE_CSV =
  'address,amount\n0x1111111111111111111111111111111111111111,25\n0x2222222222222222222222222222222222222222,10.5\n0x3333333333333333333333333333333333333333,100\n';
