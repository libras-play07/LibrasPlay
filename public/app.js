const ALFABETO_LIBRAS = Array.from({ length: 26 }, (_, index) => `Letra ${String.fromCharCode(65 + index)}`);
const MOVEMENT_LABELS = [7, 9, 10, 23, 24, 25]; // H, J, K, X, Y e Z
const API = '/api';
const GAME_TOTAL_ROUNDS = 10;
const GAME_SECONDS = 10;
const MIN_CONFIDENCE = 0.85;
const REQUIRED_CONFIRMATIONS = 5;
const MOVEMENT_FRAMES = 30;
const MOVEMENT_FEATURES = 67;

const elements = {
  video: document.getElementById('webcam'),
  canvas: document.getElementById('output_canvas'),
  handStatus: document.getElementById('hand-status'),
  handBadge: document.getElementById('hand-badge'),
  modelBadge: document.getElementById('model-badge'),
  movementModelBadge: document.getElementById('movement-model-badge'),
  sampleCount: document.getElementById('sample-count'),
  movementCount: document.getElementById('movement-count'),
  databaseStatus: document.getElementById('database-status'),
  labelSelect: document.getElementById('label-select'),
  btnCollect: document.getElementById('btn-collect'),
  btnTrain: document.getElementById('btn-train'),
  btnTrainMovement: document.getElementById('btn-train-movement'),
  btnDeleteSignal: document.getElementById('btn-delete-signal'),
  btnClearAll: document.getElementById('btn-clear-all'),
  predictionResult: document.getElementById('prediction-result'),
  predictionConfidence: document.getElementById('prediction-confidence'),
  movementStatus: document.getElementById('movement-status'),
  trainingMessage: document.getElementById('training-message'),
  signalTypeCard: document.getElementById('signal-type-card'),
  signalTypeTitle: document.getElementById('signal-type-title'),
  signalTypeDescription: document.getElementById('signal-type-description'),
  tabTraining: document.getElementById('tab-training'),
  tabGame: document.getElementById('tab-game'),
  trainingPanel: document.getElementById('training-panel'),
  gamePanel: document.getElementById('game-panel'),
  playerName: document.getElementById('player-name'),
  librixBalance: document.getElementById('librix-balance'),
  librixEarned: document.getElementById('librix-earned'),
  btnOpenShop: document.getElementById('btn-open-shop'),
  gameScore: document.getElementById('game-score'),
  gameRound: document.getElementById('game-round'),
  gameCorrect: document.getElementById('game-correct'),
  challengeLetter: document.getElementById('challenge-letter'),
challengeSignalImage: document.getElementById('challenge-signal-image'),
gameTime: document.getElementById('game-time'),
  gameMessage: document.getElementById('game-message'),
  btnStartGame: document.getElementById('btn-start-game'),
  btnStopGame: document.getElementById('btn-stop-game'),
  rankingList: document.getElementById('ranking-list'),
soundCorrect: document.getElementById('sound-correct'),
soundError: document.getElementById('sound-error'),
  modelVersion: document.getElementById('model-version'),
  modelAccuracy: document.getElementById('model-accuracy'),
  modelFolder: document.getElementById('model-folder'),
  movementModelVersion: document.getElementById('movement-model-version'),
  movementModelAccuracy: document.getElementById('movement-model-accuracy'),
  movementModelFolder: document.getElementById('movement-model-folder'),
  trainingModal: document.getElementById('training-modal'),
  trainingModalTitle: document.getElementById('training-modal-title'),
  trainingModalText: document.getElementById('training-modal-text'),
  trainingProgress: document.getElementById('training-progress'),
  trainingPercent: document.getElementById('training-percent'),
  trainingLabelsCount: document.getElementById('training-labels-count'),
  trainingSamplesCount: document.getElementById('training-samples-count'),
  trainingAccuracy: document.getElementById('training-accuracy'),
  btnCloseTrainingModal: document.getElementById('btn-close-training-modal'),
  gameResultModal: document.getElementById('game-result-modal'),
gameResultPlayer: document.getElementById('game-result-player'),
resultScore: document.getElementById('result-score'),
resultCorrect: document.getElementById('result-correct'),
resultLibrix: document.getElementById('result-librix'),
resultRecord: document.getElementById('result-record'),
btnCloseResult: document.getElementById('btn-close-result'),
btnPlayAgain: document.getElementById('btn-play-again')
};

const canvasCtx = elements.canvas.getContext('2d');

let trainingData = [];
let trainingLabels = [];
let labelsWithSamples = [];
let movementData = [];
let movementLabels = [];
let labelsWithMovements = [];
let pendingSamples = [];
let collecting = false;
let collectingMovement = false;
let rawMovementFrames = [];
let lastHandCoordinates = null;
let lastRawLandmarks = null;
let staticModel = null;
let movementModel = null;
let movementWindow = [];
let movementPredictionCooldown = 0;

let gameActive = false;
let roundFinished = false;
let gameScore = 0;
let gameCorrect = 0;
let currentRound = 0;
let currentTargetLabel = null;
let remainingTime = GAME_SECONDS;
let timerId = null;
let lastConfirmedLabel = null;
let confirmationCount = 0;

for (let index = 0; index < ALFABETO_LIBRAS.length; index += 1) {
  const option = document.createElement('option');
  option.value = String(index);
  option.textContent = MOVEMENT_LABELS.includes(index)
    ? `${ALFABETO_LIBRAS[index]} — movimento`
    : ALFABETO_LIBRAS[index];
  elements.labelSelect.appendChild(option);
}

function isMovementLabel(label) {
  return MOVEMENT_LABELS.includes(Number(label));
}

function setMessage(element, text, type = '') {
  element.textContent = text;
  element.className = `info-box${type ? ` ${type}` : ''}`;
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Erro de comunicação com o servidor.');
  return body;
}

function getActivePlayer() {
  try {
    return JSON.parse(localStorage.getItem('librasPlayActivePlayer') || 'null');
  } catch {
    return null;
  }
}

function currentPlayerName() {
  const activePlayer = getActivePlayer();
  return activePlayer?.playerName || 'Jogador';
}

function applyActivePlayer() {
  const activePlayer = getActivePlayer();

  if (!activePlayer) {
    window.location.href = 'perfil.html';
    return;
  }

  if (elements.playerName) {
    elements.playerName.value = activePlayer.playerName;
    elements.playerName.readOnly = true;
  }

  const chip = document.getElementById('game-player-chip');
  if (chip) {
    const icons = {
      exploradora: '🧭',
      atleta: '⚽',
      estudante: '🎓'
    };

    chip.innerHTML = `${icons[activePlayer.avatar] || '🧭'} <span>${activePlayer.playerName}</span>`;
  }
}

async function loadLibrixBalance() {
  if (!elements.librixBalance) return;

  try {
    const data = await apiRequest(
      `${API}/librix?playerName=${encodeURIComponent(currentPlayerName())}`
    );
    elements.librixBalance.textContent = String(data.balance || 0);
  } catch {
    elements.librixBalance.textContent = '0';
  }
}

async function rewardLibrix() {
  if (!elements.librixBalance) return null;

  const data = await apiRequest(`${API}/librix/reward`, {
    method: 'POST',
    body: JSON.stringify({
      playerName: currentPlayerName(),
      correctAnswers: gameCorrect,
      totalRounds: currentRound
    })
  });

  elements.librixBalance.textContent = String(data.balance);

  if (elements.librixEarned) {
    elements.librixEarned.textContent = `+${data.earned}`;
    elements.librixEarned.classList.add('show');

    window.setTimeout(() => {
      elements.librixEarned.classList.remove('show');
    }, 2200);
  }

  return data;
}

function updateSignalModeUI() {
  const label = Number(elements.labelSelect.value);
  const movement = isMovementLabel(label);
  elements.signalTypeCard.classList.toggle('movement', movement);
  elements.signalTypeTitle.textContent = movement ? 'Letra com movimento' : 'Letra estática';
  elements.signalTypeDescription.textContent = movement
    ? 'Faça o movimento completo durante 2,5 segundos. Cada gravação vale uma sequência.'
    : 'Mantenha o formato da mão e varie posição e inclinação durante 5 segundos.';
  elements.btnCollect.textContent = movement ? 'Gravar 1 movimento (2,5s)' : 'Gravar amostras (5s)';
}

elements.labelSelect.addEventListener('change', updateSignalModeUI);
updateSignalModeUI();

async function loadSamples() {
  try {
    elements.databaseStatus.textContent = 'Conectado';
    const [staticResponse, movementResponse] = await Promise.all([
      apiRequest(`${API}/samples`),
      apiRequest(`${API}/movements`)
    ]);
    trainingData = staticResponse.samples.map((sample) => sample.coordinates);
    trainingLabels = staticResponse.samples.map((sample) => sample.label);
    movementData = movementResponse.samples.map((sample) => sample.frames);
    movementLabels = movementResponse.samples.map((sample) => sample.label);
    updateDatasetState();
  } catch (error) {
    elements.databaseStatus.textContent = 'Desconectado';
    setMessage(elements.trainingMessage, `${error.message} Inicie o servidor com npm start.`, 'error');
  }
}

function updateDatasetState() {
  elements.sampleCount.textContent = String(trainingData.length);
  elements.movementCount.textContent = String(movementData.length);
  labelsWithSamples = [...new Set(trainingLabels)].sort((a, b) => a - b);
  labelsWithMovements = [...new Set(movementLabels)].sort((a, b) => a - b);
  elements.btnTrain.disabled = trainingData.length === 0 || labelsWithSamples.length < 2;
  elements.btnTrainMovement.disabled = movementData.length === 0 || labelsWithMovements.length < 2;

  const playableLabels = getPlayableLabels();
  if (!gameActive) {
    elements.btnStartGame.disabled = playableLabels.length < 2;
    if (playableLabels.length < 2) {
      setMessage(elements.gameMessage, 'Treine pelo menos duas letras e seus respectivos modelos para liberar o jogo.', 'warning');
    } else {
      setMessage(elements.gameMessage, `${playableLabels.length} letras disponíveis. Clique em iniciar jogo.`);
    }
  }
}

function updateModelInfo(metadata = null, movement = false) {
  const version = movement ? elements.movementModelVersion : elements.modelVersion;
  const accuracy = movement ? elements.movementModelAccuracy : elements.modelAccuracy;
  const folder = movement ? elements.movementModelFolder : elements.modelFolder;
  if (!metadata) {
    version.textContent = 'Nenhum';
    accuracy.textContent = '—';
    folder.textContent = '—';
    return;
  }
  version.textContent = `v${metadata.version}`;
  accuracy.textContent = Number.isFinite(Number(metadata.accuracy))
    ? `${(Number(metadata.accuracy) * 100).toFixed(1)}%`
    : '—';
  folder.textContent = `modelos/${metadata.folderName}`;
}

async function loadSavedModels() {
  try {
    const metadata = await apiRequest(`${API}/model/static/current`);
    staticModel = await tf.loadLayersModel(metadata.modelUrl);
    elements.modelBadge.textContent = `IA estática • v${metadata.version}`;
    elements.btnTrain.textContent = 'Treinar nova IA estática';
    updateModelInfo(metadata, false);
  } catch {
    elements.modelBadge.textContent = 'IA estática não treinada';
    updateModelInfo(null, false);
  }

  try {
    const metadata = await apiRequest(`${API}/model/movement/current`);
    movementModel = await tf.loadLayersModel(metadata.modelUrl);
    const outputClasses = movementModel.outputs?.[0]?.shape?.at(-1);
    if (outputClasses !== MOVEMENT_LABELS.length) {
      movementModel.dispose();
      movementModel = null;
      throw new Error('O modelo de movimento antigo precisa ser treinado novamente para as 6 letras.');
    }
    elements.movementModelBadge.textContent = `IA movimento • v${metadata.version}`;
    elements.btnTrainMovement.textContent = 'Treinar nova IA de movimento';
    updateModelInfo(metadata, true);
  } catch {
    elements.movementModelBadge.textContent = 'IA de movimento não treinada';
    updateModelInfo(null, true);
  }
  updateDatasetState();
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

async function saveModelToServer(trainedModel, metadata, movement = false) {
  let savedResult = null;
  const endpoint = movement ? `${API}/model/movement/save` : `${API}/model/save`;
  await trainedModel.save(tf.io.withSaveHandler(async (artifacts) => {
    savedResult = await apiRequest(endpoint, {
      method: 'POST',
      body: JSON.stringify({
        modelTopology: artifacts.modelTopology,
        weightSpecs: artifacts.weightSpecs,
        weightDataBase64: arrayBufferToBase64(artifacts.weightData),
        metadata
      })
    });
    return {
      modelArtifactsInfo: {
        dateSaved: new Date(),
        modelTopologyType: 'JSON',
        modelTopologyBytes: JSON.stringify(artifacts.modelTopology).length,
        weightSpecsBytes: JSON.stringify(artifacts.weightSpecs).length,
        weightDataBytes: artifacts.weightData.byteLength
      }
    };
  }));
  return savedResult;
}

function openTrainingModal(title, labelsCount, sampleCount) {
  elements.trainingModal.classList.remove('hidden');
  elements.btnCloseTrainingModal.classList.add('hidden');
  elements.trainingModalTitle.textContent = title;
  elements.trainingModalText.textContent = 'Preparando os dados...';
  elements.trainingProgress.style.width = '0%';
  elements.trainingPercent.textContent = '0%';
  elements.trainingLabelsCount.textContent = String(labelsCount);
  elements.trainingSamplesCount.textContent = String(sampleCount);
  elements.trainingAccuracy.textContent = '0%';
}

function finishTrainingModal(success, text) {
  elements.trainingModalTitle.textContent = success ? 'IA treinada com sucesso! ✅' : 'Falha no treinamento';
  elements.trainingModalText.textContent = text;
  if (success) {
    elements.trainingProgress.style.width = '100%';
    elements.trainingPercent.textContent = '100%';
  }
  elements.btnCloseTrainingModal.classList.remove('hidden');
}

elements.btnCloseTrainingModal.addEventListener('click', () => elements.trainingModal.classList.add('hidden'));

function normalizeLandmarks(landmarks) {
  const wrist = landmarks[0];
  const middleBase = landmarks[9];
  const dx = middleBase.x - wrist.x;
  const dy = middleBase.y - wrist.y;
  const dz = middleBase.z - wrist.z;
  const scale = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  return landmarks.flatMap((point) => [
    (point.x - wrist.x) / scale,
    (point.y - wrist.y) / scale,
    (point.z - wrist.z) / scale
  ]);
}

function movementFeatures(landmarks) {
  const normalized = normalizeLandmarks(landmarks);
  const wrist = landmarks[0];
  const indexTip = landmarks[8];
  return [...normalized, wrist.x, wrist.y, indexTip.x, indexTip.y];
}

function resampleFrames(frames, targetLength = MOVEMENT_FRAMES) {
  if (frames.length === targetLength) return frames.map((frame) => [...frame]);
  if (frames.length < 2) throw new Error('Poucos frames capturados. Mantenha a mão visível durante todo o movimento.');
  const result = [];
  for (let i = 0; i < targetLength; i += 1) {
    const position = (i * (frames.length - 1)) / (targetLength - 1);
    const left = Math.floor(position);
    const right = Math.min(Math.ceil(position), frames.length - 1);
    const ratio = position - left;
    result.push(frames[left].map((value, index) => value + (frames[right][index] - value) * ratio));
  }
  return result;
}

function drawHand(landmarks) {
  const connections = [
    [0,1], [1,2], [2,3], [3,4], [0,5], [5,6], [6,7], [7,8],
    [5,9], [9,10], [10,11], [11,12], [9,13], [13,14], [14,15],
    [15,16], [13,17], [0,17], [17,18], [18,19], [19,20]
  ];
  canvasCtx.strokeStyle = '#8257e5';
  canvasCtx.lineWidth = 4;
  for (const [from, to] of connections) {
    canvasCtx.beginPath();
    canvasCtx.moveTo(landmarks[from].x * elements.canvas.width, landmarks[from].y * elements.canvas.height);
    canvasCtx.lineTo(landmarks[to].x * elements.canvas.width, landmarks[to].y * elements.canvas.height);
    canvasCtx.stroke();
  }
  canvasCtx.fillStyle = '#00d69a';
  for (const point of landmarks) {
    canvasCtx.beginPath();
    canvasCtx.arc(point.x * elements.canvas.width, point.y * elements.canvas.height, 5, 0, Math.PI * 2);
    canvasCtx.fill();
  }
}

function onResults(results) {
  canvasCtx.clearRect(0, 0, elements.canvas.width, elements.canvas.height);
  const landmarks = results.multiHandLandmarks?.[0];

  if (!landmarks) {
    elements.handStatus.textContent = 'Nenhuma mão visível';
    elements.handBadge.textContent = '● Procurando mão';
    elements.handBadge.classList.add('badge-danger');
    lastHandCoordinates = null;
    lastRawLandmarks = null;
    confirmationCount = 0;
    return;
  }

  elements.handStatus.textContent = 'Mão detectada';
  elements.handBadge.textContent = '● Mão detectada';
  elements.handBadge.classList.remove('badge-danger');
  lastRawLandmarks = landmarks;
  lastHandCoordinates = normalizeLandmarks(landmarks);
  drawHand(landmarks);

  if (collecting) {
    pendingSamples.push({
      label: Number(elements.labelSelect.value),
      coordinates: [...lastHandCoordinates]
    });
    elements.sampleCount.textContent = String(trainingData.length + pendingSamples.length);
    return;
  }

  const features = movementFeatures(landmarks);
  movementWindow.push(features);
  if (movementWindow.length > MOVEMENT_FRAMES) movementWindow.shift();

  if (collectingMovement) {
    rawMovementFrames.push(features);
    elements.movementStatus.textContent = `Movimento: ${rawMovementFrames.length} frames`;
    return;
  }

  if (staticModel) predictStatic(lastHandCoordinates);

  movementPredictionCooldown -= 1;
  const shouldPredictMovement = movementModel && movementWindow.length === MOVEMENT_FRAMES && movementPredictionCooldown <= 0;
  if (shouldPredictMovement) {
    movementPredictionCooldown = 8;
    predictMovement(movementWindow);
  }
}

const hands = new Hands({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});

hands.setOptions({
  maxNumHands: 1,
  modelComplexity: 1,
  minDetectionConfidence: 0.7,
  minTrackingConfidence: 0.7
});
hands.onResults(onResults);

const camera = new Camera(elements.video, {
  onFrame: async () => hands.send({ image: elements.video }),
  width: 640,
  height: 480
});
camera.start().catch(() => setMessage(elements.trainingMessage, 'Não foi possível abrir a câmera. Autorize o acesso.', 'error'));

async function collectStaticSamples() {
  collecting = true;
  pendingSamples = [];
  elements.btnCollect.disabled = true;
  elements.btnCollect.textContent = `Gravando ${ALFABETO_LIBRAS[Number(elements.labelSelect.value)]}...`;
  setMessage(elements.trainingMessage, 'Mova e incline levemente a mão durante os 5 segundos.', 'warning');

  window.setTimeout(async () => {
    collecting = false;
    elements.btnCollect.textContent = 'Salvando amostras...';
    try {
      if (pendingSamples.length === 0) throw new Error('Nenhuma mão foi detectada durante a gravação.');
      await apiRequest(`${API}/samples/batch`, {
        method: 'POST',
        body: JSON.stringify({ samples: pendingSamples })
      });
      trainingData.push(...pendingSamples.map((item) => item.coordinates));
      trainingLabels.push(...pendingSamples.map((item) => item.label));
      setMessage(elements.trainingMessage, `${pendingSamples.length} amostras estáticas salvas no SQLite.`, 'success');
      pendingSamples = [];
      updateDatasetState();
    } catch (error) {
      elements.sampleCount.textContent = String(trainingData.length);
      setMessage(elements.trainingMessage, error.message, 'error');
    } finally {
      elements.btnCollect.disabled = false;
      updateSignalModeUI();
    }
  }, 5000);
}

async function collectMovementSample() {
  if (!lastRawLandmarks) {
    setMessage(elements.trainingMessage, 'Mostre a mão para a câmera antes de iniciar.', 'error');
    return;
  }
  collectingMovement = true;
  rawMovementFrames = [];
  movementWindow = [];
  elements.btnCollect.disabled = true;
  elements.btnCollect.textContent = '3...';
  setMessage(elements.trainingMessage, 'Prepare a posição inicial. A gravação começará em 3 segundos.', 'warning');

  for (let count = 3; count >= 1; count -= 1) {
    elements.btnCollect.textContent = `${count}...`;
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  elements.btnCollect.textContent = 'GRAVANDO MOVIMENTO...';
  elements.movementStatus.textContent = 'Movimento: gravando';

  await new Promise((resolve) => setTimeout(resolve, 2500));
  collectingMovement = false;
  elements.btnCollect.textContent = 'Processando movimento...';

  try {
    const frames = resampleFrames(rawMovementFrames, MOVEMENT_FRAMES);
    const label = Number(elements.labelSelect.value);
    await apiRequest(`${API}/movements`, {
      method: 'POST',
      body: JSON.stringify({ label, frames })
    });
    movementData.push(frames);
    movementLabels.push(label);
    elements.movementStatus.textContent = 'Movimento: salvo';
    setMessage(elements.trainingMessage, `1 sequência de ${ALFABETO_LIBRAS[label]} salva. Grave várias repetições.`, 'success');
    updateDatasetState();
  } catch (error) {
    elements.movementStatus.textContent = 'Movimento: falhou';
    setMessage(elements.trainingMessage, error.message, 'error');
  } finally {
    rawMovementFrames = [];
    elements.btnCollect.disabled = false;
    updateSignalModeUI();
  }
}

elements.btnCollect.addEventListener('click', async () => {
  if (collecting || collectingMovement) return;
  const label = Number(elements.labelSelect.value);
  if (isMovementLabel(label)) await collectMovementSample();
  else await collectStaticSamples();
});

elements.btnDeleteSignal.addEventListener('click', async () => {
  const label = Number(elements.labelSelect.value);
  if (!confirm(`Excluir todos os dados de ${ALFABETO_LIBRAS[label]}?`)) return;
  try {
    if (isMovementLabel(label)) {
      const result = await apiRequest(`${API}/movements/${label}`, { method: 'DELETE' });
      const newData = [];
      const newLabels = [];
      movementLabels.forEach((currentLabel, index) => {
        if (currentLabel !== label) {
          newLabels.push(currentLabel);
          newData.push(movementData[index]);
        }
      });
      movementData = newData;
      movementLabels = newLabels;
      setMessage(elements.trainingMessage, `${result.deleted} movimentos excluídos. Treine a IA de movimento novamente.`, 'success');
    } else {
      const result = await apiRequest(`${API}/samples/${label}`, { method: 'DELETE' });
      const newData = [];
      const newLabels = [];
      trainingLabels.forEach((currentLabel, index) => {
        if (currentLabel !== label) {
          newLabels.push(currentLabel);
          newData.push(trainingData[index]);
        }
      });
      trainingData = newData;
      trainingLabels = newLabels;
      setMessage(elements.trainingMessage, `${result.deleted} amostras excluídas. Treine a IA estática novamente.`, 'success');
    }
    updateDatasetState();
  } catch (error) {
    setMessage(elements.trainingMessage, error.message, 'error');
  }
});

elements.btnClearAll.addEventListener('click', async () => {
  if (!confirm('Apagar todas as amostras estáticas e todos os movimentos do banco?')) return;
  try {
    await Promise.all([
      apiRequest(`${API}/samples`, { method: 'DELETE' }),
      apiRequest(`${API}/movements`, { method: 'DELETE' })
    ]);
    trainingData = [];
    trainingLabels = [];
    movementData = [];
    movementLabels = [];
    updateDatasetState();
    setMessage(elements.trainingMessage, 'O banco de treinamento foi limpo.', 'success');
  } catch (error) {
    setMessage(elements.trainingMessage, error.message, 'error');
  }
});

async function trainStaticModel() {
  if (trainingData.length === 0 || labelsWithSamples.length < 2) return;
  elements.btnTrain.disabled = true;
  openTrainingModal('Treinando IA estática', labelsWithSamples.length, trainingData.length);

  const xTrain = tf.tensor2d(trainingData);
  const labelTensor = tf.tensor1d(trainingLabels, 'int32');
  const yTrain = tf.oneHot(labelTensor, ALFABETO_LIBRAS.length);
  let lastAccuracy = 0;
  let lastLoss = null;

  try {
    const newModel = tf.sequential();
    newModel.add(tf.layers.dense({ units: 256, activation: 'relu', inputShape: [63] }));
    newModel.add(tf.layers.dropout({ rate: 0.2 }));
    newModel.add(tf.layers.dense({ units: 128, activation: 'relu' }));
    newModel.add(tf.layers.dropout({ rate: 0.15 }));
    newModel.add(tf.layers.dense({ units: 64, activation: 'relu' }));
    newModel.add(tf.layers.dense({ units: ALFABETO_LIBRAS.length, activation: 'softmax' }));
    newModel.compile({ optimizer: tf.train.adam(0.0005), loss: 'categoricalCrossentropy', metrics: ['accuracy'] });

    const epochs = 60;
    await newModel.fit(xTrain, yTrain, {
      epochs,
      batchSize: 32,
      shuffle: true,
      validationSplit: trainingData.length >= 100 ? 0.15 : 0,
      callbacks: {
        onEpochEnd: async (epoch, logs) => {
          lastAccuracy = Number(logs.val_acc ?? logs.val_accuracy ?? logs.acc ?? logs.accuracy ?? 0);
          lastLoss = Number(logs.val_loss ?? logs.loss ?? 0);
          updateTrainingProgress(epoch, epochs, lastAccuracy);
          await tf.nextFrame();
        }
      }
    });

    const saved = await saveModelToServer(newModel, {
      accuracy: lastAccuracy,
      loss: lastLoss,
      sampleCount: trainingData.length,
      trainedLabels: labelsWithSamples
    }, false);

    if (staticModel) staticModel.dispose();
    staticModel = newModel;
    elements.modelBadge.textContent = `IA estática • v${saved.version}`;
    updateModelInfo(saved.metadata, false);
    setMessage(elements.trainingMessage, `Modelo estático salvo em modelos/${saved.folderName}.`, 'success');
    finishTrainingModal(true, `Modelo estático v${saved.version} salvo.`);
  } catch (error) {
    console.error(error);
    setMessage(elements.trainingMessage, `Falha no treinamento: ${error.message}`, 'error');
    finishTrainingModal(false, error.message);
  } finally {
    xTrain.dispose();
    labelTensor.dispose();
    yTrain.dispose();
    elements.btnTrain.disabled = false;
    elements.btnTrain.textContent = staticModel ? 'Treinar nova IA estática' : 'Treinar IA estática';
    updateDatasetState();
  }
}

async function trainMovementModel() {
  if (movementData.length === 0 || labelsWithMovements.length < 2) {
    setMessage(elements.trainingMessage, 'Grave movimentos de pelo menos duas letras entre H, J, K, X, Y e Z antes de treinar.', 'error');
    return;
  }
  const labelsInsuficientes = labelsWithMovements.filter(
    (label) => movementLabels.filter((item) => item === label).length < 5
  );
  if (labelsInsuficientes.length > 0) {
    const nomes = labelsInsuficientes.map((label) => ALFABETO_LIBRAS[label]).join(', ');
    setMessage(elements.trainingMessage, `Grave pelo menos 5 movimentos de cada letra treinada. Faltam: ${nomes}. Para boa precisão, use 30 ou mais de cada.`, 'warning');
    return;
  }

  elements.btnTrainMovement.disabled = true;
  openTrainingModal('Treinando IA de movimento', labelsWithMovements.length, movementData.length);

  const mappedLabels = movementLabels.map((label) => MOVEMENT_LABELS.indexOf(label));
  const xTrain = tf.tensor3d(movementData, [movementData.length, MOVEMENT_FRAMES, MOVEMENT_FEATURES]);
  const labelTensor = tf.tensor1d(mappedLabels, 'int32');
  const yTrain = tf.oneHot(labelTensor, MOVEMENT_LABELS.length);
  let lastAccuracy = 0;
  let lastLoss = null;

  try {
    const newModel = tf.sequential();
    newModel.add(tf.layers.lstm({ inputShape: [MOVEMENT_FRAMES, MOVEMENT_FEATURES], units: 64, returnSequences: false }));
    newModel.add(tf.layers.dropout({ rate: 0.25 }));
    newModel.add(tf.layers.dense({ units: 32, activation: 'relu' }));
    newModel.add(tf.layers.dropout({ rate: 0.15 }));
    newModel.add(tf.layers.dense({ units: MOVEMENT_LABELS.length, activation: 'softmax' }));
    newModel.compile({ optimizer: tf.train.adam(0.001), loss: 'categoricalCrossentropy', metrics: ['accuracy'] });

    const epochs = 80;
    await newModel.fit(xTrain, yTrain, {
      epochs,
      batchSize: Math.min(16, movementData.length),
      shuffle: true,
      validationSplit: movementData.length >= 20 ? 0.2 : 0,
      callbacks: {
        onEpochEnd: async (epoch, logs) => {
          lastAccuracy = Number(logs.val_acc ?? logs.val_accuracy ?? logs.acc ?? logs.accuracy ?? 0);
          lastLoss = Number(logs.val_loss ?? logs.loss ?? 0);
          updateTrainingProgress(epoch, epochs, lastAccuracy);
          await tf.nextFrame();
        }
      }
    });

    const saved = await saveModelToServer(newModel, {
      accuracy: lastAccuracy,
      loss: lastLoss,
      sampleCount: movementData.length,
      trainedLabels: labelsWithMovements
    }, true);

    if (movementModel) movementModel.dispose();
    movementModel = newModel;
    elements.movementModelBadge.textContent = `IA movimento • v${saved.version}`;
    updateModelInfo(saved.metadata, true);
    setMessage(elements.trainingMessage, `Modelo de movimento salvo em modelos/${saved.folderName}.`, 'success');
    finishTrainingModal(true, `Modelo de movimento v${saved.version} salvo.`);
  } catch (error) {
    console.error(error);
    setMessage(elements.trainingMessage, `Falha no movimento: ${error.message}`, 'error');
    finishTrainingModal(false, error.message);
  } finally {
    xTrain.dispose();
    labelTensor.dispose();
    yTrain.dispose();
    elements.btnTrainMovement.disabled = false;
    elements.btnTrainMovement.textContent = movementModel ? 'Treinar nova IA de movimento' : 'Treinar IA de movimento';
    updateDatasetState();
  }
}

function updateTrainingProgress(epoch, epochs, accuracy) {
  const percent = Math.round(((epoch + 1) / epochs) * 100);
  elements.trainingProgress.style.width = `${percent}%`;
  elements.trainingPercent.textContent = `${percent}%`;
  elements.trainingAccuracy.textContent = `${(accuracy * 100).toFixed(1)}%`;
  elements.trainingModalText.textContent = `Época ${epoch + 1} de ${epochs}`;
}

elements.btnTrain.addEventListener('click', trainStaticModel);
elements.btnTrainMovement.addEventListener('click', trainMovementModel);

function predictStatic(coordinates) {
  tf.tidy(() => {
    const input = tf.tensor2d([coordinates]);
    const prediction = staticModel.predict(input);
    const values = prediction.dataSync();
    let predictedLabel = 0;
    let confidence = values[0];
    for (let index = 1; index < values.length; index += 1) {
      if (values[index] > confidence) {
        confidence = values[index];
        predictedLabel = index;
      }
    }

    if (!isMovementLabel(predictedLabel)) {
      elements.predictionResult.textContent = ALFABETO_LIBRAS[predictedLabel] || '---';
      elements.predictionConfidence.textContent = `Confiança: ${(confidence * 100).toFixed(1)}%`;
    }
    if (gameActive && !isMovementLabel(currentTargetLabel)) verifyGameAnswer(predictedLabel, confidence);
  });
}

function predictMovement(frames) {
  tf.tidy(() => {
    const input = tf.tensor3d([frames], [1, MOVEMENT_FRAMES, MOVEMENT_FEATURES]);
    const prediction = movementModel.predict(input);
    const values = prediction.dataSync();
    let classIndex = 0;
    let confidence = values[0];
    for (let index = 1; index < values.length; index += 1) {
      if (values[index] > confidence) {
        confidence = values[index];
        classIndex = index;
      }
    }
    const predictedLabel = MOVEMENT_LABELS[classIndex];
    elements.movementStatus.textContent = `Movimento: ${ALFABETO_LIBRAS[predictedLabel]} ${(confidence * 100).toFixed(0)}%`;

    if (gameActive && isMovementLabel(currentTargetLabel)) {
      verifyGameAnswer(predictedLabel, confidence, true);
    }
  });
}

function switchMode(mode) {
  const training = mode === 'training';
  elements.tabTraining.classList.toggle('active', training);
  elements.tabGame.classList.toggle('active', !training);
  elements.trainingPanel.classList.toggle('active', training);
  elements.gamePanel.classList.toggle('active', !training);
}

elements.tabTraining.addEventListener('click', () => switchMode('training'));
elements.tabGame.addEventListener('click', () => switchMode('game'));

const initialPageMode = document.body.dataset.pageMode;
if (initialPageMode === 'game' || initialPageMode === 'training') {
  switchMode(initialPageMode);
}

function getPlayableLabels() {
  const labels = [];
  if (staticModel) labels.push(...labelsWithSamples);
  if (movementModel) labels.push(...labelsWithMovements);
  return [...new Set(labels)].sort((a, b) => a - b);
}

function chooseRandomTarget() {
  const playable = getPlayableLabels();
  const candidates = playable.filter((label) => label !== currentTargetLabel);
  const source = candidates.length ? candidates : playable;
  return source[Math.floor(Math.random() * source.length)];
}

function resetConfirmations() {
  lastConfirmedLabel = null;
  confirmationCount = 0;
  movementWindow = [];
}

function updateChallengeSignalImage(label) {
  const image = elements.challengeSignalImage;

  if (!image) return;

  if (
    label === null ||
    label === undefined ||
    Number.isNaN(Number(label))
  ) {
    image.removeAttribute('src');
    image.alt = '';
    image.style.display = 'none';
    return;
  }

  const letter = String.fromCharCode(65 + Number(label));

  image.alt = `Exemplo do sinal da letra ${letter}`;
  image.style.display = 'block';

  image.onload = () => {
    image.style.display = 'block';
  };

  image.onerror = () => {
    image.removeAttribute('src');
    image.alt = '';
    image.style.display = 'none';
  };

  image.src = `img/sinais/${letter}.png`;
}

/* NÃO APAGUE ESTA FUNÇÃO */
function updateGameDisplay() {
  elements.gameScore.textContent = String(gameScore);
  elements.gameCorrect.textContent = String(gameCorrect);
  elements.gameRound.textContent =
    `${currentRound}/${GAME_TOTAL_ROUNDS}`;
  elements.gameTime.textContent = String(remainingTime);
}

async function startGame() {
  if (getPlayableLabels().length < 2) {
    return;
  }

  elements.btnStartGame.disabled = true;
  elements.btnStopGame.disabled = true;

  for (let countdown = 3; countdown >= 1; countdown -= 1) {
    setMessage(
      elements.gameMessage,
      `Jogo iniciando em ${countdown}...`,
      'warning'
    );

    elements.challengeLetter.textContent = String(countdown);
    elements.gameTime.textContent = String(countdown);

    await new Promise((resolve) => {
      window.setTimeout(resolve, 1000);
    });
  }

  setMessage(
    elements.gameMessage,
    'Vai!',
    'success'
  );

  elements.challengeLetter.textContent = 'VAI!';

  await new Promise((resolve) => {
    window.setTimeout(resolve, 600);
  });

  beginGame();
}

function beginGame() {
  loadLibrixBalance();

  clearInterval(timerId);

  gameActive = true;
  roundFinished = false;
  gameScore = 0;
  gameCorrect = 0;
  currentRound = 0;
  currentTargetLabel = null;
  remainingTime = GAME_SECONDS;
  lastConfirmedLabel = null;
  confirmationCount = 0;
  movementWindow = [];

  elements.challengeLetter.textContent = '?';
  updateChallengeSignalImage(null);

  elements.btnStartGame.disabled = true;
  elements.btnStopGame.disabled = false;

  updateGameDisplay();
  nextRound();
}

function nextRound() {
  clearInterval(timerId);
  if (!gameActive) return;
  if (currentRound >= GAME_TOTAL_ROUNDS) {
    finishGame();
    return;
  }

  currentRound += 1;
  roundFinished = false;
  remainingTime = GAME_SECONDS;
  currentTargetLabel = chooseRandomTarget();
  resetConfirmations();
  elements.challengeLetter.textContent = String.fromCharCode(65 + currentTargetLabel);
  updateChallengeSignalImage(currentTargetLabel);
  if (isMovementLabel(currentTargetLabel)) {
    setMessage(elements.gameMessage, `Faça o movimento completo da ${ALFABETO_LIBRAS[currentTargetLabel]}. Mantenha a mão visível.`, 'warning');
  } else {
    setMessage(elements.gameMessage, `Faça o sinal de ${ALFABETO_LIBRAS[currentTargetLabel]}.`);
  }
  updateGameDisplay();

  timerId = setInterval(() => {
    remainingTime -= 1;
    updateGameDisplay();
    if (remainingTime <= 0) timeExpired();
  }, 1000);
}

function verifyGameAnswer(predictedLabel, confidence, movement = false) {
  if (!gameActive || roundFinished) return;
  if (confidence < MIN_CONFIDENCE || predictedLabel !== currentTargetLabel) {
    if (!movement) resetConfirmations();
    return;
  }

  if (movement) {
    markCorrect();
    return;
  }

  if (lastConfirmedLabel === predictedLabel) confirmationCount += 1;
  else {
    lastConfirmedLabel = predictedLabel;
    confirmationCount = 1;
  }
  if (confirmationCount >= REQUIRED_CONFIRMATIONS) markCorrect();
}


function playSound(audio) {
  if (!audio) return;

  audio.currentTime = 0;
  audio.play().catch(() => {});
}

function markCorrect() {
  if (roundFinished) return;

  playSound(elements.soundCorrect);

  roundFinished = true;
  clearInterval(timerId);

  const roundPoints = 10 + remainingTime;
  gameScore += roundPoints;
  gameCorrect += 1;

  updateGameDisplay();

  setMessage(
    elements.gameMessage,
    `Correto! +${roundPoints} pontos.`,
    'success'
  );

  setTimeout(nextRound, 1200);
}
function timeExpired() {
  if (roundFinished) return;

  playSound(elements.soundError);

  roundFinished = true;
  clearInterval(timerId);

  setMessage(
    elements.gameMessage,
    `Tempo esgotado. Era ${ALFABETO_LIBRAS[currentTargetLabel]}.`,
    'error'
  );

  setTimeout(nextRound, 1500);
}

function showGameResult(librixEarned = 0, newRecord = false) {
  if (!elements.gameResultModal) return;

  elements.gameResultPlayer.textContent =
    `Resultado de ${currentPlayerName()}`;

  elements.resultScore.textContent = String(gameScore);

  elements.resultCorrect.textContent =
    `${gameCorrect}/${currentRound}`;

  elements.resultLibrix.textContent =
    `+${librixEarned}`;

  elements.resultRecord.classList.toggle(
    'hidden',
    !newRecord
  );

  elements.gameResultModal.classList.remove('hidden');
} // ← ESTA é a chave final dela


async function finishGame(manual = false) {
  clearInterval(timerId);

  gameActive = false;
  roundFinished = true;

  elements.btnStartGame.disabled = false;
  elements.btnStopGame.disabled = true;

  elements.challengeLetter.textContent = '?';
  updateChallengeSignalImage(null);

  if (manual && currentRound === 0) {
    setMessage(elements.gameMessage, 'Jogo encerrado.');
    return;
  }

  let librixEarned = 0;
  let newRecord = false;

  try {
    const scoreResult = await apiRequest(`${API}/scores`, {
      method: 'POST',
      body: JSON.stringify({
        playerName: currentPlayerName(),
        score: gameScore,
        correctAnswers: gameCorrect,
        totalRounds: currentRound
      })
    });

    newRecord =
      scoreResult.updated === true ||
      scoreResult.created === true;

    const librix = await rewardLibrix();

    librixEarned = Number(librix?.earned || 0);

    await loadRanking();
  } catch (error) {
    console.error('Erro ao finalizar jogo:', error);
  }

  setMessage(
    elements.gameMessage,
    `Fim de jogo: ${gameScore} pontos, ${gameCorrect} acertos e +${librixEarned} Librix!`,
    'success'
  );

  showGameResult(librixEarned, newRecord);
}

async function loadRanking() {
  try {
    const data = await apiRequest(`${API}/scores?limit=5`);
    elements.rankingList.innerHTML = '';
    if (!data.scores.length) {
      elements.rankingList.innerHTML = '<li>Nenhuma partida salva.</li>';
      return;
    }
    for (const item of data.scores) {
      const li = document.createElement('li');
      li.textContent = `${item.playerName}: ${item.score} pontos (${item.correctAnswers}/${item.totalRounds})`;
      elements.rankingList.appendChild(li);
    }
  } catch {
    elements.rankingList.innerHTML = '<li>Ranking indisponível.</li>';
  }
}

elements.btnStartGame.addEventListener('click', startGame);
elements.btnStopGame.addEventListener('click', () => finishGame(true));

if (elements.btnOpenShop) {
  elements.btnOpenShop.addEventListener('click', () => {
    const playerName = encodeURIComponent(currentPlayerName());
    window.location.href = `loja.html?playerName=${playerName}`;
  });
}


(async function initialize() {
  applyActivePlayer();
  await loadSamples();
  await loadSavedModels();
  await loadRanking();
  await loadLibrixBalance();
})();

function showGameResult(librixEarned = 0, newRecord = false) {
  const modal = document.getElementById('game-result-modal');
  const player = document.getElementById('game-result-player');
  const score = document.getElementById('result-score');
  const correct = document.getElementById('result-correct');
  const librix = document.getElementById('result-librix');
  const record = document.getElementById('result-record');

  if (!modal) {
    console.error('Modal de resultado não encontrado.');
    return;
  }

  player.textContent = `Resultado de ${currentPlayerName()}`;
  score.textContent = String(gameScore);
  correct.textContent = `${gameCorrect}/${currentRound}`;
  librix.textContent = `+${librixEarned}`;

  record.classList.toggle('hidden', !newRecord);
  modal.classList.remove('hidden');
}





  document.addEventListener('click', (event) => {
  const closeButton = event.target.closest('#btn-close-result');
  const playAgainButton = event.target.closest('#btn-play-again');

  if (closeButton) {
    document
      .getElementById('game-result-modal')
      ?.classList.add('hidden');

    return;
  }

  if (playAgainButton) {
    document
      .getElementById('game-result-modal')
      ?.classList.add('hidden');

    startGame();
  }
});
