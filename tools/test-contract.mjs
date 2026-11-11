// Runs Multisend on an in-memory chain and checks the PRD rules (section 5).
// Usage (from the project root): node tools/compile.mjs --mocks && node tools/test-contract.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ganache from 'ganache';
import * as ethers from 'ethers';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const art = JSON.parse(readFileSync(join(root, 'build/Multisend.json'), 'utf8'));
const mocks = JSON.parse(readFileSync(join(root, 'build/mocks.json'), 'utf8'));
const chain = ganache.provider({ logging: { quiet: true }, chain: { hardfork: 'merge', chainId: 677 }, wallet: { totalAccounts: 3, defaultBalance: 10_000 } });
const provider = new ethers.BrowserProvider(chain);
const [alice, bob] = await Promise.all([0, 1].map((i) => provider.getSigner(i)));
const deploy = async (a, ...args) => (await new ethers.ContractFactory(a.abi, a.bytecode, alice).deploy(...args)).waitForDeployment();
const ms = await deploy(art);
const msAddr = await ms.getAddress();
const reverts = (call, name) => assert.rejects(call, (e) => e.revert?.name === name || (e.message || '').includes(name), `expected ${name}`);
let checks = 0;
const ok = (label) => { checks++; console.log(`  ✓ ${label}`); };
const addrs = (n, seed = 1) => Array.from({ length: n }, (_, i) => ethers.getAddress('0x' + (seed * 100000 + i + 1).toString(16).padStart(40, '0')));
const E = (v) => ethers.parseEther(String(v));
const bal = (a) => provider.getBalance(a);

console.log('Multisend contract');
assert.equal(await ms.batches(), 0n);
assert.equal(await ms.MAX_RECIPIENTS(), 300n);
ok('deploys empty; MAX_RECIPIENTS = 300');

// ── sendNative
const to = addrs(10);
const amounts = to.map((_, i) => E(i + 1)); // 1..10 BOT = 55
const rc = await (await ms.connect(alice).sendNative(to, amounts, 'Hackathon Week 5 prizes', { value: E(55) })).wait();
for (let i = 0; i < 10; i++) assert.equal(await bal(to[i]), E(i + 1));
assert.equal(await bal(msAddr), 0n);
const ev = ms.interface.parseLog(rc.logs[0]);
assert.equal(ev.name, 'BatchSent');
assert.equal(ev.args.id, 0n); assert.equal(ev.args.sender, alice.address); assert.equal(ev.args.token, ethers.ZeroAddress);
assert.equal(ev.args.total, E(55)); assert.equal(ev.args.count, 10n); assert.equal(ev.args.name, 'Hackathon Week 5 prizes');
ok('sendNative pays every recipient, emits BatchSent(token = 0), keeps nothing');

assert.equal(await ms.batchBlock(0), BigInt(rc.blockNumber));
const [b, r, n] = await ms.stats();
assert.deepEqual([b, r, n], [1n, 10n, E(55)]);
ok('batchBlock + stats() track batches, recipients, BOT sent');

await reverts(ms.sendNative.staticCall(to, amounts, '', { value: E(54) }), 'ValueMismatch');
await reverts(ms.sendNative.staticCall(to, amounts, '', { value: E(56) }), 'ValueMismatch');
ok('msg.value must equal the sum exactly');

await reverts(ms.sendNative.staticCall(to, amounts.slice(1), '', { value: E(54) }), 'LengthMismatch');
await reverts(ms.sendNative.staticCall([], [], ''), 'NoRecipients');
await reverts(ms.sendNative.staticCall(addrs(301, 2), Array(301).fill(1n), '', { value: 301n }), 'TooManyRecipients');
await reverts(ms.sendNative.staticCall([ethers.ZeroAddress], [1n], '', { value: 1n }), 'ZeroRecipient');
await reverts(ms.sendNative.staticCall([to[0]], [1n], 'x'.repeat(65), { value: 1n }), 'NameTooLong');
await ms.sendNative.staticCall([to[0]], [1n], 'x'.repeat(64), { value: 1n });
ok('length mismatch, empty, > 300, zero address and name > 64 bytes all revert');

const big = addrs(300, 3);
const rc300 = await (await ms.sendNative(big, Array(300).fill(1000n), '', { value: 300_000n })).wait();
assert.equal(await bal(big[299]), 1000n);
console.log(`    (300 native recipients used ${rc300.gasUsed.toLocaleString()} gas)`);
ok('300 recipients fit in one tx');

const rej = await deploy(mocks.Rejecter);
const rejAddr = await rej.getAddress();
const before = await bal(to[0]);
await reverts(ms.sendNative.staticCall([to[0], rejAddr], [1n, 1n], '', { value: 2n }), 'NativeSendFailed');
await assert.rejects(ms.sendNative([to[0], rejAddr], [1n, 1n], '', { value: 2n, gasLimit: 500000 }).then((t) => t.wait()));
assert.equal(await bal(to[0]), before);
ok('one failed send reverts the whole batch');

const re = await deploy(mocks.Reenterer, msAddr);
await reverts(ms.sendNative.staticCall([await re.getAddress()], [1n], '', { value: 1n }), 'NativeSendFailed');
ok('re-entering sendNative is blocked');

// ── sendToken
const tok = await deploy(mocks.MockToken);
const tokAddr = await tok.getAddress();
await (await tok.mint(alice.address, 5_000_000n)).wait();
const tTo = addrs(5, 4);
const tAmt = [100n, 200n, 300n, 400n, 500n]; // 1500
await reverts(ms.sendToken.staticCall(tokAddr, tTo, tAmt, ''), 'TokenTransferFailed');
await (await tok.approve(msAddr, 1500n)).wait();
const trc = await (await ms.sendToken(tokAddr, tTo, tAmt, 'USDX tips')).wait();
for (let i = 0; i < 5; i++) assert.equal(await tok.balanceOf(tTo[i]), tAmt[i]);
assert.equal(await tok.allowance(alice.address, msAddr), 0n);
assert.equal(await tok.balanceOf(msAddr), 0n);
const tev = ms.interface.parseLog(trc.logs.find((l) => l.address === msAddr));
assert.equal(tev.args.token, tokAddr); assert.equal(tev.args.total, 1500n); assert.equal(tev.args.count, 5n);
ok('sendToken with an exact approval pays everyone and uses the allowance up to 0');

await (await tok.approve(msAddr, 1499n)).wait();
await reverts(ms.sendToken.staticCall(tokAddr, tTo, tAmt, ''), 'TokenTransferFailed');
ok('allowance one unit short → reverts');

const nr = await deploy(mocks.NoReturnToken);
await (await nr.mint(alice.address, 100n)).wait();
await (await nr.approve(msAddr, 100n)).wait();
await (await ms.sendToken(await nr.getAddress(), [tTo[0], tTo[1]], [40n, 60n], '')).wait();
assert.equal(await nr.balanceOf(tTo[1]), 60n);
ok('works with tokens whose transferFrom returns nothing (USDT-style)');

await reverts(ms.sendToken.staticCall(await (await deploy(mocks.FalseToken)).getAddress(), [tTo[0]], [1n], ''), 'TokenTransferFailed');
await reverts(ms.sendToken.staticCall(bob.address, [tTo[0]], [1n], ''), 'NotAToken');
ok('token returning false, or an address with no code → reverts');

assert.deepEqual([...(await ms.batchesOf(alice.address))].map(Number), [0, 1, 2, 3]);
assert.deepEqual([...(await ms.batchesOf(bob.address))], []);
const [b2, r2] = await ms.stats();
assert.equal(b2, 4n); assert.equal(r2, 10n + 300n + 5n + 2n);
ok('batchesOf lists a sender\'s batches; counters include token batches');

// calldata decodes back to the recipient list (used by the receipt page)
const tx = await provider.getTransaction(rc.hash);
const dec = ms.interface.parseTransaction({ data: tx.data, value: tx.value });
assert.equal(dec.name, 'sendNative'); assert.deepEqual([...dec.args[0]], to); assert.deepEqual([...dec.args[1]], amounts);
ok('receipt can rebuild every recipient + amount from tx calldata');

console.log(`\n${checks} checks passed`);
