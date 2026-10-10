import React, { useCallback, useState } from 'react';
import { auth } from './firebase';
import PvpArena from './PvpArena';
import { BrowserProvider, Contract, keccak256, toUtf8Bytes, isAddress } from 'ethers';

import { ShieldCheck, Swords, Sparkles, Wallet, ArrowLeftRight, Fingerprint, ExternalLink, Trophy, LockKeyhole, CheckCircle2, CircleAlert, Copy, Gamepad2, Gem, Zap } from 'lucide-react';



const initialArtifacts = [

  { id: 'LL-001', name: 'Phoenix Blade', rarity: 'Legendary', attack: 95, icon: '⚔️', color: 'gold', owner: 'You', description: 'Forged in the last flame of the Phoenix King.', metadata: { id: 'LL-001', name: 'Phoenix Blade', rarity: 'Legendary', attack: 95, image: 'phoenix-blade' }, earned: true },

  { id: 'LL-002', name: 'Moon Crystal', rarity: 'Rare', attack: 42, icon: '🔮', color: 'blue', owner: 'Ancient Vault', description: 'A fragment that glows under moonlight.', metadata: { id: 'LL-002', name: 'Moon Crystal', rarity: 'Rare', attack: 42, image: 'moon-crystal' }, earned: false },

  { id: 'LL-003', name: 'Mossguard Shield', rarity: 'Common', attack: 18, icon: '🛡️', color: 'green', owner: 'Ancient Vault', description: 'A sturdy shield reclaimed by the forest.', metadata: { id: 'LL-003', name: 'Mossguard Shield', rarity: 'Common', attack: 18, image: 'mossguard-shield' }, earned: false }

];



function fingerprint(value) {
  // Keep this exact serialization consistent with the mint and verify operations.
  return keccak256(toUtf8Bytes(JSON.stringify(value)));
}

const CONTRACT_ADDRESS = "0x2C08E4c20d5867A04cB2A18B6568aB0fF74ec051";
const MONAD_CHAIN_ID = 10143;
const CONTRACT_ABI = [
  'function claimArtifact(string uri, bytes32 fingerprint, bytes32 rewardId, bytes signature) returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function metadataHash(uint256 tokenId) view returns (bytes32)',
  'function verifyFingerprint(uint256 tokenId, bytes32 fingerprint) view returns (bool)',
  'function transferFrom(address from, address to, uint256 tokenId)',
  'event ArtifactMinted(uint256 indexed tokenId, address indexed player, bytes32 fingerprint)',
];



export default function App() {

  const [artifacts, setArtifacts] = useState(initialArtifacts);

  const [selected, setSelected] = useState('LL-001');

  const [battleWon, setBattleWon] = useState(false);

  const [notice, setNotice] = useState('Demo mode: the UI is running locally. Blockchain actions are not connected yet.');

  const [wallet, setWallet] = useState('');
  const [contract, setContract] = useState(null);
  const [mintedTokens, setMintedTokens] = useState({});
  const [rewardRoomCode, setRewardRoomCode] = useState('');

  const [hashStatus, setHashStatus] = useState('');

  const [tampered, setTampered] = useState(false);

  const [tab, setTab] = useState('inventory');

  const [recipient, setRecipient] = useState('');



  const current = artifacts.find(a => a.id === selected) || artifacts[0];

  const owned = artifacts.filter(a => a.earned);



  async function connectWallet() {
    if (!window.ethereum) {
      setNotice('MetaMask was not detected. Install or enable the extension, then refresh this page.');
      return;
    }

    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const provider = new BrowserProvider(window.ethereum);
      const network = await provider.getNetwork();

      if (Number(network.chainId) !== MONAD_CHAIN_ID) {
        setContract(null);
        setWallet(accounts[0] || '');
        setNotice('Wrong network. Switch MetaMask to Monad Testnet (chain ID 10143), then click Connect wallet again.');
        return;
      }

      const signer = await provider.getSigner();
      const connectedContract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      setWallet(accounts[0]);
      setContract(connectedContract);
      setNotice('Wallet connected to Legacy Loot on Monad Testnet.');
    } catch (error) {
      console.error(error);
      setNotice(error.shortMessage || error.message || 'Wallet connection was cancelled or failed.');
    }
  }

  const handleRewardReady = useCallback((code) => {
    setRewardRoomCode(code);
    setArtifacts(prev => prev.map(a => a.id === 'LL-001' ? { ...a, earned: true, owner: wallet || 'Winner' } : a));
    setSelected('LL-001');
    setNotice(`Duel winner verified for room ${code}. You can claim your artifact on Monad.`);
  }, [wallet]);

  async function mintArtifactOnChain() {
    if (!wallet || !contract) {
      setNotice('Connect MetaMask on Monad Testnet first.');
      return;
    }
    if (!current.earned) {
      setNotice('Earn this artifact before minting it.');
      return;
    }
    if (!rewardRoomCode) {
      setNotice('Win a live PvP duel first. A verified winner room is required to claim an NFT.');
      return;
    }
    if (mintedTokens[current.id]) {
      setNotice(`${current.name} is already minted in this browser session as token #${mintedTokens[current.id]}.`);
      return;
    }

    try {
      const metadataJSON = JSON.stringify(current.metadata);
      const hash = fingerprint(current.metadata);
      const uri = 'data:application/json;base64,' + btoa(unescape(encodeURIComponent(metadataJSON)));
      const firebaseUser = auth?.currentUser;
      if (!firebaseUser) throw new Error('Firebase session missing. Refresh, reconnect, and join the duel again.');
      setNotice('Verifying your duel reward with the reward service...');
      const idToken = await firebaseUser.getIdToken(true);
      const apiBase = (import.meta.env.VITE_REWARD_API_URL || 'http://localhost:8787').replace(/\/$/, '');
      const claimResponse = await fetch(`${apiBase}/api/reward-claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ roomCode: rewardRoomCode, wallet, uri, fingerprint: hash })
      });
      const voucher = await claimResponse.json();
      if (!claimResponse.ok) throw new Error(voucher.error || 'Reward service rejected this claim.');
      setNotice('Reward authorized. Confirm the claim transaction in MetaMask...');
      const tx = await contract.claimArtifact(uri, hash, voucher.rewardId, voucher.signature);
      setNotice('Mint transaction submitted. Waiting for confirmation...');
      const receipt = await tx.wait();
      let tokenId = '';

      for (const log of receipt.logs) {
        try {
          const parsed = contract.interface.parseLog(log);
          if (parsed && parsed.name === 'ArtifactMinted') {
            tokenId = parsed.args.tokenId.toString();
            break;
          }
        } catch { /* Ignore logs that are not from this contract. */ }
      }

      if (!tokenId) {
        setNotice(`Mint transaction confirmed (${tx.hash}), but the token ID was not found in its event.`);
        return;
      }

      setMintedTokens(prev => ({ ...prev, [current.id]: tokenId }));
      setArtifacts(prev => prev.map(a => a.id === current.id ? { ...a, owner: wallet } : a));
      setNotice(`${current.name} minted on Monad Testnet as token #${tokenId}.`);
    } catch (error) {
      console.error(error);
      setNotice(error.shortMessage || error.reason || error.message || 'Mint failed. Check MetaMask and the transaction details.');
    }
  }

  function winBoss() {

    setBattleWon(true);

    setArtifacts(prev => prev.map(a => a.id === 'LL-001' ? { ...a, earned: true, owner: wallet || 'Your wallet (demo)' } : a));

    setSelected('LL-001');

    setNotice('Victory! Phoenix Blade unlocked. Next, we will mint it through the Monad smart contract.');

    setTab('inventory');

  }



  async function verifyMetadata() {
    try {
      const official = current.metadata;
      const checked = tampered && current.id === 'LL-001' ? { ...official, attack: 999 } : official;
      const checkedHash = fingerprint(checked);
      const tokenId = mintedTokens[current.id];

      if (contract && tokenId) {
        const match = await contract.verifyFingerprint(tokenId, checkedHash);
        setHashStatus(match ? 'MATCH' : 'MISMATCH');
        setNotice(match
          ? `On-chain fingerprint verified for token #${tokenId}.`
          : `Fingerprint mismatch for token #${tokenId}; the checked metadata differs from the committed hash.`);
        return;
      }

      const match = fingerprint(official) === checkedHash;
      setHashStatus(match ? 'MATCH' : 'MISMATCH');
      setNotice(match
        ? 'Local metadata matches. Mint this artifact to verify against its on-chain fingerprint.'
        : 'Tampering detected in the local metadata preview.');
    } catch (error) {
      console.error(error);
      setNotice(error.shortMessage || error.message || 'Fingerprint verification failed.');
    }
  }

  async function transferDemo() {
    if (!recipient.trim()) {
      setNotice('Enter the recipient wallet address first.');
      return;
    }
    if (!isAddress(recipient.trim())) {
      setNotice('Please enter a valid 0x wallet address.');
      return;
    }
    const tokenId = mintedTokens[current.id];
    if (!contract || !wallet || !tokenId) {
      setNotice('Connect your wallet and mint this artifact on-chain before transferring it.');
      return;
    }

    try {
      const owner = await contract.ownerOf(tokenId);
      if (owner.toLowerCase() !== wallet.toLowerCase()) {
        setNotice('The connected wallet is not the current on-chain owner of this artifact.');
        return;
      }
      setNotice('Please confirm the transfer in MetaMask...');
      const tx = await contract.transferFrom(wallet, recipient.trim(), tokenId);
      setNotice('Transfer submitted. Waiting for confirmation...');
      await tx.wait();
      setArtifacts(prev => prev.map(a => a.id === current.id ? { ...a, owner: `${recipient.trim().slice(0, 6)}…${recipient.trim().slice(-4)}` } : a));
      setNotice(`Token #${tokenId} transferred successfully on Monad Testnet.`);
      setRecipient('');
    } catch (error) {
      console.error(error);
      setNotice(error.shortMessage || error.reason || error.message || 'Transfer failed.');
    }
  }

  async function copyAddress() {

    if (!wallet) return;

    try { await navigator.clipboard.writeText(wallet); setNotice('Wallet address copied.'); }

    catch { setNotice(wallet); }

  }



  const statusClass = hashStatus === 'MATCH' ? 'success' : hashStatus === 'MISMATCH' ? 'danger' : '';

  return (

    <div className="app-shell">

      <header className="topbar">

        <a className="brand" href="#" onClick={e => e.preventDefault()}>

          <span className="brand-mark"><Gem size={22} /></span>

          <span>LEGACY <b>LOOT</b><small>PLAYER-OWNED ARTIFACTS</small></span>

        </a>

        <div className="top-actions">

          <span className="network-pill"><span className="pulse" /> MONAD TESTNET</span>

          <button className="wallet-btn" onClick={connectWallet}><Wallet size={16} /> {wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : 'Connect wallet'}</button>

        </div>

      </header>



      <main>

        <section className="hero">

          <div className="hero-copy">

            <div className="eyebrow"><Sparkles size={14} /> YOUR LEGACY. YOUR LOOT.</div>

            <h1>Earn legends.<br /><span>Own your story.</span></h1>

            <p>A tiny fantasy adventure where your rare artifacts are designed to be independently verifiable—not trapped in one game database.</p>

            <div className="hero-actions">

              <button className="primary-btn" onClick={() => document.getElementById('adventure')?.scrollIntoView({ behavior: 'smooth' })}><Swords size={17} /> Enter the dungeon</button>

              <div className="hero-stat"><ShieldCheck size={17} /><span>Built for verifiable ownership</span></div>

            </div>

          </div>

          <div className="hero-art" aria-label="Fantasy phoenix sword illustration">

            <div className="orbit orbit-one" /><div className="orbit orbit-two" />

            <div className="rune rune-one">✦</div><div className="rune rune-two">ᛟ</div>

            <div className="sword-glow" />

            <div className="sword-emoji">⚔</div>

            <div className="hero-art-label"><span className="legend-dot" /> LEGENDARY RELIC <b>LL-001</b></div>

          </div>

        </section>



        <div className="notice"><CircleAlert size={17} /><span>{notice}</span></div>



        <section className="stats-row">

          <div className="stat-card"><span>YOUR COLLECTION</span><strong>{owned.length.toString().padStart(2, '0')} <small>/ 03</small></strong><em>Artifacts earned</em></div>

          <div className="stat-card"><span>RAREST FIND</span><strong>LEGENDARY</strong><em>Phoenix Blade</em></div>

          <div className="stat-card"><span>OWNERSHIP STATUS</span><strong className="status-text">{wallet ? 'WALLET READY' : 'DEMO MODE'}</strong><em>{wallet ? 'Wallet connected' : 'Connect wallet to begin'}</em></div>

        </section>



        <section className="adventure-section" id="adventure">

          <div className="section-heading"><div><div className="eyebrow">THE FORGOTTEN RUINS</div><h2>Choose your fate</h2></div><span className="chapter-tag">CHAPTER 01 / 03</span></div>

          <div className="dungeon-card">

            <div className="dungeon-visual"><div className="moon" /><div className="mountain m1" /><div className="mountain m2" /><div className="dungeon-gate">⌘</div><div className="ground-glow" /></div>

            <div className="dungeon-info">

              <div className="boss-tag"><Zap size={13} /> BOSS ENCOUNTER</div>

              <h3>The Phoenix Keeper</h3>

              <p>Defeat the ancient guardian to claim the relic sealed inside the ruins.</p>

              <div className="boss-stats"><span><b>LVL 12</b> Guardian</span><span><b>REWARD</b> Legendary</span><span><b>DIFFICULTY</b> Moderate</span></div>

              <button className="primary-btn full-btn" onClick={winBoss} disabled={battleWon}><Swords size={17} /> {battleWon ? 'Boss defeated · Reward claimed' : 'Fight the Phoenix Keeper'}</button>

              {battleWon && <div className="victory"><Trophy size={16} /> Victory! Phoenix Blade added to your collection.</div>}

            </div>

          </div>

        </section>



        <section className="collection-section">

          <div className="section-heading"><div><div className="eyebrow">YOUR RELICS</div><h2>Artifact inventory</h2></div><span className="chapter-tag">{owned.length} OWNED</span></div>

          <div className="inventory-layout">

            <div className="artifact-grid">

              {artifacts.map(a => (

                <button key={a.id} className={`artifact-card ${selected === a.id ? 'selected' : ''} ${a.color}`} onClick={() => { setSelected(a.id); setHashStatus(''); setTampered(false); }}>

                  <div className="artifact-image"><span>{a.icon}</span>{a.earned ? <span className="owned-badge">OWNED</span> : <span className="locked-badge"><LockKeyhole size={12} /> LOCKED</span>}</div>

                  <div className="artifact-content"><span className="rarity">{a.rarity}</span><h3>{a.name}</h3><p>{a.description}</p><div className="artifact-meta"><span>ATK <b>{a.attack}</b></span><span>{a.id}</span></div></div>

                </button>

              ))}

            </div>



            <aside className="detail-panel">

              <div className="detail-top"><span className="eyebrow">ARTIFACT DETAILS</span><span className={`rarity-pill ${current.color}`}>{current.rarity}</span></div>

              <div className={`detail-icon ${current.color}`}>{current.icon}</div>

              <h3>{current.name}</h3><p className="detail-desc">{current.description}</p>

              <div className="detail-row"><span>Artifact ID</span><b>{current.id}</b></div>

              <div className="detail-row"><span>Attack power</span><b>{current.attack}</b></div>

              <div className="detail-row"><span>Current owner</span><b className="owner-value">{current.earned ? current.owner : 'Not minted'}</b></div>

              <div className="detail-row"><span>Blockchain</span><b>{mintedTokens[current.id] ? `Monad · Token #${mintedTokens[current.id]}` : contract ? 'Monad Testnet · connected' : 'Monad Testnet · not connected'}</b></div>

              <div className="detail-actions">
                <button className="primary-btn full-btn" onClick={mintArtifactOnChain} disabled={!current.earned || Boolean(mintedTokens[current.id])}>
                  <Gem size={15} /> {mintedTokens[current.id] ? `Minted · Token #${mintedTokens[current.id]}` : 'Mint artifact on Monad'}
                </button>

                <button className="outline-btn" onClick={verifyMetadata}><Fingerprint size={15} /> Verify fingerprint</button>

                <button className="outline-btn" onClick={() => { setTampered(v => !v); setHashStatus(''); setNotice(!tampered ? 'Demo tampering enabled. Verify metadata to see the mismatch.' : 'Demo tampering disabled. Verify again to check the canonical data.'); }}><CircleAlert size={15} /> {tampered ? 'Reset test data' : 'Simulate tampering'}</button>

              </div>

              {hashStatus && <div className={`hash-result ${statusClass}`}><span>{hashStatus === 'MATCH' ? <CheckCircle2 size={16} /> : <CircleAlert size={16} />}</span><div><b>{hashStatus === 'MATCH' ? 'Metadata matches' : 'Metadata mismatch detected'}</b><small>{hashStatus === 'MATCH' ? 'Fingerprint is consistent.' : 'The tested metadata differs from the original.'}</small></div></div>}

              <div className="transfer-box"><label htmlFor="recipient">ON-CHAIN TRANSFER</label><div className="transfer-input"><input id="recipient" value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="Recipient wallet 0x…" /><button title="Show local demo transfer" onClick={transferDemo}><ArrowLeftRight size={16} /></button></div><small>Requires a minted token and its current owner wallet.</small></div>

            </aside>

          </div>

        </section>



        <PvpArena wallet={wallet} onRewardReady={handleRewardReady} />

        <section className="how-section">

          <div className="section-heading"><div><div className="eyebrow">THE TECHNOLOGY</div><h2>What makes loot last?</h2></div></div>

          <div className="how-grid">

            <div className="how-card"><span className="how-icon purple"><LockKeyhole /></span><h3>Smart contract</h3><p>Enforces ERC-721 ownership and valid transfers. NFT claims require a single-use signed reward voucher from the trusted reward service.</p><span className="tech-label">SOLIDITY · ERC-721</span></div>

            <div className="how-card"><span className="how-icon blue"><Fingerprint /></span><h3>Metadata fingerprint</h3><p>Checks whether the artifact metadata being verified matches the original committed version.</p><span className="tech-label">KECCAK256 · HASH</span></div>

            <div className="how-card"><span className="how-icon gold"><ShieldCheck /></span><h3>Public verification</h3><p>Ownership and transfers can be checked independently on Monad when the contract is deployed.</p><span className="tech-label">MONAD TESTNET · DEPLOYED</span></div>

          </div>

        </section>



        <footer><a className="brand footer-brand" href="#" onClick={e => e.preventDefault()}><span className="brand-mark"><Gem size={18} /></span><span>LEGACY <b>LOOT</b><small>YOUR LEGACY. YOUR LOOT.</small></span></a><span>Prototype · Testnet only · No real-money assets</span><span>Built for Monad Blitz</span></footer>

      </main>

    </div>

  );

}