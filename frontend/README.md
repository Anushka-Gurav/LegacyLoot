# Legacy Loot — frontend starter

This is the first-stage frontend for the Legacy Loot Monad Blitz project.

## Free local setup

1. Install Node.js LTS from https://nodejs.org/
2. Open this folder in VS Code.
3. In the VS Code terminal run:

```bash
npm install
npm run dev
```

4. Open the local URL Vite prints, usually http://localhost:5173.

## Current stage

- Playable frontend demo: claim a Phoenix Blade reward.
- Artifact inventory and detail panel.
- Browser-side metadata fingerprint demonstration.
- Simulated local transfer.
- Optional MetaMask connection if the extension is installed.

**Important:** At this stage, the minting, transfer and fingerprint reference are demo-only. No blockchain transaction is sent yet. The next stage is to create and deploy the Solidity contract through Remix to Monad Testnet, then connect this frontend to the deployed contract.

## Safety

- Never paste a wallet recovery phrase into this project or any website.
- Do not put a wallet private key in frontend code.
- Use a separate wallet and testnet funds for the hackathon.
- Testnet tokens have no real-world value.
