// Dev helper: deploys Multisend + a 6-decimal mock token to a local chain (default http://127.0.0.1:8545)
// and mints tokens to the first account. Prints the addresses as JSON.
// Usage: npx ganache --chain.chainId 968 --server.port 8545 &  then  node tools/dev-chain-setup.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ethers from 'ethers';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const art = JSON.parse(readFileSync(join(root, 'build/Multisend.json'), 'utf8'));
const mocks = JSON.parse(readFileSync(join(root, 'build/mocks.json'), 'utf8'));
const provider = new ethers.JsonRpcProvider(process.argv[2] || 'http://127.0.0.1:8545');
const signer = await provider.getSigner(0);
const deploy = async (a) => (await new ethers.ContractFactory(a.abi, a.bytecode, signer).deploy()).waitForDeployment();
const ms = await deploy(art);
const tok = await deploy(mocks.MockToken);
await (await tok.mint(signer.address, 1_000_000n * 10n ** 6n)).wait();
const rej = await deploy(mocks.Rejecter);
console.log(JSON.stringify({ account: signer.address, multisend: await ms.getAddress(), token: await tok.getAddress(), rejecter: await rej.getAddress() }));
