// Checks the list logic in assets/lists.js (parsing, validation, fixes, batching).
// Usage (from the project root): node tools/test-lists.mjs
import assert from 'node:assert/strict';
import * as ethers from 'ethers';
import Papa from 'papaparse';
import * as L from '../assets/lists.js';

L.useDeps({ ethers, Papa });
let checks = 0;
const ok = (label) => { checks++; console.log(`  ✓ ${label}`); };
const A = (i) => ethers.getAddress('0x' + i.toString(16).padStart(40, '0'));
const ME = A(999);

console.log('List logic');

// CSV with header, BOM, quoted amount with thousands separator
let t = L.readCsv(`﻿address,amount\n${A(1)},25\n${A(2)},"1,000.50"\n\n`);
let g = L.guessColumns(t);
assert.ok(g.header); assert.equal(g.address, 0); assert.equal(g.amount, 1); assert.ok(g.confident);
let rows = L.checkRows(L.toRows(g.rows, g, 1), { decimals: 18 });
assert.equal(rows[1].amount, ethers.parseEther('1000.5')); assert.equal(rows[1].line, 3);
ok('CSV with header + BOM; "1,000.50" → 1000.5');

// No header, tab-separated
t = L.readCsv(`${A(1)}\t5\n${A(2)}\t6\n`);
g = L.guessColumns(t);
assert.equal(g.header, null); assert.equal(L.toRows(g.rows, g).length, 2);
ok('header optional; tab-separated works');

// Swapped / extra columns → mapper needed, best guess still right
t = L.readCsv(`name,amount,wallet\nAda,5,${A(1)}\nBob,6,${A(2)}\n`);
g = L.guessColumns(t);
assert.equal(g.address, 2); assert.equal(g.amount, 1); assert.equal(g.confident, false);
ok('3 columns → column mapper shown with address=wallet, amount=amount guessed');

t = L.readCsv(`foo,bar\nhello,world\n`);
g = L.guessColumns(t);
assert.equal(g.confident, false);
ok('no address column → not confident (asks which column is the address)');

// Paste list: spaces, commas, tabs
const p = L.readPaste(`${A(1)}, 25\n${A(2)} 10\n${A(3)}\t7.5\n`);
assert.deepEqual(p.map((r) => r[1]), ['25', '10', '7.5']);
ok('paste list accepts comma, space and tab separators');

// Same amount
const same = L.sameAmountRows(L.readAddresses(`${A(1)}\n${A(2)}, ${A(3)}`), '3');
assert.equal(same.length, 3); assert.ok(same.every((r) => r.rawAmount === '3'));
ok('same amount: any separators, one amount for all');

// Validation
const lower = A(4).toLowerCase();
const good = ethers.getAddress('0xde0b295669a9fd93d5f28d9ec85e40f4cb697bae');
const k = [...good].findIndex((c, i) => i > 1 && /[a-fA-F]/.test(c));
const badSum = good.slice(0, k) + (good[k] === good[k].toUpperCase() ? good[k].toLowerCase() : good[k].toUpperCase()) + good.slice(k + 1);
const raw = [
  [A(1), '10'], // ok
  ['0x1234', '5'], // invalid
  [lower, '0'], // zero
  [A(1), '5'], // dup of row 1
  [ME, '2'], // self
  [A(6), 'abc'], // bad amount
  [A(7), '1.1234567'], // too many decimals for 6
  [A(8), '-3'], // negative
  [ethers.ZeroAddress, '1'], // zero address
  [A(9).slice(2), '1'], // no 0x
];
rows = L.checkRows(L.toRows(raw, { address: 0, amount: 1 }), { decimals: 6, self: ME, contracts: new Set([A(1).toLowerCase()]) });
const st = rows.map((r) => r.status);
assert.deepEqual(st, ['dup', 'invalid', 'zero', 'dup', 'self', 'badAmount', 'badAmount', 'badAmount', 'invalid', 'invalid']);
assert.ok(rows[0].issues.some((i) => i.type === 'contract'));
assert.match(rows[6].issues[0].note, /max 6/);
assert.match(rows[9].issues[0].note, /0x/);
ok('statuses: invalid, duplicate, zero, own address, bad amount, decimals, zero address, missing 0x');

{
  const r = L.checkRows(L.toRows([[badSum, '1']], { address: 0, amount: 1 }));
  assert.equal(r[0].status, 'invalid'); assert.match(r[0].issues[0].note, /Checksum/);
  ok('mixed-case address with a wrong checksum is flagged');
}

let s = L.summarize(rows);
assert.equal(s.blocking, 6); assert.equal(s.ready, false); assert.equal(s.counts.dup, 2);
ok('summary counts blocking rows; not ready while errors remain');

// Fix all
let fixed = L.checkRows(L.fixAll(rows, 6), { decimals: 6, self: ME });
assert.equal(fixed.length, 1);
assert.equal(fixed[0].amount, 15_000_000n); // 10 + 5 merged
assert.ok(L.summarize(fixed).ready);
ok('[Fix all] removes bad/zero/self rows and merges duplicates');

// Duplicate modes
const dupRows = L.checkRows(L.toRows([[A(1), '1'], [A(2), '2'], [A(1), '3']], { address: 0, amount: 1 }));
assert.deepEqual(L.checkRows(L.resolveDuplicates(dupRows, 'merge')).map((r) => r.amount), [ethers.parseEther('4'), ethers.parseEther('2')]);
assert.deepEqual(L.checkRows(L.resolveDuplicates(dupRows, 'first')).map((r) => r.amount), [ethers.parseEther('1'), ethers.parseEther('2')]);
assert.deepEqual(L.checkRows(L.resolveDuplicates(dupRows, 'remove')).map((r) => r.address), [A(2)]);
ok('duplicates: merge amounts / keep first / remove');

// Amount formats
const d = (x, dec = 18) => L.parseAmount(x, dec);
assert.equal(d('1,000'), ethers.parseEther('1000'));
assert.equal(d('2,5'), ethers.parseEther('2.5'));
assert.equal(d('.5'), ethers.parseEther('0.5'));
assert.equal(d('1.500000', 2), 150n);
assert.equal(d('0.000000000000000001'), 1n);
assert.throws(() => d('0.0000000000000000001'), /max 18/);
assert.throws(() => d(''), /Missing/);
assert.equal(L.formatAmount(ethers.parseEther('1234567.5'), 18), '1,234,567.5');
ok('amount formats: 1,000 · 2,5 · .5 · trailing zeros · 18-decimal max; display grouping');

// Batching
const many = Array.from({ length: 1234 }, (_, i) => i);
assert.deepEqual(L.chunk(many, 200).map((c) => c.length), [200, 200, 200, 200, 200, 200, 34]);
ok('1,234 rows → 7 batches of ≤ 200');

const csv = L.toCsv(fixed, 6);
assert.equal(csv, `address,amount\n${A(1)},15\n`);
ok('CSV out round-trips');

console.log(`\n${checks} checks passed`);
