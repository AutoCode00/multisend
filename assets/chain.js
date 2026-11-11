// BOT Chain access: read providers, MetaMask wallet, the Multisend contract, tokens, receipts.
import { CONFIG } from './config.js';

const ethers = window.ethers;

export const MULTISEND_ABI = [
  'function MAX_RECIPIENTS() view returns (uint256)',
  'function batches() view returns (uint256)',
  'function stats() view returns (uint256 batchCount, uint256 recipients, uint256 nativeSent)',
  'function batchBlock(uint256) view returns (uint256)',
  'function batchesOf(address) view returns (uint256[])',
  'function sendNative(address[] to, uint256[] amounts, string name) payable returns (uint256 id)',
  'function sendToken(address token, address[] to, uint256[] amounts, string name) returns (uint256 id)',
  'event BatchSent(uint256 indexed id, address indexed sender, address indexed token, uint256 total, uint256 count, string name)',
  'error LengthMismatch()',
  'error NoRecipients()',
  'error TooManyRecipients(uint256 count, uint256 max)',
  'error NameTooLong()',
  'error ZeroRecipient(uint256 index)',
  'error ValueMismatch(uint256 expected, uint256 sent)',
  'error NativeSendFailed(uint256 index, address to)',
  'error NotAToken(address token)',
  'error TokenTransferFailed(uint256 index, address to)',
  'error Reentrancy()',
];
export const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
];
export const iface = new ethers.Interface(MULTISEND_ABI);

export const NETS = CONFIG.networks;
export const net = (key) => NETS[key] || NETS.mainnet;
export const explorerTx = (key, h) => `${net(key).explorer}/tx/${h}`;
export const explorerAddr = (key, a) => `${net(key).explorer}/address/${a}`;

/** Contract address: config first, then one saved by deploy.html in this browser (handy before you edit config.js). */
export function contractAddress(key) {
  const n = net(key);
  if (n.multisend) return n.multisend;
  try { return localStorage.getItem('multisend.contract.' + n.chainId) || ''; } catch { return ''; }
}

const readers = {};
export function reader(key) {
  if (!readers[key]) {
    const n = net(key);
    readers[key] = new ethers.JsonRpcProvider(n.rpc, n.chainId, { staticNetwork: ethers.Network.from(n.chainId), batchMaxCount: 50 });
  }
  return readers[key];
}

export function multisend(key, runner) {
  const a = contractAddress(key);
  return a ? new ethers.Contract(a, MULTISEND_ABI, runner || reader(key)) : null;
}

// ─── wallet ──────────────────────────────────────────────────────────────────

export const wallet = { account: null, chainId: null };
const listeners = new Set();
export const onWallet = (fn) => (listeners.add(fn), () => listeners.delete(fn));
const emit = () => listeners.forEach((fn) => fn(wallet));
export const hasWallet = () => !!window.ethereum;
export const netKeyOf = (chainId) => Object.values(NETS).find((n) => n.chainId === chainId)?.key || null;

if (window.ethereum) {
  window.ethereum.request({ method: 'eth_accounts' }).then(async (a) => {
    wallet.account = a[0] ? ethers.getAddress(a[0]) : null;
    wallet.chainId = Number(await window.ethereum.request({ method: 'eth_chainId' }));
    emit();
  }).catch(() => {});
  window.ethereum.on?.('accountsChanged', (a) => { wallet.account = a[0] ? ethers.getAddress(a[0]) : null; emit(); });
  window.ethereum.on?.('chainChanged', (c) => { wallet.chainId = Number(c); emit(); });
}

/** Connect MetaMask and switch to `key` (adds the network if MetaMask doesn't know it). */
export async function connect(key = 'mainnet') {
  if (!window.ethereum) throw Object.assign(new Error('MetaMask is not installed'), { code: 'NO_WALLET' });
  const a = await window.ethereum.request({ method: 'eth_requestAccounts' });
  wallet.account = ethers.getAddress(a[0]);
  await ensureNetwork(key);
  emit();
  return wallet.account;
}

export async function ensureNetwork(key) {
  const n = net(key);
  const chainId = '0x' + n.chainId.toString(16);
  const current = Number(await window.ethereum.request({ method: 'eth_chainId' }));
  if (current === n.chainId) { wallet.chainId = current; return; }
  try {
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
  } catch (e) {
    const unknown = e.code === 4902 || e?.data?.originalError?.code === 4902 || /unrecognized chain|not been added/i.test(e.message || '');
    if (!unknown) throw e;
    await window.ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [{ chainId, chainName: n.name, nativeCurrency: { name: 'BOT', symbol: 'BOT', decimals: 18 }, rpcUrls: [n.rpc], blockExplorerUrls: [n.explorer] }],
    });
  }
  wallet.chainId = n.chainId;
  emit();
}

export async function getSigner(key) {
  if (!wallet.account) await connect(key);
  await ensureNetwork(key);
  return new ethers.BrowserProvider(window.ethereum).getSigner();
}

// ─── reads ───────────────────────────────────────────────────────────────────

export async function loadToken(key, address, account) {
  const t = new ethers.Contract(address, ERC20_ABI, reader(key));
  const code = await reader(key).getCode(address);
  if (code === '0x') throw new Error('No contract at this address on ' + net(key).name);
  const [name, symbol, decimals] = await Promise.all([
    t.name().catch(() => 'Unknown token'),
    t.symbol().catch(() => '???'),
    t.decimals().then(Number).catch(() => { throw new Error('This contract has no decimals() — not an ERC-20 token'); }),
  ]);
  if (decimals > 18) throw new Error(`Tokens with ${decimals} decimals are not supported (max 18)`);
  const balance = account ? await t.balanceOf(account) : null;
  return { type: 'token', address: ethers.getAddress(address), name, symbol, decimals, balance };
}

export const nativeAsset = () => ({ type: 'native', address: ethers.ZeroAddress, name: 'BOT', symbol: 'BOT', decimals: 18, balance: null });

export async function balanceOf(key, asset, account) {
  if (!account) return null;
  if (asset.type === 'native') return reader(key).getBalance(account);
  return new ethers.Contract(asset.address, ERC20_ABI, reader(key)).balanceOf(account);
}

export async function allowance(key, token, owner) {
  return new ethers.Contract(token, ERC20_ABI, reader(key)).allowance(owner, contractAddress(key));
}

/** Which of `addresses` are contracts (have code). Returns a Set of lowercase addresses. */
export async function findContracts(key, addresses, onProgress) {
  const out = new Set();
  const p = reader(key);
  let done = 0;
  for (let i = 0; i < addresses.length; i += 50) {
    const slice = addresses.slice(i, i + 50);
    const codes = await Promise.all(slice.map((a) => p.getCode(a).catch(() => '0x')));
    codes.forEach((c, j) => { if (c && c !== '0x') out.add(slice[j].toLowerCase()); });
    done += slice.length;
    onProgress?.(done, addresses.length);
  }
  return out;
}

export async function stats(key) {
  const c = multisend(key);
  if (!c) return null;
  const [batches, recipients, nativeSent] = await c.stats();
  return { batches, recipients, nativeSent };
}

/** One batch: event + tx + decoded recipients. */
export async function loadBatch(key, id) {
  const c = multisend(key);
  if (!c) throw new Error('Multisend is not deployed on ' + net(key).name + ' yet');
  const count = await c.batches();
  if (BigInt(id) >= count) throw new Error(`Batch #${id} does not exist on ${net(key).name}`);
  const block = Number(await c.batchBlock(id));
  const logs = await reader(key).getLogs({
    address: c.target,
    fromBlock: block,
    toBlock: block,
    topics: [iface.getEvent('BatchSent').topicHash, ethers.toBeHex(BigInt(id), 32)],
  });
  if (!logs.length) throw new Error(`Could not find the log for batch #${id}`);
  const log = logs[0];
  const ev = iface.parseLog(log).args;
  const [tx, blk] = await Promise.all([reader(key).getTransaction(log.transactionHash), reader(key).getBlock(block)]);
  let recipients = null;
  try {
    const d = iface.parseTransaction({ data: tx.data, value: tx.value });
    const [to, amounts] = d.name === 'sendNative' ? [d.args[0], d.args[1]] : [d.args[1], d.args[2]];
    recipients = to.map((a, i) => ({ address: a, amount: amounts[i] }));
  } catch { /* sent through another contract — summary only */ }
  return {
    id: Number(id), net: key, sender: ev.sender, token: ev.token, total: ev.total, count: Number(ev.count), name: ev.name,
    txHash: log.transactionHash, block, time: blk ? blk.timestamp * 1000 : null, recipients,
  };
}

export async function assetMeta(key, token) {
  if (token === ethers.ZeroAddress) return nativeAsset();
  const t = new ethers.Contract(token, ERC20_ABI, reader(key));
  const [symbol, decimals, name] = await Promise.all([t.symbol().catch(() => 'TOKEN'), t.decimals().then(Number).catch(() => 18), t.name().catch(() => '')]);
  return { type: 'token', address: token, symbol, decimals, name };
}

// ─── errors ──────────────────────────────────────────────────────────────────

export function isRejected(e) {
  return e?.code === 4001 || e?.code === 'ACTION_REJECTED' || e?.info?.error?.code === 4001;
}

/** Decodes a Multisend custom error if there is one: { name, args } or null. */
export function decodeRevert(e) {
  const data = e?.data || e?.info?.error?.data?.data || e?.info?.error?.data || e?.error?.data;
  if (typeof data !== 'string' || data.length < 10) return null;
  try { return iface.parseError(data); } catch { return null; }
}

export function friendly(e) {
  if (isRejected(e)) return 'You rejected the request in MetaMask.';
  const r = decodeRevert(e);
  if (r) {
    const map = {
      ValueMismatch: 'The BOT sent did not match the batch total.',
      NativeSendFailed: `Recipient ${r.args?.[1]} refused the BOT (row ${Number(r.args?.[0]) + 1} of this batch).`,
      TokenTransferFailed: `The token transfer to ${r.args?.[1]} failed — check your balance and approval.`,
      TooManyRecipients: 'Too many recipients in one transaction (max 300).',
      ZeroRecipient: 'A recipient is the zero address.',
      NameTooLong: 'Batch name is too long (64 bytes max).',
      NotAToken: 'That address is not a token contract.',
    };
    return map[r.name] || r.name;
  }
  const m = e?.shortMessage || e?.reason || e?.info?.error?.message || e?.message || String(e);
  if (/insufficient funds/i.test(m)) return 'Not enough BOT for this amount plus gas.';
  return m.replace(/\s*\(action=.*$/, '');
}
