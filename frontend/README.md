# Legacy Loot — Monad Testnet PvP prototype

## Setup (Windows PowerShell)
1. Install Node.js LTS.
2. Open this project folder in PowerShell.
3. Run `npm.cmd install`.
4. Copy `.env.example` to `.env` and enter your Firebase web app settings.
5. In Firebase Console, enable **Authentication → Anonymous** and Realtime Database. Use rules appropriate for a prototype; never leave public read/write rules on a production database.
6. Run `npm.cmd run dev` and open the URL Vite prints.

## PvP moves
- Attack: 20 damage.
- Defend: halves the next incoming hit.
- Heal: restores up to 15 HP, two uses per duel.
- Special: 30 damage, one use per duel.

Moves, health and battle log synchronize through Firebase Realtime Database. This is a hackathon prototype: client-side Firebase transactions are not a secure competitive game server. Before offering valuable rewards, move combat resolution and winner validation to trusted backend code/Cloud Functions and restrict database rules.

## Artifact collection
The UI can remember token IDs minted from this browser for each connected wallet and checks `ownerOf` against the deployed Monad Testnet contract on reconnect. This is a local index, not a complete wallet-wide NFT discovery service: clearing browser storage or connecting on another device may hide tokens from the UI even though they remain on-chain. The explorer link and contract remain the independent source of truth. A future version should index `ArtifactMinted` events or use a supported NFT indexer to discover all tokens for a wallet.

The reward-claim flow requires the separate reward backend configured with `VITE_REWARD_API_URL`. Do not place backend private keys, Firebase Admin credentials, or other server secrets in this frontend project or in any `VITE_` variable.

## Network
Monad Testnet chain ID: `10143`.
