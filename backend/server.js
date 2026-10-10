
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import admin from 'firebase-admin';
import {
  AbiCoder,
  Wallet,
  getBytes,
  keccak256,
  toUtf8Bytes,
  isAddress,
} from 'ethers';

const required = [
  'CLAIM_SIGNER_PRIVATE_KEY',
  'FIREBASE_SERVICE_ACCOUNT_JSON',
  'FIREBASE_DATABASE_URL',
  'CONTRACT_ADDRESS',
];

for (const key of required) {
  const value = process.env[key];
  if (!value || value.includes('REPLACE_') || value === '{}') {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

if (!isAddress(process.env.CONTRACT_ADDRESS)) {
  throw new Error('CONTRACT_ADDRESS is invalid');
}

const serviceAccount = JSON.parse(
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});

const db = admin.database();
const signer = new Wallet(process.env.CLAIM_SIGNER_PRIVATE_KEY);
const contractAddress = process.env.CONTRACT_ADDRESS;
const chainId = Number(process.env.MONAD_CHAIN_ID || 10143);
const coder = AbiCoder.defaultAbiCoder();

const app = express();
app.disable('x-powered-by');
app.use(helmet());

const allowedOrigins = (
  process.env.FRONTEND_ORIGIN ||
  'http://localhost:5173,http://localhost:5174'
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (
        !origin ||
        allowedOrigins.includes(origin) ||
        /^http:\/\/localhost:517[0-9]$/.test(origin)
      ) {
        return callback(null, true);
      }

      return callback(new Error('Origin is not allowed by CORS'));
    },
  })
);

app.use(express.json({ limit: '16kb' }));

app.use(
  '/api/',
  rateLimit({
    windowMs: 60_000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

const artifacts = {
  'LL-001': {
    id: 'LL-001',
    name: 'Phoenix Blade',
    rarity: 'Legendary',
    attack: 95,
    image: 'phoenix-blade',
    requiredWins: 1,
  },
  'LL-002': {
    id: 'LL-002',
    name: 'Moon Crystal',
    rarity: 'Rare',
    attack: 42,
    image: 'moon-crystal',
    requiredWins: 2,
  },
  'LL-003': {
    id: 'LL-003',
    name: 'Mossguard Shield',
    rarity: 'Common',
    attack: 18,
    image: 'mossguard-shield',
    requiredWins: 3,
  },
};

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    chainId,
    signer: signer.address,
    contractAddress,
  });
});

app.post('/api/reward-claim', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';

    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Firebase ID token required.',
      });
    }

    const decoded = await admin.auth().verifyIdToken(
      authHeader.slice(7)
    );

    const { roomCode, wallet, artifactId, uri, fingerprint } =
      req.body || {};

    if (
      typeof roomCode !== 'string' ||
      !/^[A-HJ-NP-Z2-9]{6}$/i.test(roomCode)
    ) {
      return res.status(400).json({
        error: 'Invalid room code.',
      });
    }

    if (!isAddress(wallet)) {
      return res.status(400).json({
        error: 'Invalid wallet address.',
      });
    }

    if (
      typeof uri !== 'string' ||
      uri.length < 1 ||
      uri.length > 12000
    ) {
      return res.status(400).json({
        error: 'Invalid artifact URI.',
      });
    }

    if (
      typeof fingerprint !== 'string' ||
      !/^0x[0-9a-fA-F]{64}$/.test(fingerprint) ||
      /^0x0{64}$/i.test(fingerprint)
    ) {
      return res.status(400).json({
        error: 'Invalid fingerprint.',
      });
    }

    const artifact = artifacts[artifactId];

    if (!artifact) {
      return res.status(400).json({
        error: 'Unknown artifact reward.',
      });
    }

    // Accept only the canonical metadata for the selected artifact.
    const prefix = 'data:application/json;base64,';

    if (!uri.startsWith(prefix)) {
      return res.status(400).json({
        error: 'Only canonical data-URI metadata is supported.',
      });
    }

    let metadata;

    try {
      metadata = JSON.parse(
        Buffer.from(uri.slice(prefix.length), 'base64').toString('utf8')
      );
    } catch {
      return res.status(400).json({
        error: 'Metadata JSON could not be decoded.',
      });
    }

    const {
      requiredWins: _requiredWins,
      ...canonicalMetadata
    } = artifact;

    if (
      JSON.stringify(metadata) !== JSON.stringify(canonicalMetadata)
    ) {
      return res.status(400).json({
        error: 'Artifact metadata does not match the allowlist.',
      });
    }

    const computedFingerprint = keccak256(
      toUtf8Bytes(JSON.stringify(canonicalMetadata))
    );

    if (
      computedFingerprint.toLowerCase() !== fingerprint.toLowerCase()
    ) {
      return res.status(400).json({
        error: 'Fingerprint does not match canonical metadata.',
      });
    }

    const normalizedCode = roomCode.toUpperCase();

    // Verify the room and its recorded winner.
    const roomSnapshot = await db
      .ref(`pvpRooms/${normalizedCode}`)
      .get();

    if (!roomSnapshot.exists()) {
      return res.status(404).json({
        error: 'Duel room not found.',
      });
    }

    const room = roomSnapshot.val();

    if (
      room.status !== 'finished' ||
      room.winnerUid !== decoded.uid
    ) {
      return res.status(403).json({
        error: 'Only the recorded winner of a finished duel can claim.',
      });
    }

    const winner = [room.player1, room.player2].find(
      (player) => player && player.uid === decoded.uid
    );

    if (
      !winner ||
      typeof winner.wallet !== 'string' ||
      winner.wallet.toLowerCase() !== wallet.toLowerCase()
    ) {
      return res.status(403).json({
        error: 'Wallet does not match the winning player.',
      });
    }

    // Count finished rooms won by this Firebase identity and wallet.
    const roomsSnapshot = await db.ref('pvpRooms').get();
    const allRooms = roomsSnapshot.exists()
      ? roomsSnapshot.val()
      : {};

    const completedWins = Object.values(allRooms).filter((entry) => {
      if (
        !entry ||
        entry.status !== 'finished' ||
        entry.winnerUid !== decoded.uid
      ) {
        return false;
      }

      return [entry.player1, entry.player2].some(
        (player) =>
          player &&
          player.uid === decoded.uid &&
          typeof player.wallet === 'string' &&
          player.wallet.toLowerCase() === wallet.toLowerCase()
      );
    }).length;

    if (completedWins < artifact.requiredWins) {
      return res.status(403).json({
        error: `${artifact.name} requires ${artifact.requiredWins} completed PvP win(s). Wins recorded: ${completedWins}.`,
      });
    }

    // Include artifact ID so each reward has a distinct claim ID.
    const rewardId = keccak256(
      toUtf8Bytes(
        `${normalizedCode}:${decoded.uid}:${wallet.toLowerCase()}:${artifactId}`
      )
    );

    const digest = keccak256(
      coder.encode(
        [
          'address',
          'string',
          'bytes32',
          'bytes32',
          'uint256',
          'address',
        ],
        [
          wallet,
          uri,
          fingerprint,
          rewardId,
          chainId,
          contractAddress,
        ]
      )
    );

    const signature = await signer.signMessage(getBytes(digest));

    return res.json({
      rewardId,
      signature,
      signer: signer.address,
      chainId,
      contractAddress,
      artifactId,
      completedWins,
    });
  } catch (error) {
    console.error('reward-claim error:', error);

    return res.status(500).json({
      error: 'Could not authorize reward claim.',
    });
  }
});

const port = Number(process.env.PORT || 8787);

app.listen(port, () => {
  console.log(
    `Legacy Loot reward signer listening on ${port}; ` +
    `signer=${signer.address}; chainId=${chainId}`
  );
});
