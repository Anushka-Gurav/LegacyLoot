import React, { useEffect, useMemo, useState } from 'react';

import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';

import { get, onValue, ref, runTransaction, update } from 'firebase/database';

import { Swords, Users, Copy, ShieldCheck, Trophy, RotateCcw, DoorOpen, Shield, HeartPulse, Flame } from 'lucide-react';

import { auth, db, firebaseConfigured } from './firebase';

const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeRoomCode() {

  return Array.from({ length: 6 }, () => ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)]).join('');

}

function shortAddress(address = '') {

  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : 'Wallet not connected';

}

export default function PvpArena({ wallet, onRewardReady }) {

  const [firebaseUser, setFirebaseUser] = useState(null);

  const [authReady, setAuthReady] = useState(false);

  const [roomCodeInput, setRoomCodeInput] = useState('');

  const [roomCode, setRoomCode] = useState('');

  const [room, setRoom] = useState(null);

  const [busy, setBusy] = useState(false);

  const [message, setMessage] = useState('Create a room or join a friend to start a live PvP duel.');

  useEffect(() => {

    if (!firebaseConfigured || !auth) {

      setAuthReady(true);

      return undefined;

    }

    const unsub = onAuthStateChanged(auth, async user => {

      if (user) {

        setFirebaseUser(user);

        setAuthReady(true);

        return;

      }

      try {

        const credential = await signInAnonymously(auth);

        setFirebaseUser(credential.user);

      } catch (error) {

        console.error(error);

        setMessage(`Firebase sign-in failed: ${error.message}`);

      } finally {

        setAuthReady(true);

      }

    });

    return unsub;

  }, []);

  useEffect(() => {

    if (!db || !roomCode) {

      setRoom(null);

      return undefined;

    }

    const roomRef = ref(db, `pvpRooms/${roomCode}`);

    const unsub = onValue(roomRef, snapshot => {

      if (snapshot.exists()) setRoom(snapshot.val());

      else {

        setRoom(null);

        setMessage('Room not found. Check the code and try again.');

      }

    }, error => setMessage(`Realtime sync error: ${error.message}`));

    return unsub;

  }, [roomCode]);

  const mySlot = useMemo(() => {

    if (!firebaseUser || !room) return null;

    if (room.player1?.uid === firebaseUser.uid) return 'player1';

    if (room.player2?.uid === firebaseUser.uid) return 'player2';

    return null;

  }, [firebaseUser, room]);

  const opponentSlot = mySlot === 'player1' ? 'player2' : mySlot === 'player2' ? 'player1' : null;

  const isMyTurn = Boolean(room && mySlot && room.status === 'active' && room.currentTurn === firebaseUser?.uid);

  // Notify App.jsx when the current Firebase session wins a completed duel.
  useEffect(() => {
    if (
      roomCode &&
      room?.status === 'finished' &&
      firebaseUser?.uid &&
      room.winnerUid === firebaseUser.uid &&
      mySlot &&
      typeof onRewardReady === 'function'
    ) {
      onRewardReady(roomCode);
    }
  }, [roomCode, room?.status, room?.winnerUid, firebaseUser?.uid, mySlot, onRewardReady]);

  async function ensureReady() {

    if (!firebaseConfigured || !auth || !db) throw new Error('Firebase is not configured yet. Follow the Firebase setup steps and create your .env file.');

    if (!wallet) throw new Error('Connect MetaMask on Monad Testnet before creating or joining a duel.');

    if (!firebaseUser) throw new Error('Firebase sign-in is still loading. Try again in a moment.');

  }

  async function createRoom() {

    setBusy(true);

    try {

      await ensureReady();

      let createdCode = '';

      for (let attempt = 0; attempt < 5; attempt++) {

        const code = makeRoomCode();

        const roomRef = ref(db, `pvpRooms/${code}`);

        const result = await runTransaction(roomRef, existing => {

          if (existing !== null) return;

          return {

            code,

            status: 'waiting',

            createdAt: Date.now(),

            player1: { uid: firebaseUser.uid, wallet, hp: 100, defending: false, healsLeft: 2, specialReady: true },

            player2: null,

            currentTurn: firebaseUser.uid,

            winnerUid: null,

            round: 0,

            log: [{ text: `${shortAddress(wallet)} created the room. Waiting for an opponent.`, at: Date.now() }],

          };

        }, { applyLocally: false });

        if (result.committed) { createdCode = code; break; }

      }

      if (!createdCode) throw new Error('Could not reserve a unique room code. Please try again.');

      setRoomCodeInput(createdCode);

      setRoomCode(createdCode);

      setMessage(`Room ${createdCode} created. Share the code with Player 2.`);

    } catch (error) {

      console.error(error);

      setMessage(error.message || 'Could not create room.');

    } finally { setBusy(false); }

  }

  async function joinRoom() {
    setBusy(true);
    try {
      await ensureReady();

      const code = roomCodeInput.trim().toUpperCase();
      if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) {
        throw new Error('Enter the 6-character room code.');
      }

      const roomRef = ref(db, `pvpRooms/${code}`);
      const snapshot = await get(roomRef);

      if (!snapshot.exists()) {
        throw new Error(`Room ${code} was not found at pvpRooms/${code}. Ask Player 1 to create a new room and share that exact code.`);
      }

      const existing = snapshot.val();
      console.log('ROOM READ TEST:', {
        code,
        path: `pvpRooms/${code}`,
        exists: true,
        status: existing.status,
        hasPlayer2: Boolean(existing.player2),
        player1Uid: existing.player1?.uid,
        player1Wallet: existing.player1?.wallet,
        myUid: firebaseUser.uid,
        myWallet: wallet,
      });

      if (existing.status !== 'waiting') {
        throw new Error(`Room ${code} is not waiting for a player (status: ${existing.status || 'unknown'}). Ask Player 1 to create a new room.`);
      }
      if (!existing.player1?.uid || !existing.player1?.wallet) {
        throw new Error('This room has incomplete Player 1 data. Create a new room.');
      }
      if (existing.player2) {
        throw new Error('This room already has a Player 2. Ask Player 1 to create a new room.');
      }
      if (existing.player1.uid === firebaseUser.uid) {
        throw new Error('You cannot join your own room with the same Firebase session. Open Player 2 in a separate browser profile.');
      }
      if (existing.player1.wallet.toLowerCase() === wallet.toLowerCase()) {
        throw new Error('Player 1 and Player 2 must connect different MetaMask wallets.');
      }

      // Claim only the player2 slot transactionally. The previous code ran a
      // transaction on the whole room and aborted when its first callback got
      // a local null value, even though get() had just confirmed the room exists.
      const player2Ref = ref(db, `pvpRooms/${code}/player2`);
      const player2Result = await runTransaction(
        player2Ref,
        currentPlayer2 => {
          if (currentPlayer2 !== null) return;
          return { uid: firebaseUser.uid, wallet, hp: 100, defending: false, healsLeft: 2, specialReady: true };
        },
        { applyLocally: false }
      );

      if (!player2Result.committed) {
        throw new Error('Another player joined this room first. Ask Player 1 to create a new room.');
      }

      const log = [
        ...(existing.log || []),
        { text: `${shortAddress(wallet)} joined. Duel started!`, at: Date.now() },
      ].slice(-12);

      await update(roomRef, {
        status: 'active',
        currentTurn: existing.player1.uid,
        log,
      });

      setRoomCodeInput(code);
      setRoomCode(code);
      setMessage(`Joined room ${code}. The duel is live!`);
    } catch (error) {
      console.error('Join room failed:', error);
      setMessage(error.message || 'Could not join room.');
    } finally {
      setBusy(false);
    }
  }

  async function takeAction(action) {
    if (!roomCode || !firebaseUser || !mySlot) return;
    setBusy(true);
    try {
      const roomRef = ref(db, `pvpRooms/${roomCode}`);
      const result = await runTransaction(roomRef, existing => {
        if (!existing || existing.status !== 'active' || existing.currentTurn !== firebaseUser.uid) return;
        const attacker = mySlot;
        const defender = opponentSlot;
        if (!existing[attacker] || !existing[defender]) return;
        const actor = { ...existing[attacker] };
        const target = { ...existing[defender] };
        let logText = '';
        if (action === 'attack') {
          let damage = 20;
          if (target.defending) { damage = Math.ceil(damage / 2); target.defending = false; }
          target.hp = Math.max(0, Number(target.hp) - damage);
          logText = `${shortAddress(actor.wallet)} struck for ${damage} damage${damage < 20 ? ' (guarded)' : ''}.`;
        } else if (action === 'defend') {
          actor.defending = true;
          logText = `${shortAddress(actor.wallet)} raised their guard. The next hit is reduced by 50%.`;
        } else if (action === 'heal') {
          if ((actor.healsLeft ?? 2) <= 0 || actor.hp >= 100) return;
          const before = Number(actor.hp);
          actor.hp = Math.min(100, before + 15);
          actor.healsLeft = (actor.healsLeft ?? 2) - 1;
          logText = `${shortAddress(actor.wallet)} restored ${actor.hp - before} HP. (${actor.healsLeft} heals left)`;
        } else if (action === 'special') {
          if (actor.specialReady === false) return;
          let damage = 30;
          if (target.defending) { damage = Math.ceil(damage / 2); target.defending = false; }
          target.hp = Math.max(0, Number(target.hp) - damage);
          actor.specialReady = false;
          logText = `${shortAddress(actor.wallet)} unleashed a SPECIAL for ${damage} damage!`;
        } else return;
        const winnerUid = target.hp === 0 ? firebaseUser.uid : null;
        const log = [...(existing.log || []), { text: logText, at: Date.now() }];
        if (winnerUid) log.push({ text: `${shortAddress(actor.wallet)} wins the duel and earns the right to claim loot!`, at: Date.now() });
        return {
          ...existing,
          [attacker]: actor,
          [defender]: target,
          currentTurn: winnerUid ? null : target.uid,
          winnerUid,
          status: winnerUid ? 'finished' : 'active',
          round: Number(existing.round || 0) + 1,
          log: log.slice(-20),
        };
      }, { applyLocally: false });
      if (!result.committed) setMessage('Action unavailable: wait for your turn, or check whether that ability has already been used.');
      else setMessage(result.snapshot.val()?.status === 'finished' ? 'Victory! Your reward is ready to claim after server verification.' : 'Move synced to both players.');
    } catch (error) {
      console.error(error);
      setMessage(`Move failed: ${error.message}`);
    } finally { setBusy(false); }
  }

  async function resetRoom() {

    if (!roomCode || !room || !mySlot || !firebaseUser) return;

    setBusy(true);

    try {

      const roomRef = ref(db, `pvpRooms/${roomCode}`);

      const result = await runTransaction(roomRef, existing => {

        if (!existing || (existing.player1?.uid !== firebaseUser.uid && existing.player2?.uid !== firebaseUser.uid)) return;

        return {

          ...existing,

          status: existing.player2 ? 'active' : 'waiting',

          player1: { ...existing.player1, hp: 100, defending: false, healsLeft: 2, specialReady: true },

          player2: existing.player2 ? { ...existing.player2, hp: 100, defending: false, healsLeft: 2, specialReady: true } : null,

          currentTurn: existing.player1.uid,

          winnerUid: null,

          round: 0,

          log: [{ text: `${shortAddress(wallet)} reset the duel.`, at: Date.now() }],

        };

      }, { applyLocally: false });

      if (result.committed) setMessage('Duel reset. Player 1 takes the first turn.');

    } catch (error) { setMessage(`Reset failed: ${error.message}`); }

    finally { setBusy(false); }

  }

  async function copyRoomCode() {

    try { await navigator.clipboard.writeText(roomCode); setMessage(`Room code ${roomCode} copied.`); }

    catch { setMessage(`Share this room code: ${roomCode}`); }

  }

  const panelStyle = { border: '1px solid rgba(160,130,255,.28)', borderRadius: 16, padding: 20, background: 'rgba(20,18,36,.8)', minWidth: 0 };

  const inputStyle = { width: '100%', boxSizing: 'border-box', padding: '12px 14px', borderRadius: 10, border: '1px solid rgba(160,130,255,.3)', background: '#0d0b16', color: '#f5f3ff', margin: '8px 0 12px' };

  const playerCard = (title, player, slot) => (

    <div key={slot} style={{ ...panelStyle, padding: 16 }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>

        <strong>{title}</strong><span className="chapter-tag">{player ? `${player.hp} HP` : 'Waiting'}</span>

      </div>

      <p style={{ color: '#a99bc9', overflowWrap: 'anywhere', fontSize: 13 }}>{player ? shortAddress(player.wallet) : 'Waiting for player…'}</p>

      <div style={{ height: 8, background: '#302a43', borderRadius: 99, overflow: 'hidden' }}><div style={{ height: '100%', width: `${Math.max(0, Math.min(100, player?.hp || 0))}%`, background: (player?.hp || 0) > 35 ? '#9d80ff' : '#f87171', transition: 'width .25s' }} /></div>

      {player && <small style={{ color: '#9286b4' }}>{wallet && player.wallet?.toLowerCase() === wallet.toLowerCase() ? 'Your connected wallet' : 'Opponent wallet'}</small>}

    </div>

  );

  return (

    <section className="adventure-section" id="pvp-arena" style={{ marginTop: 32 }}>

      <div className="section-heading"><div><div className="eyebrow"><Swords size={14} style={{ display: 'inline', verticalAlign: 'middle' }} /> LIVE ARENA</div><h2>Player vs Player</h2></div><span className="chapter-tag">FIREBASE REALTIME</span></div>

      {!firebaseConfigured ? (

        <div className="notice" style={{ marginBottom: 16 }}>Firebase isn't configured. Create a Firebase project, enable Anonymous Authentication and Realtime Database, then fill in the VITE_FIREBASE_* values in your .env file.</div>

      ) : !authReady ? (

        <div className="notice" style={{ marginBottom: 16 }}>Connecting to Firebase…</div>

      ) : (

        <>

          <div className="dungeon-card" style={{ display: 'block', padding: 20 }}>

            <p style={{ color: '#bcb1d7', marginTop: 0 }}>Connect two different MetaMask wallets. Player 1 creates a room code; Player 2 joins from another browser session/device. Turns and HP sync live.</p>

            {!roomCode && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 16 }}>

              <div style={panelStyle}>

                <h3 style={{ marginTop: 0 }}><Users size={18} style={{ display: 'inline', verticalAlign: 'middle' }} /> Create a duel room</h3>

                <p style={{ color: '#a99bc9', fontSize: 13 }}>Your MetaMask wallet: {shortAddress(wallet)}</p>

                <button className="primary-btn full-btn" onClick={createRoom} disabled={busy || !wallet || !firebaseUser}>{busy ? 'Please wait…' : 'Create room'}</button>

              </div>

              <div style={panelStyle}>

                <h3 style={{ marginTop: 0 }}><DoorOpen size={18} style={{ display: 'inline', verticalAlign: 'middle' }} /> Join a duel room</h3>

                <input style={inputStyle} value={roomCodeInput} onChange={e => setRoomCodeInput(e.target.value.toUpperCase())} placeholder="Enter 6-character code" maxLength={6} />

                <button className="outline-btn" onClick={joinRoom} disabled={busy || !wallet || !firebaseUser}>{busy ? 'Please wait…' : 'Join room'}</button>

              </div>

            </div>}

            {roomCode && room && <>

              <div style={{ ...panelStyle, marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>

                <div><small style={{ color: '#a99bc9' }}>ROOM CODE</small><div style={{ fontSize: 28, fontWeight: 800, letterSpacing: 5 }}>{roomCode}</div><small style={{ color: '#a99bc9' }}>{room.status === 'waiting' ? 'Waiting for opponent to join…' : room.status === 'active' ? `Round ${room.round || 0} · ${isMyTurn ? 'Your turn' : 'Opponent’s turn'}` : 'Duel finished'}</small></div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button className="outline-btn" onClick={copyRoomCode}><Copy size={14} /> Copy code</button><button className="outline-btn" onClick={() => { setRoomCode(''); setRoom(null); setRoomCodeInput(''); }}><DoorOpen size={14} /> Leave view</button></div>

              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 16, marginBottom: 16 }}>

                {playerCard('PLAYER 1', room.player1, 'player1')}

                {playerCard('PLAYER 2', room.player2, 'player2')}

              </div>

              {room.status === 'active' && <div style={{ ...panelStyle, textAlign: 'center', marginBottom: 16 }}><h3 style={{ marginTop: 0 }}>Your action</h3><p style={{ color: '#a99bc9' }}>Choose your move. Attack deals 20 damage; defend halves the next hit; heal restores 15 HP (2 uses); special deals 30 damage (once).</p><div className="combat-actions"><button className="primary-btn" onClick={() => takeAction('attack')} disabled={!isMyTurn || busy}><Swords size={16}/> Attack · 20</button><button className="outline-btn" onClick={() => takeAction('defend')} disabled={!isMyTurn || busy}><Shield size={15}/> Defend</button><button className="outline-btn" onClick={() => takeAction('heal')} disabled={!isMyTurn || busy || (room[mySlot]?.healsLeft ?? 2) <= 0 || room[mySlot]?.hp >= 100}><HeartPulse size={15}/> Heal · {room[mySlot]?.healsLeft ?? 2}</button><button className="outline-btn" onClick={() => takeAction('special')} disabled={!isMyTurn || busy || room[mySlot]?.specialReady === false}><Flame size={15}/> Special · 30</button></div><small style={{display:'block',marginTop:10,color:'#9286b4'}}>{busy ? 'Resolving move…' : isMyTurn ? 'Your turn — choose wisely.' : 'Opponent is choosing a move.'}</small></div>}

              {room.status === 'finished' && <div className="victory" style={{ marginBottom: 16 }}><Trophy size={17} /> {room.winnerUid === firebaseUser?.uid ? 'You won the duel!' : 'Your opponent won the duel.'} <button className="outline-btn" onClick={resetRoom} disabled={busy}><RotateCcw size={14} /> Rematch</button></div>}

              <div style={panelStyle}><h3 style={{ marginTop: 0 }}>Battle log</h3>{(room.log || []).slice().reverse().map((entry, i) => <p key={`${entry.at}-${i}`} style={{ color: '#bcb1d7', borderBottom: '1px solid rgba(160,130,255,.12)', paddingBottom: 8 }}>{entry.text}</p>)}</div>

            </>}

          </div>

        </>

      )}

      <div className="notice" style={{ marginTop: 14 }}><ShieldCheck size={16} /><span>{message} {roomCode && room && !mySlot ? 'This Firebase session is not one of the room players.' : ''}</span></div>

      <p style={{ color: '#8e84a8', fontSize: 12, marginTop: 10 }}>Prototype warning: Firebase synchronizes the duel state, but browser-side combat is not cheat-proof. Use a trusted server/Cloud Functions for competitive production play. Firebase rooms are game state; Monad remains the source of truth for NFT ownership.</p>

    </section>

  );

}
