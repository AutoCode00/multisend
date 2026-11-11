# BOT Multisend 📮

**Pay everyone in one click.** Send BOT or any token to hundreds of wallets from a CSV, with checks before you send and a receipt page after.

*No fees (gas only). No accounts. The contract never holds your funds.*

## Status

| | |
|---|---|
| Live site | _not published yet_ (GitHub Pages + custom domain) |
| Multisend (BOT Chain mainnet, chain ID 677) | [`0x3d8Bc6E6da03149a8a749EA66D5b86d5706f015F`](https://scan.botchain.ai/address/0x3d8Bc6E6da03149a8a749EA66D5b86d5706f015F) |
| Multisend (testnet, chain ID 968) | _not deployed yet_ — `TESTNET_CONTRACT_ADDRESS` in `assets/config.js` |

Until an address is set, the app still lets you build and check a list (sending is switched off with a note). After you deploy with `deploy.html`, this browser remembers the address automatically, so you can test before editing `config.js`.

## What's inside

| Route | What it is |
|---|---|
| `/` | Website (Tempo-style, light: off-white page, white cards, black buttons, grey line art): hero with line arcs, BOT Chain project ticker and the concentric-rings panel · Built for every payout · Powerful little primitives · use-case slider (1 of 4, arrow keys) · live numbers from the contract + phone receipt · Safe by default · FAQ · two-way CTA (with ABI + example call) · receipt footer |
| `/app` | **Asset** (BOT or token address → name, symbol, decimals, balance; Mainnet / Testnet switch) · **Recipients** (CSV drag & drop with column mapper, paste list, same amount; template download) · **Check** (✅ ❌ ⚠️ ℹ️ per row, filters, duplicates merge / keep first / remove, **Fix all**, Pip frowns at bad rows) · **Preview** (recipients, total, balance, transactions, gas, batch name, shortfall) · **Send** (exact approve → batch 1 of N → …, pending/confirmed + explorer links, Pip's flock animation) · **History** (your batches from the contract + unfinished sends) |
| `/r/:id` | Public receipt — `/r/12` or `/r/12,13` for a multi-transaction send; add `?net=testnet` for testnet. Name, sender, asset, total, every recipient with ✓, tx links, **Download CSV**, **Copy link**, “Were you paid?” lookup. Shows partial progress + **Continue sending** if some batches are still to go |

```
index.html · 404.html (GitHub Pages SPA redirect) · deploy.html (one-click deploy from MetaMask)
assets/
  config.js    ← contract addresses + links (the one place to edit)
  lists.js     parsing, validation, duplicates, Fix all, batching, CSV out (pure, tested)
  chain.js     networks, MetaMask connect/switch/add, contract + token reads, receipts, friendly errors
  app.js       the 5-step send flow, gas planning, preflight, send sessions, history
  receipt.js   /r/:id page
  home.js      website sections + GSAP animations · footer.js receipt footer · pip.js Pip 📮
  main.js      router + navbar · ui.js helpers · styles.css
contracts/Multisend.sol      contracts/test/Mocks.sol (test-only)
build/                       ABI + bytecode + standard JSON input (for explorer verification)
tools/                       compile, tests, dev server, local-chain helper
```

## How sending works

1. **Parse** — PapaParse for CSV (header optional, delimiter auto-detected); trims, checks `0x` + 40 hex, flags mixed-case addresses with a wrong checksum as likely typos; amounts parsed as BigInt with the token's decimals (max 18; `1,000.50`, `2,5`, `.5` all work).
2. **Check** — invalid address, bad amount, zero amount, duplicate, your own address, contract address (looked up with `eth_getCode`, info only). Invalid rows block sending; warnings don't.
3. **Plan** — batches of 200 (contract max 300). Each batch is simulated with `estimateGas`; if it needs more than 80% of the block gas limit (35M on BOT Chain) it's halved. If a simulation reverts, the batch is binary-searched to find the exact row that breaks it, which is highlighted in **Check** with the reason.
4. **Send** — tokens: one `approve` for **exactly** the remaining total (never unlimited). Every batch shows a confirm dialog (total + recipient count), is simulated again right before signing, and is saved in this browser as it goes, so a rejected or interrupted send resumes with **Continue sending** and never resends confirmed batches.
5. **Receipt** — the `BatchSent` event (found in one call via `batchBlock(id)`) + the transaction's calldata decoded back into every recipient and amount.

## Contract

`contracts/Multisend.sol` — Solidity ^0.8.20, optimizer 200, EVM `paris`, runtime ≈ 3 KB.

- `sendNative(address[] to, uint256[] amounts, string name) payable` — `msg.value` must equal the sum; sends with `call`; any failure reverts the whole batch.
- `sendToken(address token, address[] to, uint256[] amounts, string name)` — `transferFrom(msg.sender, to[i], amounts[i])` with SafeERC20-style checks (works with tokens that return nothing).
- `event BatchSent(uint256 indexed id, address indexed sender, address indexed token, uint256 total, uint256 count, string name)` — `token = address(0)` for BOT.
- Views: `batches`, `stats()` (batches, recipients, BOT sent — used by the homepage and footer), `batchBlock(id)`, `batchesOf(sender)`.
- Limits: 1–300 recipients, no zero address, name ≤ 64 bytes. Reentrancy guard. No fees, no owner, nothing stored but counters.

Gas on BOT Chain: about 36k per recipient that has never held BOT (≈ 7.2M for 200), much less for existing wallets.

## Deploy the contract

1. `node tools/serve.mjs` and open http://localhost:4626/deploy.html
2. **Deploy to Testnet (968)** — get test BOT from https://faucet.bohr.life — then open `/app?net=testnet` and send a small batch.
3. **Deploy to Mainnet (677)**.
4. Paste both addresses into `assets/config.js` and the Status table above.
5. Verify on scan.botchain.ai with `build/Multisend.standard-input.json` (compiler `0.8.20`, optimizer 200 runs, EVM `paris`).

Remix works too: paste `contracts/Multisend.sol`, compiler 0.8.20, optimizer on (200), EVM `paris`, deploy with MetaMask on BOT Chain.

## Publish (GitHub Pages)

Push this folder to a GitHub repo → Settings → Pages → deploy from the default branch, root. For a custom domain add a `CNAME` file containing the domain and point a DNS `CNAME` record at `<user>.github.io`. `404.html` sends deep links (`/app`, `/r/12`) back to the single page; it also works on a `github.io/<repo>/` project page.

## Run locally

```bash
node tools/serve.mjs
```

Open http://localhost:4626.

## Tests

```bash
npm --prefix tools install
```

```bash
node tools/compile.mjs --mocks && node tools/test-contract.mjs && node tools/test-lists.mjs
```

`test-contract.mjs` (14 checks) runs the contract on an in-memory chain: exact `msg.value`, 300-recipient batch, one failed recipient reverts everything, re-entrancy blocked, exact-approval token sends, USDT-style tokens, `false`-returning tokens, counters, calldata decoding. `test-lists.mjs` (14 checks) covers parsing, every row status, Fix all, duplicate modes, amount formats and batching.

To click through the whole app against a local chain, start `tools/node_modules/.bin/ganache --chain.chainId 968 --server.port 8545` and run `node tools/dev-chain-setup.mjs` — it deploys Multisend, a 6-decimal mock token and a contract that refuses BOT, and prints their addresses.
