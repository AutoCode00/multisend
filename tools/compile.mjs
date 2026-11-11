// Compiles contracts/Multisend.sol → build/ (ABI, bytecode, standard JSON input for explorer verification).
// Usage (from the project root): node tools/compile.mjs        add --mocks to also build the test contracts.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const settings = {
  optimizer: { enabled: true, runs: 200 },
  evmVersion: 'paris',
  outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
};

function compile(path) {
  const input = { language: 'Solidity', sources: { [path]: { content: readFileSync(join(root, path), 'utf8') } }, settings };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  for (const e of output.errors || []) console.error(e.formattedMessage);
  if ((output.errors || []).some((e) => e.severity === 'error')) process.exit(1);
  return { input, contracts: output.contracts[path] };
}

mkdirSync(join(root, 'build'), { recursive: true });
const { input, contracts } = compile('contracts/Multisend.sol');
const c = contracts.Multisend;
const runtime = c.evm.deployedBytecode.object.length / 2;
writeFileSync(join(root, 'build/Multisend.standard-input.json'), JSON.stringify(input, null, 2) + '\n');
writeFileSync(join(root, 'build/Multisend.json'), JSON.stringify({ compiler: solc.version(), abi: c.abi, bytecode: '0x' + c.evm.bytecode.object }, null, 2) + '\n');
console.log(`Multisend: compiled with ${solc.version()} — runtime ${runtime} bytes (limit 24576)`);
if (runtime > 24576) process.exit(1);

if (process.argv.includes('--mocks')) {
  const mocks = compile('contracts/test/Mocks.sol').contracts;
  const out = Object.fromEntries(Object.entries(mocks).map(([k, v]) => [k, { abi: v.abi, bytecode: '0x' + v.evm.bytecode.object }]));
  writeFileSync(join(root, 'build/mocks.json'), JSON.stringify(out) + '\n');
  console.log(`Mocks: ${Object.keys(out).join(', ')}`);
}
