// The one place to set contract addresses and links.
// MAINNET_CONTRACT_ADDRESS is shown in the footer ("View on explorer") and the README.
export const MAINNET_CONTRACT_ADDRESS = '0x3d8Bc6E6da03149a8a749EA66D5b86d5706f015F'; // ← paste the Multisend address on BOT Chain mainnet (677)
export const TESTNET_CONTRACT_ADDRESS = ''; // ← paste the Multisend address on BOT Chain testnet (968)

export const CONFIG = {
  networks: {
    mainnet: {
      key: 'mainnet',
      chainId: 677,
      name: 'BOT Chain',
      rpc: 'https://rpc.botchain.ai',
      explorer: 'https://scan.botchain.ai',
      multisend: MAINNET_CONTRACT_ADDRESS,
    },
    testnet: {
      key: 'testnet',
      chainId: 968,
      name: 'BOT Chain Testnet',
      rpc: 'https://rpc.bohr.life',
      explorer: 'https://scan.bohr.life',
      multisend: TESTNET_CONTRACT_ADDRESS,
    },
  },
  batchSize: 200, // recipients per transaction to start with
  maxPerTx: 300, // contract limit
  gasShare: 0.8, // shrink a batch if it needs more than this share of the block gas limit
  links: {
    botchain: 'https://botchain.ai',
    docs: 'https://docs.botchain.ai',
    faucet: 'https://faucet.bohr.life',
    x: 'https://x.com/BOTChain_ai',
    telegram: 'https://t.me/botchain_ai',
  },
};
