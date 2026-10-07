const express = require('express');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');
const MODELS_DIR = path.join(ROOT_DIR, 'modelos');
const DB_PATH = path.join(DATA_DIR, 'libras-play.db');

const STATIC_CURRENT_FILE = path.join(MODELS_DIR, 'modelo-atual.json');
const MOVEMENT_CURRENT_FILE = path.join(MODELS_DIR, 'modelo-movimento-atual.json');
const MOVEMENT_LABELS = [7, 9, 10, 23, 24, 25];

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(MODELS_DIR, { recursive: true });

const db = new sqlite3.Database(DB_PATH, (error) => {
  if (error) {
    console.error('Erro ao abrir o banco SQLite:', error.message);
    process.exit(1);
  }
  console.log('Banco SQLite conectado:', DB_PATH);
});

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) reject(error);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) reject(error);
      else resolve(rows);
    });
  });
}

async function initializeDatabase() {
  await run(`
    CREATE TABLE IF NOT EXISTS training_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label INTEGER NOT NULL CHECK(label BETWEEN 0 AND 25),
      coordinates TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await run('CREATE INDEX IF NOT EXISTS idx_training_samples_label ON training_samples(label)');
  // Remove amostras antigas dessas letras, pois agora elas pertencem ao modelo de movimento.
  await run('DELETE FROM training_samples WHERE label IN (7, 9, 10, 23, 24, 25)');

  const movementTableSql = await all(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'movement_samples'"
  );
  const needsMovementMigration = movementTableSql.length > 0 &&
    !movementTableSql[0].sql.includes('7, 9, 10, 23, 24, 25');

  if (needsMovementMigration) {
    await run('ALTER TABLE movement_samples RENAME TO movement_samples_old');
  }

  await run(`
    CREATE TABLE IF NOT EXISTS movement_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label INTEGER NOT NULL CHECK(label IN (7, 9, 10, 23, 24, 25)),
      frames TEXT NOT NULL,
      frame_count INTEGER NOT NULL DEFAULT 30,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  if (needsMovementMigration) {
    await run(`
      INSERT INTO movement_samples (id, label, frames, frame_count, created_at)
      SELECT id, label, frames, frame_count, created_at
      FROM movement_samples_old
      WHERE label IN (7, 9, 10, 23, 24, 25)
    `);
    await run('DROP TABLE movement_samples_old');
  }

  await run('CREATE INDEX IF NOT EXISTS idx_movement_samples_label ON movement_samples(label)');

  await run(`
    CREATE TABLE IF NOT EXISTS game_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_name TEXT NOT NULL DEFAULT 'Jogador',
      score INTEGER NOT NULL DEFAULT 0,
      correct_answers INTEGER NOT NULL DEFAULT 0,
      total_rounds INTEGER NOT NULL DEFAULT 10,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      librix_balance INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const playerColumns = await all(`PRAGMA table_info(players)`);
  const playerColumnNames = new Set(playerColumns.map((column) => column.name));

  if (!playerColumnNames.has('avatar')) {
    await run(`ALTER TABLE players ADD COLUMN avatar TEXT NOT NULL DEFAULT 'exploradora'`);
  }

  if (!playerColumnNames.has('games_played')) {
    await run(`ALTER TABLE players ADD COLUMN games_played INTEGER NOT NULL DEFAULT 0`);
  }

  if (!playerColumnNames.has('best_score')) {
    await run(`ALTER TABLE players ADD COLUMN best_score INTEGER NOT NULL DEFAULT 0`);
  }

  if (!playerColumnNames.has('total_correct')) {
    await run(`ALTER TABLE players ADD COLUMN total_correct INTEGER NOT NULL DEFAULT 0`);
  }

  await run(`
    CREATE TABLE IF NOT EXISTS librix_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_name TEXT NOT NULL COLLATE NOCASE,
      amount INTEGER NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS shop_items (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      price INTEGER NOT NULL CHECK(price >= 0),
      icon TEXT NOT NULL,
      category TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS player_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_name TEXT NOT NULL COLLATE NOCASE,
      item_id INTEGER NOT NULL,
      purchased_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(player_name, item_id),
      FOREIGN KEY(item_id) REFERENCES shop_items(id)
    )
  `);

  await run(
    `INSERT OR IGNORE INTO shop_items (id, name, description, price, icon, category)
     VALUES
       (1, 'Boné aventureiro', 'Um boné especial para o seu personagem.', 500, '🧢', 'roupa'),
       (2, 'Camiseta LibrasPlay', 'Camiseta oficial do LibrasPlay.', 1500, '👕', 'roupa'),
       (3, 'Personagem explorador', 'Desbloqueia o personagem explorador.', 3000, '🧑‍🌾', 'personagem'),
       (4, 'Professor Cássio — Desbloqueio Acidental', 'Formado em Engenharia da Computação pela PUC. Você comprou sem querer e agora ele faz parte da sua história para sempre.', 21, '👨‍🏫', 'descolecionável')`
  );
await run(
  `UPDATE shop_items
   SET price = CASE id
     WHEN 1 THEN 500
     WHEN 2 THEN 1500
     WHEN 3 THEN 3000
     WHEN 4 THEN 21
     ELSE price
   END
   WHERE id IN (1, 2, 3, 4)`
);
  await run(`
    CREATE TABLE IF NOT EXISTS model_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version INTEGER NOT NULL UNIQUE,
      folder_name TEXT NOT NULL UNIQUE,
      accuracy REAL,
      loss REAL,
      sample_count INTEGER NOT NULL DEFAULT 0,
      trained_labels TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      active INTEGER NOT NULL DEFAULT 0
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS movement_model_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version INTEGER NOT NULL UNIQUE,
      folder_name TEXT NOT NULL UNIQUE,
      accuracy REAL,
      loss REAL,
      sample_count INTEGER NOT NULL DEFAULT 0,
      trained_labels TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      active INTEGER NOT NULL DEFAULT 0
    )
  `);
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return null; }
}

function currentFileFor(type) {
  return type === 'movement' ? MOVEMENT_CURRENT_FILE : STATIC_CURRENT_FILE;
}

function folderPrefixFor(type) {
  return type === 'movement' ? 'movimento_v' : 'modelo_v';
}

function nextModelVersion(type) {
  const prefix = folderPrefixFor(type);
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escaped}(\\d+)$`);
  const versions = fs.readdirSync(MODELS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && pattern.test(entry.name))
    .map((entry) => Number(entry.name.match(pattern)[1]))
    .filter(Number.isFinite);
  return versions.length ? Math.max(...versions) + 1 : 1;
}

app.use(express.json({ limit: '100mb' }));

// Ao entrar no localhost, abre primeiro a tela de jogadores
app.get('/', (_req, res) => {
  res.sendFile(
    path.join(ROOT_DIR, 'public', 'perfil.html')
  );
});

app.use(express.static(path.join(ROOT_DIR, 'public')));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, database: 'sqlite', port: PORT, movement: true });
});

// ------------------------- AMOSTRAS ESTÁTICAS -------------------------
app.get('/api/samples', async (_req, res) => {
  try {
    const rows = await all('SELECT id, label, coordinates, created_at FROM training_samples ORDER BY id ASC');
    const samples = rows.map((row) => ({
      id: row.id,
      label: row.label,
      coordinates: JSON.parse(row.coordinates),
      createdAt: row.created_at
    }));
    res.json({ samples, total: samples.length });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Não foi possível carregar as amostras estáticas.' });
  }
});

app.get('/api/samples/summary', async (_req, res) => {
  try {
    const rows = await all('SELECT label, COUNT(*) AS total FROM training_samples GROUP BY label ORDER BY label ASC');
    res.json({ labels: rows });
  } catch (error) {
    res.status(500).json({ error: 'Não foi possível carregar o resumo.' });
  }
});

app.post('/api/samples/batch', async (req, res) => {
  const { samples } = req.body;
  if (!Array.isArray(samples) || samples.length === 0) {
    return res.status(400).json({ error: 'Envie uma lista de amostras.' });
  }
  if (samples.length > 5000) return res.status(413).json({ error: 'O lote ultrapassa 5.000 amostras.' });

  const invalid = samples.find((sample) =>
    !Number.isInteger(sample.label) || sample.label < 0 || sample.label > 25 || MOVEMENT_LABELS.includes(sample.label) ||
    !Array.isArray(sample.coordinates) || sample.coordinates.length !== 63 ||
    sample.coordinates.some((value) => !Number.isFinite(value))
  );
  if (invalid) return res.status(400).json({ error: 'Amostra estática inválida. H, J, K, X, Y e Z devem ser gravadas como movimento.' });

  try {
    await run('BEGIN TRANSACTION');
    for (const sample of samples) {
      await run('INSERT INTO training_samples (label, coordinates) VALUES (?, ?)', [sample.label, JSON.stringify(sample.coordinates)]);
    }
    await run('COMMIT');
    res.status(201).json({ saved: samples.length });
  } catch (error) {
    await run('ROLLBACK').catch(() => {});
    console.error(error);
    res.status(500).json({ error: 'Não foi possível salvar as amostras.' });
  }
});

app.delete('/api/samples/:label', async (req, res) => {
  const label = Number(req.params.label);
  if (!Number.isInteger(label) || label < 0 || label > 25) return res.status(400).json({ error: 'Letra inválida.' });
  try {
    const result = await run('DELETE FROM training_samples WHERE label = ?', [label]);
    res.json({ deleted: result.changes });
  } catch (error) {
    res.status(500).json({ error: 'Não foi possível excluir as amostras.' });
  }
});

app.delete('/api/samples', async (_req, res) => {
  try {
    const result = await run('DELETE FROM training_samples');
    res.json({ deleted: result.changes });
  } catch (error) {
    res.status(500).json({ error: 'Não foi possível limpar o banco.' });
  }
});

// ------------------------- AMOSTRAS DE MOVIMENTO -------------------------
app.get('/api/movements', async (_req, res) => {
  try {
    const rows = await all('SELECT id, label, frames, frame_count, created_at FROM movement_samples ORDER BY id ASC');
    const samples = rows.map((row) => ({
      id: row.id,
      label: row.label,
      frames: JSON.parse(row.frames),
      frameCount: row.frame_count,
      createdAt: row.created_at
    }));
    res.json({ samples, total: samples.length });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Não foi possível carregar os movimentos.' });
  }
});

app.get('/api/movements/summary', async (_req, res) => {
  try {
    const rows = await all('SELECT label, COUNT(*) AS total FROM movement_samples GROUP BY label ORDER BY label ASC');
    res.json({ labels: rows });
  } catch (error) {
    res.status(500).json({ error: 'Não foi possível carregar o resumo de movimentos.' });
  }
});

app.post('/api/movements', async (req, res) => {
  const label = Number(req.body.label);
  const frames = req.body.frames;
  const validLabel = MOVEMENT_LABELS.includes(label);
  const validFrames = Array.isArray(frames) && frames.length === 30 && frames.every((frame) =>
    Array.isArray(frame) && frame.length === 67 && frame.every(Number.isFinite)
  );
  if (!validLabel || !validFrames) {
    return res.status(400).json({ error: 'O movimento precisa ser H, J, K, X, Y ou Z e conter 30 frames com 67 valores cada.' });
  }
  try {
    const result = await run(
      'INSERT INTO movement_samples (label, frames, frame_count) VALUES (?, ?, 30)',
      [label, JSON.stringify(frames)]
    );
    res.status(201).json({ id: result.id, saved: 1 });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Não foi possível salvar o movimento.' });
  }
});

app.delete('/api/movements/:label', async (req, res) => {
  const label = Number(req.params.label);
  if (!MOVEMENT_LABELS.includes(label)) return res.status(400).json({ error: 'Letra de movimento inválida.' });
  try {
    const result = await run('DELETE FROM movement_samples WHERE label = ?', [label]);
    res.json({ deleted: result.changes });
  } catch (error) {
    res.status(500).json({ error: 'Não foi possível excluir os movimentos.' });
  }
});

app.delete('/api/movements', async (_req, res) => {
  try {
    const result = await run('DELETE FROM movement_samples');
    res.json({ deleted: result.changes });
  } catch (error) {
    res.status(500).json({ error: 'Não foi possível limpar os movimentos.' });
  }
});

// ------------------------- MODELOS -------------------------
async function saveModel(req, res, type) {
  const { modelTopology, weightSpecs, weightDataBase64, metadata = {} } = req.body;
  if (!modelTopology || !Array.isArray(weightSpecs) || typeof weightDataBase64 !== 'string') {
    return res.status(400).json({ error: 'Arquivos do modelo inválidos.' });
  }

  const version = nextModelVersion(type);
  const folderName = `${folderPrefixFor(type)}${version}`;
  const folderPath = path.join(MODELS_DIR, folderName);
  fs.mkdirSync(folderPath, { recursive: true });

  try {
    const weightsBuffer = Buffer.from(weightDataBase64, 'base64');
    const modelJson = {
      format: 'layers-model',
      generatedBy: `TensorFlow.js Libras Play (${type})`,
      convertedBy: null,
      modelTopology,
      weightsManifest: [{ paths: ['weights.bin'], weights: weightSpecs }]
    };
    fs.writeFileSync(path.join(folderPath, 'model.json'), JSON.stringify(modelJson, null, 2));
    fs.writeFileSync(path.join(folderPath, 'weights.bin'), weightsBuffer);

    const currentMetadata = {
      type,
      version,
      folderName,
      savedAt: new Date().toISOString(),
      accuracy: Number.isFinite(Number(metadata.accuracy)) ? Number(metadata.accuracy) : null,
      loss: Number.isFinite(Number(metadata.loss)) ? Number(metadata.loss) : null,
      sampleCount: Number.isInteger(Number(metadata.sampleCount)) ? Number(metadata.sampleCount) : 0,
      trainedLabels: Array.isArray(metadata.trainedLabels) ? metadata.trainedLabels : []
    };

    fs.writeFileSync(currentFileFor(type), JSON.stringify(currentMetadata, null, 2));
    const versionTable = type === 'movement' ? 'movement_model_versions' : 'model_versions';
    await run(`UPDATE ${versionTable} SET active = 0`);
    await run(
      `INSERT INTO ${versionTable} (version, folder_name, accuracy, loss, sample_count, trained_labels, active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [version, folderName, currentMetadata.accuracy, currentMetadata.loss, currentMetadata.sampleCount, JSON.stringify(currentMetadata.trainedLabels)]
    );

    res.status(201).json({
      ok: true,
      type,
      version,
      folderName,
      modelUrl: `/api/model/${type}/current/model.json`,
      metadata: currentMetadata
    });
  } catch (error) {
    console.error(error);
    fs.rmSync(folderPath, { recursive: true, force: true });
    res.status(500).json({ error: 'Não foi possível salvar o modelo na pasta.' });
  }
}

app.post('/api/model/save', (req, res) => saveModel(req, res, 'static'));
app.post('/api/model/movement/save', (req, res) => saveModel(req, res, 'movement'));

app.get('/api/model/:type/current', (req, res) => {
  const type = req.params.type === 'movement' ? 'movement' : 'static';
  const metadata = readJson(currentFileFor(type));
  if (!metadata) return res.status(404).json({ error: 'Nenhum modelo salvo.' });
  res.json({ ...metadata, modelUrl: `/api/model/${type}/current/model.json` });
});

// Compatibilidade com a versão anterior
app.get('/api/model/current', (_req, res) => {
  const metadata = readJson(STATIC_CURRENT_FILE);
  if (!metadata) return res.status(404).json({ error: 'Nenhum modelo salvo.' });
  res.json({ ...metadata, modelUrl: '/api/model/static/current/model.json' });
});

app.get('/api/model/:type/current/model.json', (req, res) => {
  const type = req.params.type === 'movement' ? 'movement' : 'static';
  const metadata = readJson(currentFileFor(type));
  if (!metadata) return res.status(404).json({ error: 'Nenhum modelo salvo.' });
  const filePath = path.join(MODELS_DIR, metadata.folderName, 'model.json');
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Arquivo model.json não encontrado.' });
  res.sendFile(filePath);
});

app.get('/api/model/:type/current/weights.bin', (req, res) => {
  const type = req.params.type === 'movement' ? 'movement' : 'static';
  const metadata = readJson(currentFileFor(type));
  if (!metadata) return res.status(404).end();
  const filePath = path.join(MODELS_DIR, metadata.folderName, 'weights.bin');
  if (!fs.existsSync(filePath)) return res.status(404).end();
  res.type('application/octet-stream').sendFile(filePath);
});

app.get('/api/models', async (_req, res) => {
  try {
    const staticRows = await all(`
      SELECT 'static' AS modelType, version, folder_name AS folderName, accuracy, loss,
             sample_count AS sampleCount, trained_labels AS trainedLabels,
             created_at AS createdAt, active
      FROM model_versions
    `);
    const movementRows = await all(`
      SELECT 'movement' AS modelType, version, folder_name AS folderName, accuracy, loss,
             sample_count AS sampleCount, trained_labels AS trainedLabels,
             created_at AS createdAt, active
      FROM movement_model_versions
    `);
    const models = [...staticRows, ...movementRows]
      .map((row) => ({ ...row, trainedLabels: JSON.parse(row.trainedLabels || '[]') }))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    res.json({ models });
  } catch (error) {
    res.status(500).json({ error: 'Não foi possível listar os modelos.' });
  }
});



// ------------------------- PERFIS DE JOGADOR -------------------------
const PLAYER_AVATARS = ['exploradora', 'atleta', 'estudante'];

app.get('/api/players', async (_req, res) => {
  try {
    const players = await all(`
      SELECT
        player_name AS playerName,
        librix_balance AS balance,
        avatar,
        games_played AS gamesPlayed,
        best_score AS bestScore,
        total_correct AS totalCorrect,
        created_at AS createdAt
      FROM players
      ORDER BY updated_at DESC, player_name COLLATE NOCASE ASC
    `);

    res.json({ players });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Não foi possível carregar os jogadores.' });
  }
});

app.post('/api/players', async (req, res) => {
  const playerName = normalizePlayerName(req.body.playerName);
  const avatar = String(req.body.avatar || 'exploradora');

  if (!PLAYER_AVATARS.includes(avatar)) {
    return res.status(400).json({ error: 'Personagem inválido.' });
  }

  try {
    const existing = await all(
      `SELECT id FROM players WHERE player_name = ? COLLATE NOCASE LIMIT 1`,
      [playerName]
    );

    if (existing.length > 0) {
      return res.status(409).json({ error: 'Já existe um jogador com esse nome.' });
    }

    await run(
      `INSERT INTO players (player_name, avatar)
       VALUES (?, ?)`,
      [playerName, avatar]
    );

    const player = await ensurePlayer(playerName);
    res.status(201).json(player);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Não foi possível criar o jogador.' });
  }
});

app.get('/api/players/:name', async (req, res) => {
  const playerName = normalizePlayerName(req.params.name);

  try {
    const rows = await all(
      `SELECT
         p.player_name AS playerName,
         p.librix_balance AS balance,
         p.avatar,
         p.games_played AS gamesPlayed,
         p.best_score AS bestScore,
         p.total_correct AS totalCorrect,
         (
           SELECT COUNT(*) + 1
           FROM (
             SELECT player_name, MAX(score) AS best
             FROM game_scores
             GROUP BY player_name COLLATE NOCASE
           ) ranking
           WHERE ranking.best > p.best_score
         ) AS rankingPosition
       FROM players p
       WHERE p.player_name = ? COLLATE NOCASE 
       LIMIT 1`,
      [playerName]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Jogador não encontrado.' });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Não foi possível carregar o perfil.' });
  }
});

// ------------------------- LIBRIX -------------------------
function normalizePlayerName(value) {
  return String(value || 'Jogador').trim().slice(0, 40) || 'Jogador';
}

async function ensurePlayer(playerName) {
  await run(
    `INSERT INTO players (player_name)
     VALUES (?)
     ON CONFLICT(player_name) DO NOTHING`,
    [playerName]
  );

  const rows = await all(
    `SELECT
       player_name AS playerName,
       librix_balance AS balance,
       avatar,
       games_played AS gamesPlayed,
       best_score AS bestScore,
       total_correct AS totalCorrect
     FROM players
     WHERE player_name = ? COLLATE NOCASE
     LIMIT 1`,
    [playerName]
  );

  return rows[0];
}

app.get('/api/librix', async (req, res) => {
  const playerName = normalizePlayerName(req.query.playerName);

  try {
    const player = await ensurePlayer(playerName);
    res.json(player);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Não foi possível carregar o saldo de Librix.' });
  }
});

app.post('/api/librix/reward', async (req, res) => {
  const playerName = normalizePlayerName(req.body.playerName);
  const correctAnswers = Number(req.body.correctAnswers);
  const totalRounds = Number(req.body.totalRounds);

  if (![correctAnswers, totalRounds].every(Number.isInteger) ||
      correctAnswers < 0 ||
      totalRounds < 1 ||
      correctAnswers > totalRounds ||
      totalRounds > 10) {
    return res.status(400).json({ error: 'Resultado inválido para calcular as Librix.' });
  }

  const hitReward = correctAnswers * 5;
  const completionBonus = totalRounds === 10 ? 20 : 0;
  const perfectBonus = totalRounds === 10 && correctAnswers === 10 ? 50 : 0;
  const earned = hitReward + completionBonus + perfectBonus;

  try {
    await run('BEGIN TRANSACTION');

    await ensurePlayer(playerName);

    await run(
      `UPDATE players
       SET librix_balance = librix_balance + ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE player_name = ? COLLATE NOCASE`,
      [earned, playerName]
    );

    await run(
      `INSERT INTO librix_transactions (player_name, amount, reason)
       VALUES (?, ?, ?)`,
      [
        playerName,
        earned,
        `Partida: ${correctAnswers}/${totalRounds} acertos`
      ]
    );

    const player = await ensurePlayer(playerName);

    await run('COMMIT');

    res.status(201).json({
      playerName: player.playerName,
      earned,
      balance: player.balance,
      breakdown: {
        hits: hitReward,
        completion: completionBonus,
        perfect: perfectBonus
      }
    });
  } catch (error) {
    await run('ROLLBACK').catch(() => {});
    console.error(error);
    res.status(500).json({ error: 'Não foi possível adicionar as Librix.' });
  }
});


// ------------------------- LOJA LIBRIX -------------------------
app.get('/api/shop/items', async (req, res) => {
  const playerName = normalizePlayerName(req.query.playerName);

  try {
    const player = await ensurePlayer(playerName);

    const items = await all(
      `SELECT
         si.id,
         si.name,
         si.description,
         si.price,
         si.icon,
         si.category,
         CASE WHEN pi.id IS NULL THEN 0 ELSE 1 END AS owned
       FROM shop_items si
       LEFT JOIN player_items pi
         ON pi.item_id = si.id
        AND pi.player_name = ? COLLATE NOCASE
       ORDER BY si.price ASC, si.id ASC`,
      [playerName]
    );

    res.json({
      playerName: player.playerName,
      balance: player.balance,
      items: items.map((item) => ({ ...item, owned: Boolean(item.owned) }))
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Não foi possível carregar a Loja Librix.' });
  }
});

app.post('/api/shop/buy', async (req, res) => {
  const playerName = normalizePlayerName(req.body.playerName);
  const itemId = Number(req.body.itemId);

  if (!Number.isInteger(itemId)) {
    return res.status(400).json({ error: 'Item inválido.' });
  }

  try {
    await run('BEGIN TRANSACTION');

    const player = await ensurePlayer(playerName);

    const itemRows = await all(
      `SELECT id, name, price
       FROM shop_items
       WHERE id = ?
       LIMIT 1`,
      [itemId]
    );

    const item = itemRows[0];

    if (!item) {
      await run('ROLLBACK');
      return res.status(404).json({ error: 'Item não encontrado.' });
    }

    const ownedRows = await all(
      `SELECT id
       FROM player_items
       WHERE player_name = ? COLLATE NOCASE
         AND item_id = ?
       LIMIT 1`,
      [playerName, itemId]
    );

    if (ownedRows.length > 0) {
      await run('ROLLBACK');
      return res.status(409).json({ error: 'Você já possui este item.' });
    }

    if (player.balance < item.price) {
      await run('ROLLBACK');
      return res.status(400).json({ error: 'Saldo de Librix insuficiente.' });
    }

    await run(
      `UPDATE players
       SET librix_balance = librix_balance - ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE player_name = ? COLLATE NOCASE`,
      [item.price, playerName]
    );

    await run(
      `INSERT INTO player_items (player_name, item_id)
       VALUES (?, ?)`,
      [playerName, itemId]
    );

    await run(
      `INSERT INTO librix_transactions (player_name, amount, reason)
       VALUES (?, ?, ?)`,
      [playerName, -item.price, `Compra: ${item.name}`]
    );

    const updatedPlayer = await ensurePlayer(playerName);

    await run('COMMIT');

    res.status(201).json({
      ok: true,
      itemId: item.id,
      itemName: item.name,
      balance: updatedPlayer.balance
    });
  } catch (error) {
    await run('ROLLBACK').catch(() => {});
    console.error(error);
    res.status(500).json({ error: 'Não foi possível concluir a compra.' });
  }
});

app.delete('/api/players/:playerName', async (req, res) => {
  const playerName = String(
    req.params.playerName || ''
  ).trim();

  if (!playerName) {
    return res.status(400).json({
      error: 'Nome do jogador inválido.'
    });
  }

  try {
    await run('BEGIN TRANSACTION');

    await run(
      `DELETE FROM player_items
       WHERE player_name = ? COLLATE NOCASE`,
      [playerName]
    );

    await run(
      `DELETE FROM librix_transactions
       WHERE player_name = ? COLLATE NOCASE`,
      [playerName]
    );

    await run(
      `DELETE FROM game_scores
       WHERE player_name = ? COLLATE NOCASE`,
      [playerName]
    );

    const result = await run(
      `DELETE FROM players
       WHERE player_name = ? COLLATE NOCASE`,
      [playerName]
    );

    await run('COMMIT');

    if (result.changes === 0) {
      return res.status(404).json({
        error: 'Jogador não encontrado.'
      });
    }

    res.json({
      ok: true,
      deleted: playerName
    });

  } catch (error) {
    await run('ROLLBACK').catch(() => {});

    console.error(error);

    res.status(500).json({
      error: 'Não foi possível excluir o jogador.'
    });
  }
});

// ------------------------- RANKING -------------------------
app.post('/api/scores', async (req, res) => {
  const playerName = String(
    req.body.playerName || 'Jogador'
  ).trim().slice(0, 40) || 'Jogador';

  const score = Number(req.body.score);
  const correctAnswers = Number(req.body.correctAnswers);
  const totalRounds = Number(req.body.totalRounds);

  if (![score, correctAnswers, totalRounds].every(Number.isInteger)) {
    return res.status(400).json({
      error: 'A pontuação enviada é inválida.'
    });
  }

  try {
    const existingScores = await all(
      `SELECT id, score, correct_answers AS correctAnswers
       FROM game_scores
       WHERE player_name = ? COLLATE NOCASE
       ORDER BY score DESC
       LIMIT 1`,
      [playerName]
    );

    const existing = existingScores[0];

    if (!existing) {
      const result = await run(
        `INSERT INTO game_scores
         (player_name, score, correct_answers, total_rounds)
         VALUES (?, ?, ?, ?)`,
        [
          playerName,
          score,
          correctAnswers,
          totalRounds
        ]
      );

      return res.status(201).json({
        id: result.id,
        updated: false
      });
    }

    const improved =
      score > existing.score ||
      (
        score === existing.score &&
        correctAnswers > existing.correctAnswers
      );

    if (improved) {
      await run(
        `UPDATE game_scores
         SET score = ?,
             correct_answers = ?,
             total_rounds = ?,
             created_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          score,
          correctAnswers,
          totalRounds,
          existing.id
        ]
      );
    }

    // Remove registros antigos duplicados desse jogador
    await run(
      `DELETE FROM game_scores
       WHERE player_name = ? COLLATE NOCASE
         AND id <> ?`,
      [playerName, existing.id]
    );

    res.json({
      id: existing.id,
      updated: improved,
      bestScore: improved ? score : existing.score
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: 'Não foi possível salvar a pontuação.'
    });
  }
});

app.get('/api/scores', async (req, res) => {
  const requestedLimit = Number(req.query.limit || 10);
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 50) : 10;
  try {
    const scores = await all(
      `SELECT
         gs.id,
         gs.player_name AS playerName,
         gs.score,
         gs.correct_answers AS correctAnswers,
         gs.total_rounds AS totalRounds,
         gs.created_at AS createdAt,
         COALESCE(p.avatar, 'exploradora') AS avatar
       FROM game_scores gs
       LEFT JOIN players p
         ON p.player_name = gs.player_name COLLATE NOCASE
       ORDER BY gs.score DESC, gs.correct_answers DESC, gs.id ASC
       LIMIT ?`,
      [limit]
    );
    res.json({ scores });
  } catch (error) {
    res.status(500).json({ error: 'Não foi possível carregar o ranking.' });
  }
});

initializeDatabase()
  .then(() => app.listen(PORT, () => console.log(`Libras Play aberto em http://localhost:${PORT}`)))
  .catch((error) => {
    console.error('Erro ao preparar o banco:', error);
    process.exit(1);
  });

process.on('SIGINT', () => db.close(() => process.exit(0)));
