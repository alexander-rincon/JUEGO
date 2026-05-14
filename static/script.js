const ROOM_ID = (window.__ROOM_ID__ || "").toString().trim().toUpperCase();
const MODE = (window.__MODE__ || "duel").toString().trim().toLowerCase();
const MAX_PLAYERS = Number.isFinite(window.__MAX_PLAYERS__) ? Number(window.__MAX_PLAYERS__) : 2;
const PLAYER_KEY = (window.__PLAYER_KEY__ || "").toString().trim();
const SPECTATOR_KEY = (window.__SPECTATOR_KEY__ || "").toString().trim().toUpperCase();
const IS_TOURNAMENT = MODE === "tournament" || MODE === "admin_dashboard";
const IS_LOBBY = MODE === "lobby_admin" || MODE === "lobby_display" || MODE === "lobby_participants";
const IS_DUEL_ADMIN = MODE === "duel_admin";
const SELF_HANDLE = (() => {
  try {
    const sp = new URLSearchParams(window.location.search || "");
    return String(sp.get("h") || "").trim();
  } catch {
    return "";
  }
})();

const $ = (id) => document.getElementById(id);

const connectionPill = $("connectionPill");
const youAre = $("youAre");
const statusText = $("statusText");
const matchScore = $("matchScore");
const countdownLabel = $("countdownLabel");
const countdownValue = $("countdownValue");
const resultBox = $("resultBox");
const resultBig = $("resultBig");
const resultDetail = $("resultDetail");
const shareUrlText = $("shareUrlText");
const shareLink = $("shareLink");
const qrImg = $("qrImg");
const copyBtn = $("copyBtn");
const copyMsg = $("copyMsg");
const p1State = $("p1State");
const p2State = $("p2State");
const p1Name = $("p1Name");
const p2Name = $("p2Name");
const p1Avatar = $("p1Avatar");
const p2Avatar = $("p2Avatar");
const p1Throw = $("p1Throw");
const p2Throw = $("p2Throw");
const p1Card = $("p1Card");
const p2Card = $("p2Card");
const playersBox = $("playersBox");
const duelAdminBox = $("duelAdminBox");
const duelAdminP1Choice = $("duelAdminP1Choice");
const duelAdminP2Choice = $("duelAdminP2Choice");

const tournamentBox = $("tournamentBox");
const tournamentRole = $("tournamentRole");
const startNextBtn = $("startNextBtn");
const generateBracketBtn = $("generateBracketBtn");
const forceBattleBtn = $("forceBattleBtn");
const tournamentCount = $("tournamentCount");
const tournamentPlayersList = $("tournamentPlayersList");
const tournamentActive = $("tournamentActive");
const activeMatchText = $("activeMatchText");
const readyBtn = $("readyBtn");
const bracketList = $("bracketList");
const throwsBox = $("throwsBox");
const throwP1Card = $("throwP1Card");
const throwP1Name = $("throwP1Name");
const throwP1Icon = $("throwP1Icon");
const throwP1Text = $("throwP1Text");
const throwP2Card = $("throwP2Card");
const throwP2Name = $("throwP2Name");
const throwP2Icon = $("throwP2Icon");
const throwP2Text = $("throwP2Text");
const audioArmBtn = $("audioArmBtn");

const lobbyRequiredValue = $("lobbyRequiredValue");
const lobbyTotalValue = $("lobbyTotalValue");
const lobbyTables = $("lobbyTables");
const lobbyPending = $("lobbyPending");
const lobbyWinners = $("lobbyWinners");

const lobbyRequiredInput = $("lobbyRequiredInput");
const lobbySetRequiredBtn = $("lobbySetRequiredBtn");
const lobbyEditDuelBtn = $("lobbyEditDuelBtn");
const lobbyStartDuelsBtn = $("lobbyStartDuelsBtn");
const duelConfigModal = $("duelConfigModal");
const duelConfigBattleInput = $("duelConfigBattleInput");
const duelConfigCountdownInput = $("duelConfigCountdownInput");
const duelConfigPrizeInput = $("duelConfigPrizeInput");
const duelConfigSaveBtn = $("duelConfigSaveBtn");
const duelConfigCloseBtn = $("duelConfigCloseBtn");
const lobbyRoutesBtn = $("lobbyRoutesBtn");
const lobbyHackBtn = $("lobbyHackBtn");
const lobbyBotsBtn = $("lobbyBotsBtn");
const routesModal = $("routesModal");
const routesText = $("routesText");
const routesCopyBtn = $("routesCopyBtn");
const routesCloseBtn = $("routesCloseBtn");
const botsModal = $("botsModal");
const botsFill2Btn = $("botsFill2Btn");
const botsFill5Btn = $("botsFill5Btn");
const botsFill10Btn = $("botsFill10Btn");
const botsCloseBtn = $("botsCloseBtn");
const lobbyOpenLiveModalBtn = $("lobbyOpenLiveModalBtn");
const liveModal = $("liveModal");
const lobbyLiveCloseBtn = $("lobbyLiveCloseBtn");
const lobbyLiveHandle = $("lobbyLiveHandle");
const lobbyLiveConnectBtn = $("lobbyLiveConnectBtn");
const lobbyResetBtn = $("lobbyResetBtn");
const lobbyBracketShuffleBtn = $("lobbyBracketShuffleBtn");
const lobbyGenerateMatchCodesBtn = $("lobbyGenerateMatchCodesBtn");
const lobbyRegenAllMatchCodesBtn = $("lobbyRegenAllMatchCodesBtn");
const lobbyCopyAllMatchCodesBtn = $("lobbyCopyAllMatchCodesBtn");
const lobbyMatchCodes = $("lobbyMatchCodes");
const lobbyAllMatchCodesText = $("lobbyAllMatchCodesText");
const lobbyDonorHandle = $("lobbyDonorHandle");
const lobbyGiftName = $("lobbyGiftName");
const lobbyGiftValue = $("lobbyGiftValue");
const lobbyAvatarUrl = $("lobbyAvatarUrl");
const lobbyAddDonationBtn = $("lobbyAddDonationBtn");

const buttons = [
  $("btnPiedra"),
  $("btnPapel"),
  $("btnTijera"),
].filter(Boolean);

for (const b of buttons) {
  b.addEventListener("pointerdown", () => unlockCrackAudio(), { passive: true });
}

let currentMatchPlayers = { p1: "", p2: "" };
let lastRevealed = null;
let tournamentFxQueue = [];
let tournamentFxShowing = false;
let tournamentFinishedWinnerName = "";
let audioArmed = false;
let lobbyLiveConnected = false;
let lobbyRequiredCurrent = 0;
let lobbyDuelBattleSeconds = 20;
let lobbyDuelCountdownSeconds = 5;
let lobbyPrizeValue = 0;
let tieModalEl = null;
let tieWheelEl = null;
let tieP1El = null;
let tieP2El = null;
let tieTitleEl = null;
let tieSpinAnim = null;
let tieExitAnim = null;

function ensureTieModal() {
  if (tieModalEl) return;
  const wrap = document.createElement("div");
  wrap.className = "tieModal";
  wrap.hidden = true;
  wrap.innerHTML = `
    <div class="tieModal__backdrop"></div>
    <div class="tieModal__card" role="dialog" aria-modal="true">
      <div class="tieModal__title" id="tieTitle">Empate</div>
      <div class="tieWheelWrap">
        <div class="tiePointer"></div>
        <div class="tieWheel" id="tieWheel">
          <div class="tieWheel__label tieWheel__label--top" id="tieP1">Jugador 1</div>
          <div class="tieWheel__label tieWheel__label--bottom" id="tieP2">Jugador 2</div>
        </div>
      </div>
      <div class="tieModal__hint">La ruleta decide al azar</div>
    </div>
  `;
  document.body.appendChild(wrap);
  tieModalEl = wrap;
  tieWheelEl = wrap.querySelector("#tieWheel");
  tieP1El = wrap.querySelector("#tieP1");
  tieP2El = wrap.querySelector("#tieP2");
  tieTitleEl = wrap.querySelector("#tieTitle");
}

function hideTieModal() {
  if (!tieModalEl) return;
  if (tieSpinAnim) {
    try {
      tieSpinAnim.cancel();
    } catch {}
  }
  tieSpinAnim = null;
  if (tieExitAnim) {
    try {
      tieExitAnim.cancel();
    } catch {}
  }
  tieExitAnim = null;
  tieModalEl.hidden = true;
}

function exitTieModal() {
  if (!tieModalEl) return;
  if (tieExitAnim) {
    try {
      tieExitAnim.cancel();
    } catch {}
  }
  tieExitAnim = null;
  if (!tieModalEl.animate) {
    hideTieModal();
    return;
  }
  tieModalEl.classList.add("tieModal--exiting");
  tieExitAnim = tieModalEl.animate(
    [
      { opacity: 1, transform: "translate3d(0,0,0) scale(1)" },
      { opacity: 0, transform: "translate3d(0,18px,0) scale(.98)" },
    ],
    { duration: 520, easing: "ease", fill: "forwards" },
  );
  tieExitAnim.onfinish = () => {
    try {
      tieModalEl.classList.remove("tieModal--exiting");
      tieModalEl.style.opacity = "";
      tieModalEl.style.transform = "";
    } catch {}
    hideTieModal();
  };
}

let tieOverlayEl = null;
function ensureTieOverlay() {
  if (tieOverlayEl) return;
  tieOverlayEl = document.createElement("div");
  tieOverlayEl.className = "tie-overlay";
  tieOverlayEl.innerHTML = '<div class="tie-text">EMPATE</div>';
  document.body.appendChild(tieOverlayEl);
}

function flashTieLabel(duration = 2000) {
  ensureTieOverlay();
  tieOverlayEl.classList.add("tie-overlay--show");
  setTimeout(() => {
    tieOverlayEl.classList.remove("tie-overlay--show");
  }, duration);
}

function triggerTieClash() {
  const p1 = document.querySelector(".player--left");
  const p2 = document.querySelector(".player--right");
  if (!p1 || !p2) return;
  p1.classList.add("player--clash-p1");
  p2.classList.add("player--clash-p2");
  setTimeout(() => {
    p1.classList.remove("player--clash-p1");
    p2.classList.remove("player--clash-p2");
  }, 1000);
}

function showTieModal({ p1Name, p2Name, durationMs }) {
  ensureTieModal();
  tieModalEl.classList.remove("tieModal--exiting");
  if (tieTitleEl) tieTitleEl.textContent = "Empate";
  if (tieP1El) tieP1El.textContent = p1Name || "Jugador 1";
  if (tieP2El) tieP2El.textContent = p2Name || "Jugador 2";
  if (tieWheelEl) tieWheelEl.style.transform = "rotate(0deg)";
  tieModalEl.hidden = false;
  if (!tieWheelEl || typeof tieWheelEl.animate !== "function") return;
  const spins = 10 + Math.floor(Math.random() * 6);
  const extra = Math.random() * 360;
  const finalDeg = spins * 360 + extra;
  tieSpinAnim = tieWheelEl.animate(
    [{ transform: "rotate(0deg)" }, { transform: `rotate(${finalDeg}deg)` }],
    { duration: Math.max(300, Number(durationMs) || 5000), easing: "cubic-bezier(.12, .9, .2, 1)", fill: "forwards" },
  );
}

function setCurrentMatchPlayers(p1, p2) {
  currentMatchPlayers = { p1: p1 || "", p2: p2 || "" };
  if (activeMatchText) activeMatchText.textContent = `${currentMatchPlayers.p1} vs ${currentMatchPlayers.p2}`;
}

function setConnectionPill(mode, text) {
  if (!connectionPill) return;
  connectionPill.classList.remove("pill--ok", "pill--warn", "pill--bad");
  if (mode === "ok") connectionPill.classList.add("pill--ok");
  if (mode === "warn") connectionPill.classList.add("pill--warn");
  if (mode === "bad") connectionPill.classList.add("pill--bad");
  connectionPill.textContent = text;
}

function setStatus(text) {
  if (!statusText) return;
  statusText.textContent = text;
}

function enableChoices(enabled) {
  for (const b of buttons) b.disabled = !enabled;
  if (enabled) {
    for (const b of buttons) b.classList.remove("btn--selected");
  }
}

function showCountdown(seconds) {
  if (!countdownValue) return;
  countdownValue.textContent = seconds === 0 ? "YA" : String(seconds);
}

function setThrowIcon(targetEl, choice) {
  if (!targetEl) return;
  targetEl.innerHTML = "";
  const c = (choice || "").toString().trim().toLowerCase();
  const version = Date.now();
  const candidates =
    c === "piedra"
      ? [
          `/static/rps/piedra.png?v=${version}`,
          `/static/rps/PIEDRA.png?v=${version}`,
          `/static/rps/piedra.svg?v=${version}`,
          `/static/rps/PIEDRA.svg?v=${version}`,
        ]
      : c === "papel"
        ? [
            `/static/rps/papel.png?v=${version}`,
            `/static/rps/PAPEL.png?v=${version}`,
            `/static/rps/papel.svg?v=${version}`,
            `/static/rps/PAPEL.svg?v=${version}`,
          ]
        : c === "tijera"
          ? [
              `/static/rps/tijera.png?v=${version}`,
              `/static/rps/TIJERA.png?v=${version}`,
              `/static/rps/tijera.svg?v=${version}`,
              `/static/rps/TIJERA.svg?v=${version}`,
            ]
          : [];

  if (!candidates.length) {
    targetEl.textContent = "—";
    return;
  }

  const img = document.createElement("img");
  img.className = "throw__img";
  img.alt = choiceText(choice);
  let idx = 0;
  img.onerror = () => {
    idx += 1;
    if (idx >= candidates.length) {
      img.onerror = null;
      img.style.display = "none";
      targetEl.textContent = choiceText(choice);
      return;
    }
    img.src = candidates[idx];
  };
  img.src = candidates[idx];
  targetEl.appendChild(img);
}

function choiceClass(choice) {
  const c = (choice || "").toString().trim().toLowerCase();
  if (c === "piedra") return "tournament__throw--piedra";
  if (c === "papel") return "tournament__throw--papel";
  if (c === "tijera") return "tournament__throw--tijera";
  return "tournament__throw--none";
}

function choiceText(choice) {
  const c = (choice || "").toString().trim().toLowerCase();
  if (c === "piedra") return "PIEDRA";
  if (c === "papel") return "PAPEL";
  if (c === "tijera") return "TIJERA";
  return "—";
}

function resetThrows() {
  if (!throwsBox) return;
  throwsBox.hidden = true;
  throwsBox.classList.remove("tournament__throws--show");
  if (throwP1Card) throwP1Card.className = "tournament__throw";
  if (throwP2Card) throwP2Card.className = "tournament__throw";
  if (throwP1Name) throwP1Name.textContent = "—";
  if (throwP2Name) throwP2Name.textContent = "—";
  if (throwP1Icon) throwP1Icon.innerHTML = "";
  if (throwP2Icon) throwP2Icon.innerHTML = "";
  if (throwP1Text) throwP1Text.textContent = "—";
  if (throwP2Text) throwP2Text.textContent = "—";
}

function showThrowWaiting() {
  if (!throwsBox) return;
  throwsBox.hidden = false;
  if (throwP1Card) throwP1Card.className = "tournament__throw tournament__throw--none";
  if (throwP2Card) throwP2Card.className = "tournament__throw tournament__throw--none";
  if (throwP1Name) throwP1Name.textContent = currentMatchPlayers.p1 || "Jugador A";
  if (throwP2Name) throwP2Name.textContent = currentMatchPlayers.p2 || "Jugador B";
  if (throwP1Icon) throwP1Icon.textContent = "⏳";
  if (throwP2Icon) throwP2Icon.textContent = "⏳";
  if (throwP1Text) throwP1Text.textContent = "Esperando...";
  if (throwP2Text) throwP2Text.textContent = "Esperando...";
}

function showThrowProgress(p1Threw, p2Threw) {
  if (!throwsBox) return;
  throwsBox.hidden = false;
  if (throwP1Name) throwP1Name.textContent = currentMatchPlayers.p1 || "Jugador A";
  if (throwP2Name) throwP2Name.textContent = currentMatchPlayers.p2 || "Jugador B";
  if (throwP1Icon) throwP1Icon.textContent = p1Threw ? "✅" : "⏳";
  if (throwP2Icon) throwP2Icon.textContent = p2Threw ? "✅" : "⏳";
  if (throwP1Text) throwP1Text.textContent = p1Threw ? "Tiró" : "Esperando...";
  if (throwP2Text) throwP2Text.textContent = p2Threw ? "Tiró" : "Esperando...";
}

function showAdminPeek(p1Choice, p2Choice) {
  if (!throwsBox) return;
  throwsBox.hidden = false;

  const c1 = (p1Choice || "").toString().trim().toLowerCase();
  const c2 = (p2Choice || "").toString().trim().toLowerCase();

  if (throwP1Name) throwP1Name.textContent = currentMatchPlayers.p1 || "Jugador A";
  if (throwP2Name) throwP2Name.textContent = currentMatchPlayers.p2 || "Jugador B";

  if (c1) {
    if (throwP1Card) throwP1Card.className = `tournament__throw ${choiceClass(c1)}`;
    setThrowIcon(throwP1Icon, c1);
    if (throwP1Text) throwP1Text.textContent = choiceText(c1);
  } else {
    if (throwP1Card) throwP1Card.className = "tournament__throw tournament__throw--none";
    if (throwP1Icon) throwP1Icon.textContent = "⏳";
    if (throwP1Text) throwP1Text.textContent = "Esperando...";
  }

  if (c2) {
    if (throwP2Card) throwP2Card.className = `tournament__throw ${choiceClass(c2)}`;
    setThrowIcon(throwP2Icon, c2);
    if (throwP2Text) throwP2Text.textContent = choiceText(c2);
  } else {
    if (throwP2Card) throwP2Card.className = "tournament__throw tournament__throw--none";
    if (throwP2Icon) throwP2Icon.textContent = "⏳";
    if (throwP2Text) throwP2Text.textContent = "Esperando...";
  }
}

function showMyThrow(choice) {
  if (!throwsBox) return;
  const myName = youAre ? youAre.textContent.trim() : "";
  const isP1 = myName && myName === currentMatchPlayers.p1;
  const isP2 = myName && myName === currentMatchPlayers.p2;
  if (!isP1 && !isP2) return;
  throwsBox.hidden = false;
  if (isP1) {
    if (throwP1Card) throwP1Card.className = `tournament__throw ${choiceClass(choice)}`;
    setThrowIcon(throwP1Icon, choice);
    if (throwP1Text) throwP1Text.textContent = choiceText(choice);
  }
  if (isP2) {
    if (throwP2Card) throwP2Card.className = `tournament__throw ${choiceClass(choice)}`;
    setThrowIcon(throwP2Icon, choice);
    if (throwP2Text) throwP2Text.textContent = choiceText(choice);
  }
}

function showThrows(p1Choice, p2Choice) {
  if (!throwsBox) return;
  throwsBox.hidden = false;
  throwsBox.classList.remove("tournament__throws--show");
  void throwsBox.offsetHeight;
  throwsBox.classList.add("tournament__throws--show");
  if (throwP1Card) throwP1Card.className = `tournament__throw ${choiceClass(p1Choice)}`;
  if (throwP2Card) throwP2Card.className = `tournament__throw ${choiceClass(p2Choice)}`;
  if (throwP1Name) throwP1Name.textContent = currentMatchPlayers.p1 || "Jugador A";
  if (throwP2Name) throwP2Name.textContent = currentMatchPlayers.p2 || "Jugador B";
  setThrowIcon(throwP1Icon, p1Choice);
  setThrowIcon(throwP2Icon, p2Choice);
  if (throwP1Text) throwP1Text.textContent = choiceText(p1Choice);
  if (throwP2Text) throwP2Text.textContent = choiceText(p2Choice);
}

function resetResult() {
  if (!resultBox || !resultBig || !resultDetail) return;
  resultBox.classList.remove("result--animate");
  resultBig.textContent = "—";
  resultDetail.textContent = "";
}

function showResult(resultText, detailText) {
  if (!resultBox || !resultBig || !resultDetail) return;
  resultBox.classList.remove("result--animate");
  void resultBox.offsetWidth;
  resultBox.classList.add("result--animate");
  resultBig.textContent = resultText;
  resultDetail.textContent = detailText;
}

function setCountdownLabel(text) {
  if (!countdownLabel) return;
  countdownLabel.textContent = text;
}

function setPlayers(playersPayload) {
  if (!p1State || !p2State) return;
  const p = (playersPayload && playersPayload.players) || [];
  const p1 = p[0] || { connected: false };
  const p2 = p[1] || { connected: false };
  p1State.textContent = p1.connected ? "Conectado" : "Esperando...";
  p2State.textContent = p2.connected ? "Conectado" : "Esperando...";
  if (p1Name) p1Name.textContent = p1.name ? String(p1.name) : "Jugador 1";
  if (p2Name) p2Name.textContent = p2.name ? String(p2.name) : "Jugador 2";
  if (p1Avatar) p1Avatar.src = p1.avatar_url ? String(p1.avatar_url) : "/static/rps/INI1.png";
  if (p2Avatar) p2Avatar.src = p2.avatar_url ? String(p2.avatar_url) : "/static/rps/INI1.png";
  if (matchScore) {
    const s = playersPayload && playersPayload.score ? playersPayload.score : null;
    const r = s && Number.isFinite(s.round) ? s.round : 1;
    const rt = s && Number.isFinite(s.rounds_total) ? s.rounds_total : 3;
    const a = s && Number.isFinite(s.p1) ? s.p1 : 0;
    const b = s && Number.isFinite(s.p2) ? s.p2 : 0;
    matchScore.textContent = `Ronda ${r}/${rt} · ${a}-${b}`;
    if (r === 1 && a === 0 && b === 0) resetDamage();
  }
}

function choiceLabel(choice) {
  if (choice === "piedra") return "Piedra";
  if (choice === "papel") return "Papel";
  if (choice === "tijera") return "Tijera";
  return "—";
}

function choiceImg(choice) {
  if (choice === "piedra") return "/static/rps/PIEDRA.png";
  if (choice === "papel") return "/static/rps/PAPEL.png";
  if (choice === "tijera") return "/static/rps/TIJERA.png";
  return "";
}

let crackAudioCtx = null;
let crackAudioUnlocked = false;

function unlockCrackAudio() {
  if (crackAudioUnlocked) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  try {
    crackAudioCtx = crackAudioCtx || new Ctx();
    const osc = crackAudioCtx.createOscillator();
    const gain = crackAudioCtx.createGain();
    gain.gain.value = 0.0001;
    osc.frequency.value = 440;
    osc.connect(gain);
    gain.connect(crackAudioCtx.destination);
    osc.start();
    osc.stop(crackAudioCtx.currentTime + 0.01);
    crackAudioUnlocked = true;
  } catch {}
}

function playCrackSound() {
  if (!crackAudioUnlocked || !crackAudioCtx) return;
  try {
    const ctx = crackAudioCtx;
    const now = ctx.currentTime;
    const dur = 0.22;

    const bufferLen = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, bufferLen, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferLen; i += 1) {
      const t = i / bufferLen;
      const env = Math.pow(1 - t, 3);
      data[i] = (Math.random() * 2 - 1) * env;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.setValueAtTime(900, now);
    hp.Q.value = 0.7;

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(4800, now);
    lp.Q.value = 0.4;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.38, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    src.connect(hp);
    hp.connect(lp);
    lp.connect(gain);
    gain.connect(ctx.destination);
    src.start(now);

    const osc = ctx.createOscillator();
    const og = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(70, now + 0.08);
    og.gain.setValueAtTime(0.0001, now);
    og.gain.exponentialRampToValueAtTime(0.15, now + 0.01);
    og.gain.exponentialRampToValueAtTime(0.0001, now + 0.10);
    osc.connect(og);
    og.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.11);
  } catch {}
}

let loserFxTimer1 = 0;
let loserFxTimer2 = 0;
let loserFxAnim = null;
let damageP1 = 0;
let damageP2 = 0;
let fxGhostEl = null;
let fxGhostSrcEl = null;
let fxBackdropEl = null;

function ensureDamageOverlay(card) {
  if (!card) return;
  if (card.querySelector(".playerDamageOverlay")) return;
  const ov = document.createElement("div");
  ov.className = "playerDamageOverlay";
  card.appendChild(ov);
}

function setDamage(card, level) {
  if (!card) return;
  const n = Math.max(0, Math.min(3, Number(level) || 0));
  if (!n) {
    try {
      delete card.dataset.damage;
    } catch {}
    card.querySelectorAll(".playerDamageOverlay").forEach((x) => x.remove());
    return;
  }
  ensureDamageOverlay(card);
  card.dataset.damage = String(n);
}

function resetDamage() {
  damageP1 = 0;
  damageP2 = 0;
  setDamage(p1Card, 0);
  setDamage(p2Card, 0);
}

function clearLoserFx() {
  if (loserFxTimer1) clearTimeout(loserFxTimer1);
  if (loserFxTimer2) clearTimeout(loserFxTimer2);
  loserFxTimer1 = 0;
  loserFxTimer2 = 0;
  if (loserFxAnim) {
    try {
      loserFxAnim.cancel();
    } catch {}
  }
  loserFxAnim = null;
  if (fxBackdropEl) {
    try {
      fxBackdropEl.remove();
    } catch {}
  }
  fxBackdropEl = null;
  if (fxGhostEl) {
    try {
      fxGhostEl.remove();
    } catch {}
  }
  fxGhostEl = null;
  if (fxGhostSrcEl) {
    try {
      fxGhostSrcEl.style.visibility = "";
    } catch {}
  }
  fxGhostSrcEl = null;
  if (p1Card) p1Card.classList.remove("player--loserFx");
  if (p2Card) p2Card.classList.remove("player--loserFx");
  if (p1Card) p1Card.querySelectorAll(".loserCrackOverlay").forEach((n) => n.remove());
  if (p2Card) p2Card.querySelectorAll(".loserCrackOverlay").forEach((n) => n.remove());
}

function triggerLoserFx(side) {
  if (!p1Card || !p2Card) return;
  const s = Number.parseInt(String(side ?? "0"), 10) || 0;
  if (s !== 1 && s !== 2) return;
  const loserCard = s === 1 ? p2Card : p1Card;
  if (s === 1) {
    damageP2 = Math.min(3, (Number.isFinite(damageP2) ? damageP2 : 0) + 1);
    setDamage(p2Card, damageP2);
  } else {
    damageP1 = Math.min(3, (Number.isFinite(damageP1) ? damageP1 : 0) + 1);
    setDamage(p1Card, damageP1);
  }
  clearLoserFx();
  const rect = loserCard.getBoundingClientRect();
  const vw = Math.max(1, window.innerWidth || 1);
  const vh = Math.max(1, window.innerHeight || 1);
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = (vw / 2) - cx;
  const dy = (vh / 2) - cy;

  let ghost = null;
  let backdrop = null;
  try {
    backdrop = document.createElement("div");
    backdrop.className = "fxBackdrop";
    document.body.appendChild(backdrop);
    fxBackdropEl = backdrop;
  } catch {}
  try {
    ghost = loserCard.cloneNode(true);
    ghost.classList.add("playerFxGhost");
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    ghost.style.boxSizing = "border-box";
    ghost.querySelectorAll(".loserCrackOverlay").forEach((n) => n.remove());
    const ov = document.createElement("div");
    ov.className = "loserCrackOverlay";
    ghost.appendChild(ov);
    document.body.appendChild(ghost);
    fxGhostEl = ghost;
    fxGhostSrcEl = loserCard;
    loserCard.style.visibility = "hidden";
  } catch {}

  const animTarget = ghost || loserCard;
  try {
    animTarget.style.willChange = "transform, filter";
    animTarget.style.zIndex = "9999";
  } catch {}
  try {
    if (typeof animTarget.animate === "function") {
      const mid = `translate3d(${dx}px, ${dy}px, 0) scale(1.18)`;
      const near = `translate3d(${dx}px, ${dy}px, 0) scale(1.12)`;
      const FX_MS = 5000;
      loserFxAnim = animTarget.animate(
        [
          { transform: "translate3d(0,0,0) scale(1) rotate(0deg)", filter: "none" },
          { transform: near, filter: "hue-rotate(18deg) contrast(1.06)", offset: 0.18 },
          { transform: `${mid} rotate(-0.7deg)`, filter: "hue-rotate(-12deg) contrast(1.10) saturate(0.84)", offset: 0.28 },
          { transform: `${mid} rotate(0.8deg)`, filter: "contrast(1.10) saturate(0.80)", offset: 0.40 },
          { transform: `${mid} rotate(-0.9deg)`, filter: "hue-rotate(10deg) contrast(1.08) saturate(0.74)", offset: 0.52 },
          { transform: `${mid} rotate(0.7deg)`, filter: "contrast(1.10) saturate(0.80)", offset: 0.64 },
          { transform: `${mid} rotate(-0.6deg)`, filter: "hue-rotate(-8deg) contrast(1.08) saturate(0.76)", offset: 0.78 },
          { transform: near, filter: "contrast(1.06) saturate(0.70) grayscale(0.06)", offset: 0.88 },
          { transform: "translate3d(0,0,0) scale(1) rotate(0deg)", filter: "contrast(1.05) saturate(0.70) grayscale(0.12)" },
        ],
        { duration: FX_MS, easing: "cubic-bezier(.16, 1, .3, 1)", fill: "both" },
      );
      if (backdrop && typeof backdrop.animate === "function") {
        backdrop.animate(
          [
            { opacity: 0 },
            { opacity: 1, offset: 0.10 },
            { opacity: 1, offset: 0.88 },
            { opacity: 0 },
          ],
          { duration: FX_MS, easing: "ease", fill: "both" },
        );
      }
    }
  } catch {}
  playCrackSound();
  const cleanupMs = 5200;
  const t = setTimeout(() => {
    try {
      animTarget.style.willChange = "";
      animTarget.style.zIndex = "";
    } catch {}
    if (fxBackdropEl) {
      try {
        fxBackdropEl.remove();
      } catch {}
    }
    fxBackdropEl = null;
    if (fxGhostEl) {
      try {
        fxGhostEl.remove();
      } catch {}
    }
    fxGhostEl = null;
    if (fxGhostSrcEl) {
      try {
        fxGhostSrcEl.style.visibility = "";
      } catch {}
    }
    fxGhostSrcEl = null;
  }, cleanupMs);
  if (s === 1) loserFxTimer2 = t;
  else loserFxTimer1 = t;
}

function renderTournamentPlayers(payload) {
  if (!tournamentPlayersList || !tournamentCount) return;
  const count = (payload && payload.count) || 0;
  const max = (payload && payload.max) || MAX_PLAYERS || 2;
  tournamentCount.textContent = `Registrados: ${count}/${max}`;
  const players = (payload && payload.players) || [];
  tournamentPlayersList.innerHTML = players
    .map((p) => {
      const redeemed = Boolean(p && p.redeemed);
      const connected = Boolean(p && p.connected);
      const name = (p && p.name) ? String(p.name).trim() : "";
      const title = redeemed ? (name || "Jugador") : "Pendiente jugador";
      const status = redeemed ? (connected ? "Online" : "Registrado") : "Pendiente";
      return `<div class="tournament__player">${title} · ${status}</div>`;
    })
    .join("");
}

function renderBracket(payload) {
  if (!bracketList) return;
  const rounds = (payload && payload.rounds) || [];
  if (!rounds.length) {
    bracketList.innerHTML = `<div class="tournament__empty">Se generan las llaves cuando el torneo esté completo.</div>`;
    return;
  }
  bracketList.innerHTML = rounds
    .map((r) => {
      const matches = (r && r.matches) || [];
      const items = matches
        .map((m) => {
          const status = m.status || "pending";
          const winner = m.winner && m.winner !== "—" ? ` · Gana: ${m.winner}` : "";
          return `<div class="tournament__matchItem tournament__matchItem--${status}">${m.p1} vs ${m.p2}${winner}</div>`;
        })
        .join("");
      return `<div class="tournament__round"><div class="tournament__roundTitle">Ronda ${Number(r.round) + 1}</div>${items}</div>`;
    })
    .join("");
}

function normalizeName(v) {
  return String(v || "").trim();
}

function armAudio() {
  if (audioArmed) return;
  audioArmed = true;
}

window.addEventListener("pointerdown", armAudio, { once: true });
window.addEventListener("keydown", armAudio, { once: true });

if (audioArmBtn) {
  audioArmBtn.addEventListener("click", () => {
    armAudio();
    audioArmBtn.disabled = true;
    audioArmBtn.textContent = "Audio activado";
  });
}

function speakSfx(type) {
  armAudio();
  if (!audioArmed) return;
  if (!("speechSynthesis" in window)) return;
  const t = String(type || "").toLowerCase();
  const text = t === "champion" ? "Felicidades, campeón" : t === "levelup" ? "Pasas de ronda" : "Eliminado";
  try {
    window.speechSynthesis.cancel();
  } catch {}
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "es-ES";
    u.rate = 1;
    u.pitch = 1;
    window.speechSynthesis.speak(u);
  } catch {}
}

function fmtMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("es-CO");
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function lobbyCardHtml(p, withActions, requiredValue) {
  const handle = (p && p.handle ? String(p.handle) : "").trim();
  const avatarUrl = (p && p.avatar_url ? String(p.avatar_url) : "").trim();
  const total = p && Number.isFinite(p.total_value) ? p.total_value : 0;
  const required = Number.isFinite(requiredValue) ? requiredValue : 0;
  const meetsRequired = required <= 0 ? true : total >= required;
  const isApproved = Boolean(p && p.approved);
  const isParticipants = MODE === "lobby_participants";
  const gifts = p && Array.isArray(p.gifts) ? p.gifts : [];
  const g0 = gifts[0] || null;
  const giftName = g0 && g0.name ? String(g0.name) : "";
  const giftCount = g0 && Number.isFinite(g0.count) ? g0.count : 0;
  const giftText = giftName ? `${giftName}${giftCount > 1 ? ` x${giftCount}` : ""}` : "";
  const img = avatarUrl
    ? `<img class="lobbyAvatar__img" src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(handle)}" loading="lazy" referrerpolicy="no-referrer" />`
    : `<div class="lobbyAvatar__ph">${escapeHtml(handle.replace("@", "").slice(0, 1).toUpperCase() || "?")}</div>`;

  const actions = withActions
    ? `<div class="lobbyActions">
        ${
          MODE === "lobby_participants"
            ? `<button class="lobbyBtn lobbyBtn--bad" type="button" data-action="kick" data-handle="${escapeHtml(handle)}">✕</button>`
            : `${
                isApproved
                  ? ""
                  : `<button class="lobbyBtn lobbyBtn--ok" type="button" data-action="approve" data-handle="${escapeHtml(handle)}" ${meetsRequired ? "" : "disabled"}>✓</button>`
              }
              <button class="lobbyBtn lobbyBtn--warn" type="button" data-action="winner" data-handle="${escapeHtml(handle)}">★</button>
              <button class="lobbyBtn lobbyBtn--bad" type="button" data-action="kick" data-handle="${escapeHtml(handle)}">✕</button>`
        }
      </div>`
    : "";

  return `<div class="lobbyRow">
    <div class="lobbyAvatar">${img}</div>
    <div class="lobbyRow__main">
      <div class="lobbyRow__name">${escapeHtml(handle || "—")}</div>
      <div class="lobbyRow__meta">${isParticipants ? "Donó" : "Acumulado"}: <span class="hint__mono">${escapeHtml(fmtMoney(total))}</span>${giftText ? ` · <span class="hint__mono">${escapeHtml(giftText)}</span>` : ""}${!isParticipants && required > 0 ? ` · Meta: <span class="hint__mono">${escapeHtml(fmtMoney(required))}</span>` : ""}${!isParticipants && required > 0 && !meetsRequired ? ` · Falta: <span class="hint__mono">${escapeHtml(fmtMoney(Math.max(0, required - total)))}</span>` : ""}</div>
    </div>
    ${actions}
  </div>`;
}

function renderLobbyState(payload) {
  if (!payload) return;
  const required = Number.isFinite(payload.required_value) ? payload.required_value : 0;
  const total = Number.isFinite(payload.total_value) ? payload.total_value : 0;
  const duelBattle = Number.isFinite(payload.duel_battle_seconds) ? payload.duel_battle_seconds : 20;
  const duelCountdown = Number.isFinite(payload.duel_countdown_seconds) ? payload.duel_countdown_seconds : 5;
  const prize = Number.isFinite(payload.prize_value) ? payload.prize_value : 0;
  lobbyRequiredCurrent = required;
  lobbyDuelBattleSeconds = duelBattle;
  lobbyDuelCountdownSeconds = duelCountdown;
  lobbyPrizeValue = prize;
  lobbyLiveConnected = Boolean(payload.live_connected);
  if (lobbyLiveConnectBtn) {
    lobbyLiveConnectBtn.textContent = lobbyLiveConnected ? "Desconectar" : "Conectar";
  }
  if (lobbyLiveHandle && payload.live_handle && document.activeElement !== lobbyLiveHandle) {
    lobbyLiveHandle.value = String(payload.live_handle || "");
  }
  if (lobbyRequiredValue) lobbyRequiredValue.textContent = fmtMoney(required);
  if (lobbyTotalValue) lobbyTotalValue.textContent = fmtMoney(total);
  if (lobbyRequiredInput && document.activeElement !== lobbyRequiredInput) lobbyRequiredInput.value = String(required);
  if (duelConfigBattleInput && document.activeElement !== duelConfigBattleInput) duelConfigBattleInput.value = String(duelBattle);
  if (duelConfigCountdownInput && document.activeElement !== duelConfigCountdownInput) duelConfigCountdownInput.value = String(duelCountdown);
  if (duelConfigPrizeInput && document.activeElement !== duelConfigPrizeInput) duelConfigPrizeInput.value = String(prize);

  const pending = Array.isArray(payload.pending) ? payload.pending : [];
  const tables = Array.isArray(payload.tables) ? payload.tables : [];
  const winners = Array.isArray(payload.winners) ? payload.winners : [];
  const matchCodes = Array.isArray(payload.match_codes) ? payload.match_codes : [];

  if (lobbyAllMatchCodesText) {
    lobbyAllMatchCodesText.value = matchCodes.length
      ? matchCodes
          .map((m) => {
            const idx = Number.isFinite(m.index) ? m.index : 0;
            const p1 = m.p1_handle ? String(m.p1_handle) : "—";
            const p2 = m.p2_handle ? String(m.p2_handle) : "—";
            const code = m.code ? String(m.code).trim().toUpperCase() : "";
            const rid = m.room_id ? String(m.room_id) : "";
            const s1 = Number.isFinite(m.p1_score) ? m.p1_score : 0;
            const s2 = Number.isFinite(m.p2_score) ? m.p2_score : 0;
            const r = Number.isFinite(m.round) ? m.round : 0;
            const rt = Number.isFinite(m.rounds_total) ? m.rounds_total : 3;
            const scoreTxt = r > 0 ? `  |  ${s1}-${s2} (R${r}/${rt})` : "";
            const roomTxt = rid ? `  |  ${rid}` : "";
            return `Sala ${idx || "—"}: ${p1} vs ${p2}  |  ${code || "—"}${roomTxt}${scoreTxt}`;
          })
          .join("\n")
      : "";
  }

  if (lobbyMatchCodes) {
    lobbyMatchCodes.innerHTML = matchCodes.length
      ? matchCodes
          .map((m) => {
            const idx = Number.isFinite(m.index) ? m.index : 0;
            const p1 = m.p1_handle ? String(m.p1_handle) : "—";
            const p2 = m.p2_handle ? String(m.p2_handle) : "—";
            const code = m.code ? String(m.code).trim().toUpperCase() : "";
            const rid = m.room_id ? String(m.room_id) : "";
            const s1 = Number.isFinite(m.p1_score) ? m.p1_score : 0;
            const s2 = Number.isFinite(m.p2_score) ? m.p2_score : 0;
            const r = Number.isFinite(m.round) ? m.round : 0;
            const rt = Number.isFinite(m.rounds_total) ? m.rounds_total : 3;
            const scoreLine = r > 0 ? ` · Marcador: <span class="hint__mono">${s1}-${s2}</span> · Ronda: <span class="hint__mono">${r}/${rt}</span>` : "";
            return `<div class="lobbyRow">
              <div class="lobbyRow__main">
                <div class="lobbyRow__name">Sala ${idx || "—"}: ${escapeHtml(p1)} vs ${escapeHtml(p2)}</div>
                <div class="lobbyRow__meta">Código: <span class="hint__mono">${escapeHtml(code || "—")}</span>${rid ? ` · Sala: <span class="hint__mono">${escapeHtml(rid)}</span>` : ""}${scoreLine}</div>
              </div>
              <div class="lobbyActions">
                <button class="lobbyBtn lobbyBtn--ok" type="button" data-mc-action="copy" data-code="${escapeHtml(code)}">⧉</button>
                <button class="lobbyBtn lobbyBtn--warn" type="button" data-mc-action="regen" data-code="${escapeHtml(code)}">↻</button>
              </div>
            </div>`;
          })
          .join("")
      : `<div class="tournament__empty">Aún no hay códigos. Primero empareja y luego genera.</div>`;
  }

  if (lobbyPending) {
    lobbyPending.innerHTML = pending.length
      ? pending.map((p) => lobbyCardHtml(p, MODE === "lobby_admin" || MODE === "lobby_participants", required)).join("")
      : `<div class="tournament__empty">Aún no hay donaciones.</div>`;
  }

  if (lobbyTables) {
    const fixed = MODE === "lobby_participants" ? 8 : tables.length;
    const blocks = [];
    for (let idx = 0; idx < fixed; idx += 1) {
      const t = MODE === "lobby_participants" ? (tables[idx] || []) : (tables[idx] || []);
      const cards = (Array.isArray(t) ? t : []).map((p) => lobbyCardHtml(p, MODE === "lobby_admin" || MODE === "lobby_participants", required)).join("");
      blocks.push(`<div class="lobbyTable">
        <div class="lobbyTable__title">Mesa ${idx + 1}</div>
        <div class="lobbyTable__grid">${cards || `<div class="tournament__empty">Vacía</div>`}</div>
      </div>`);
    }
    lobbyTables.innerHTML = blocks.length ? blocks.join("") : `<div class="tournament__empty">Aún no hay participantes en mesas.</div>`;
  }

  if (lobbyWinners) {
    lobbyWinners.innerHTML = winners.length
      ? winners
          .map((w) => {
            const p = {
              handle: w.handle || "",
              avatar_url: w.avatar_url || "",
              total_value: Number.isFinite(w.total_value) ? w.total_value : 0,
            };
            return lobbyCardHtml(p, false, required);
          })
          .join("")
      : `<div class="tournament__empty">Aún no hay ganadores.</div>`;
  }
}

const ua = (navigator && navigator.userAgent) ? String(navigator.userAgent) : "";
const isIOS = /iPad|iPhone|iPod/.test(ua) || (ua.includes("Mac") && "ontouchend" in document);
const socket = io({
  transports: isIOS ? ["polling"] : ["websocket", "polling"],
});

setConnectionPill("warn", "Conectando...");
setStatus("Uniéndote a la sala...");
enableChoices(false);
resetResult();
showCountdown("—");

if (MODE === "admin_setup") {
  setConnectionPill("ok", "Listo");
  setStatus("Configura el torneo y créalo.");
  if (playersBox) playersBox.hidden = true;
  if (tournamentBox) tournamentBox.hidden = true;
} else if (MODE === "join") {
  setConnectionPill("ok", "Listo");
  setStatus("Ingresa tu código personal y tus datos.");
  if (playersBox) playersBox.hidden = true;
  if (tournamentBox) tournamentBox.hidden = true;
}

socket.on("connect", () => {
  if (MODE === "admin_setup" || MODE === "join") return;
  setConnectionPill("ok", "Online");
  if (IS_LOBBY) {
    socket.emit("join", { room_id: ROOM_ID, mode: MODE });
    return;
  }
  if (MODE === "admin_dashboard") {
    socket.emit("join", { room_id: ROOM_ID, mode: "tournament_admin" });
    return;
  }
  if (MODE === "tournament") {
    if (SPECTATOR_KEY) {
      socket.emit("join", { room_id: ROOM_ID, mode: "tournament_spectator", spectator_key: SPECTATOR_KEY });
      return;
    }
    socket.emit("join", { room_id: ROOM_ID, mode: "tournament_player", player_key: PLAYER_KEY });
    return;
  }
  if (IS_DUEL_ADMIN) {
    socket.emit("join", { room_id: ROOM_ID, mode: "duel_admin" });
    setStatus("Espectando sala...");
    const actions = document.querySelector(".actions");
    if (actions) actions.style.display = "none";
    return;
  }
  socket.emit("join", { room_id: ROOM_ID, mode: "duel", handle: SELF_HANDLE });
});

socket.on("disconnect", () => {
  setConnectionPill("bad", "Desconectado");
  setStatus("Se perdió la conexión. Reintentando...");
  enableChoices(false);
});

socket.on("joined", (payload) => {
  const myName = payload.you_are || "Jugador";
  if (youAre) youAre.textContent = myName;
  if (!IS_TOURNAMENT && !IS_LOBBY) resetDamage();
  const shareUrl = payload.share_url || (shareLink ? shareLink.href : "");
  if (shareUrlText) shareUrlText.textContent = shareUrl;
  if (shareLink) shareLink.href = shareUrl;
  if (qrImg) {
    const qrPath = (payload && payload.qr_path) || `/qr/${ROOM_ID}.png`;
    qrImg.src = `${qrPath}?u=${encodeURIComponent(shareUrl)}`;
  }
  if (copyMsg) {
    const isLocalhost =
      shareUrl.includes("127.0.0.1") ||
      shareUrl.includes("localhost") ||
      shareUrl.includes("0.0.0.0");
    copyMsg.textContent = isLocalhost
      ? "Ese enlace solo sirve en tu PC. Para compartir por Wi‑Fi abre el juego usando tu IP local (192.168.x.x). Para internet debes desplegarlo (Render/Railway)."
      : "";
  }
  if (IS_LOBBY) {
    if (playersBox) playersBox.hidden = true;
    if (tournamentBox) tournamentBox.hidden = true;
    setStatus(MODE === "lobby_admin" ? "Admin listo. Esperando donaciones..." : "Esperando donaciones...");
    return;
  }
  if (IS_TOURNAMENT) {
    if (playersBox) playersBox.hidden = true;
    if (tournamentBox) tournamentBox.hidden = false;
    const isAdmin = Boolean(payload && payload.is_admin);
    if (tournamentRole) tournamentRole.textContent = isAdmin ? "Organizador" : (SPECTATOR_KEY ? "Espectador" : "Participante");
    if (startNextBtn) startNextBtn.hidden = !isAdmin;
    if (generateBracketBtn) generateBracketBtn.hidden = !isAdmin;
    if (readyBtn) readyBtn.hidden = true;
    if (tournamentActive) tournamentActive.hidden = true;
    setStatus("Esperando jugadores...");
  } else {
    setStatus("Esperando jugador...");
  }
});

socket.on("players_update", (payload) => {
  if (IS_TOURNAMENT || IS_LOBBY) return;
  setPlayers(payload);
  const count = payload && payload.count ? payload.count : 0;
  if (count < 2) {
    enableChoices(false);
    showCountdown("—");
  }
});

socket.on("status", (payload) => {
  if (IS_TOURNAMENT || IS_LOBBY) return;
  if (!payload || !payload.text) return;
  setStatus(payload.text);
});

socket.on("lobby_status", (payload) => {
  if (!IS_LOBBY) return;
  if (!payload || !payload.text) return;
  setStatus(payload.text);
});

socket.on("lobby_match_code_regen_done", async (payload) => {
  if (!IS_LOBBY) return;
  const oldCode = payload && payload.old_code ? String(payload.old_code).trim().toUpperCase() : "";
  const newCode = payload && payload.new_code ? String(payload.new_code).trim().toUpperCase() : "";
  if (!oldCode || !newCode) return;
  setStatus(`Código actualizado: ${oldCode} → ${newCode}`);
  try {
    await navigator.clipboard.writeText(newCode);
  } catch {}
});

socket.on("lobby_state", (payload) => {
  if (!IS_LOBBY) return;
  renderLobbyState(payload);
});

socket.on("duel_admin_peek", (payload) => {
  if (!IS_DUEL_ADMIN) return;
  if (duelAdminBox) duelAdminBox.hidden = false;
  const p1 = payload && payload.p1_choice ? String(payload.p1_choice).trim().toLowerCase() : "";
  const p2 = payload && payload.p2_choice ? String(payload.p2_choice).trim().toLowerCase() : "";
  if (duelAdminP1Choice) duelAdminP1Choice.textContent = choiceLabel(p1);
  if (duelAdminP2Choice) duelAdminP2Choice.textContent = choiceLabel(p2);
});

function setLiveModalOpen(open) {
  if (!liveModal) return;
  liveModal.hidden = !open;
}

if (liveModal) {
  liveModal.addEventListener("click", (e) => {
    const t = e && e.target ? e.target : null;
    if (!t) return;
    if (t.dataset && t.dataset.close === "1") setLiveModalOpen(false);
  });
}

function setDuelConfigModalOpen(open) {
  if (!duelConfigModal) return;
  duelConfigModal.hidden = !open;
}

function setRoutesModalOpen(open) {
  if (!routesModal) return;
  routesModal.hidden = !open;
}

function setBotsModalOpen(open) {
  if (!botsModal) return;
  botsModal.hidden = !open;
}

if (duelConfigModal) {
  duelConfigModal.addEventListener("click", (e) => {
    const t = e && e.target ? e.target : null;
    if (!t) return;
    if (t.dataset && t.dataset.close === "1") setDuelConfigModalOpen(false);
  });
}

if (routesModal) {
  routesModal.addEventListener("click", (e) => {
    const t = e && e.target ? e.target : null;
    if (!t) return;
    if (t.dataset && t.dataset.close === "1") setRoutesModalOpen(false);
  });
}

if (botsModal) {
  botsModal.addEventListener("click", (e) => {
    const t = e && e.target ? e.target : null;
    if (!t) return;
    if (t.dataset && t.dataset.close === "1") setBotsModalOpen(false);
  });
}

if (lobbyOpenLiveModalBtn) {
  lobbyOpenLiveModalBtn.addEventListener("click", () => {
    setLiveModalOpen(true);
    if (lobbyLiveHandle) lobbyLiveHandle.focus();
  });
}

if (lobbyLiveCloseBtn) {
  lobbyLiveCloseBtn.addEventListener("click", () => setLiveModalOpen(false));
}

if (duelConfigCloseBtn) {
  duelConfigCloseBtn.addEventListener("click", () => setDuelConfigModalOpen(false));
}

if (lobbyRoutesBtn) {
  lobbyRoutesBtn.addEventListener("click", () => {
    setRoutesModalOpen(true);
    if (routesText) routesText.focus();
  });
}

if (lobbyHackBtn) {
  lobbyHackBtn.addEventListener("click", () => {
    try {
      window.open("/hack", "_blank", "noopener,noreferrer");
    } catch {
      window.location.href = "/hack";
    }
  });
}

if (lobbyBotsBtn) {
  lobbyBotsBtn.addEventListener("click", () => setBotsModalOpen(true));
}

if (botsCloseBtn) {
  botsCloseBtn.addEventListener("click", () => setBotsModalOpen(false));
}

if (botsFill2Btn) {
  botsFill2Btn.addEventListener("click", () => {
    if (!IS_LOBBY) return;
    socket.emit("lobby_fill_bots", { rooms_count: 2 });
    setBotsModalOpen(false);
  });
}
if (botsFill5Btn) {
  botsFill5Btn.addEventListener("click", () => {
    if (!IS_LOBBY) return;
    socket.emit("lobby_fill_bots", { rooms_count: 5 });
    setBotsModalOpen(false);
  });
}
if (botsFill10Btn) {
  botsFill10Btn.addEventListener("click", () => {
    if (!IS_LOBBY) return;
    socket.emit("lobby_fill_bots", { rooms_count: 10 });
    setBotsModalOpen(false);
  });
}

if (routesCloseBtn) {
  routesCloseBtn.addEventListener("click", () => setRoutesModalOpen(false));
}

if (routesCopyBtn) {
  routesCopyBtn.addEventListener("click", async () => {
    const text = routesText ? String(routesText.value || "").trim() : "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Copiado: rutas");
    } catch {
      setStatus("No se pudo copiar. Copia manual.");
      if (routesText) routesText.focus();
    }
  });
}

if (lobbyLiveConnectBtn) {
  lobbyLiveConnectBtn.addEventListener("click", () => {
    if (!IS_LOBBY) return;
    if (lobbyLiveConnected) {
      socket.emit("lobby_live_disconnect", {});
      return;
    }
    const handle = lobbyLiveHandle ? String(lobbyLiveHandle.value || "").trim() : "";
    socket.emit("lobby_live_connect", { handle });
    setLiveModalOpen(false);
  });
}

if (lobbyEditDuelBtn) {
  lobbyEditDuelBtn.addEventListener("click", () => {
    if (!IS_LOBBY) return;
    if (duelConfigBattleInput) duelConfigBattleInput.value = String(lobbyDuelBattleSeconds);
    if (duelConfigCountdownInput) duelConfigCountdownInput.value = String(lobbyDuelCountdownSeconds);
    if (duelConfigPrizeInput) duelConfigPrizeInput.value = String(lobbyPrizeValue);
    setDuelConfigModalOpen(true);
  });
}

if (lobbyStartDuelsBtn) {
  lobbyStartDuelsBtn.addEventListener("click", () => {
    if (!IS_LOBBY) return;
    socket.emit("lobby_start_ready_duels", {});
  });
}

if (duelConfigSaveBtn) {
  duelConfigSaveBtn.addEventListener("click", () => {
    if (!IS_LOBBY) return;
    const battle = duelConfigBattleInput ? Number.parseInt(String(duelConfigBattleInput.value || "20"), 10) : 20;
    const countdown = duelConfigCountdownInput ? Number.parseInt(String(duelConfigCountdownInput.value || "5"), 10) : 5;
    const prize = duelConfigPrizeInput ? Number.parseInt(String(duelConfigPrizeInput.value || "0"), 10) : 0;
    socket.emit("lobby_config", {
      required_value: lobbyRequiredInput ? Number.parseInt(String(lobbyRequiredInput.value || String(lobbyRequiredCurrent)), 10) : lobbyRequiredCurrent,
      duel_battle_seconds: Number.isFinite(battle) ? battle : lobbyDuelBattleSeconds,
      duel_countdown_seconds: Number.isFinite(countdown) ? countdown : lobbyDuelCountdownSeconds,
      prize_value: Number.isFinite(prize) ? prize : lobbyPrizeValue,
    });
    setDuelConfigModalOpen(false);
  });
}

if (lobbyResetBtn) {
  lobbyResetBtn.addEventListener("click", () => {
    if (!IS_LOBBY) return;
    socket.emit("lobby_reset", {});
  });
}

if (lobbyBracketShuffleBtn) {
  lobbyBracketShuffleBtn.addEventListener("click", () => {
    if (!IS_LOBBY) return;
    socket.emit("lobby_bracket_shuffle", {});
  });
}

if (lobbyGenerateMatchCodesBtn) {
  lobbyGenerateMatchCodesBtn.addEventListener("click", () => {
    if (!IS_LOBBY) return;
    socket.emit("lobby_generate_match_codes", {});
  });
}

if (lobbyRegenAllMatchCodesBtn) {
  lobbyRegenAllMatchCodesBtn.addEventListener("click", () => {
    if (!IS_LOBBY) return;
    socket.emit("lobby_regen_all_match_codes", {});
  });
}

if (lobbyCopyAllMatchCodesBtn) {
  lobbyCopyAllMatchCodesBtn.addEventListener("click", async () => {
    if (!IS_LOBBY) return;
    const text = lobbyAllMatchCodesText ? String(lobbyAllMatchCodesText.value || "").trim() : "";
    if (!text) {
      setStatus("No hay códigos todavía. Primero genera salas y códigos.");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Copiado: todos los códigos");
    } catch {
      setStatus("No se pudo copiar. Selecciona el texto y copia manual.");
      if (lobbyAllMatchCodesText) lobbyAllMatchCodesText.focus();
    }
  });
}

if (lobbyMatchCodes) {
  lobbyMatchCodes.addEventListener("click", async (ev) => {
    const t = ev.target;
    const btn = t && t.closest ? t.closest("button[data-mc-action]") : null;
    if (!btn) return;
    const action = String(btn.dataset.mcAction || "").trim();
    const code = String(btn.dataset.code || "").trim().toUpperCase();
    if (!code) return;
    if (action === "copy") {
      try {
        await navigator.clipboard.writeText(code);
        setStatus(`Código copiado: ${code}`);
      } catch {
        setStatus(`Copia manual: ${code}`);
      }
      return;
    }
    if (action === "regen") {
      socket.emit("lobby_regen_match_code", { code });
    }
  });
}

socket.on("round_reset", () => {
  if (IS_TOURNAMENT) return;
  enableChoices(false);
  resetResult();
  clearLoserFx();
  if (p1Throw) p1Throw.hidden = true;
  if (p2Throw) p2Throw.hidden = true;
  if (IS_DUEL_ADMIN) {
    if (duelAdminP1Choice) duelAdminP1Choice.textContent = "—";
    if (duelAdminP2Choice) duelAdminP2Choice.textContent = "—";
  }
});

socket.on("countdown", (payload) => {
  if (IS_TOURNAMENT) return;
  if (!payload) return;
  setCountdownLabel("Comienza en");
  showCountdown(payload.seconds);
});

socket.on("pick_timer", (payload) => {
  if (IS_TOURNAMENT) return;
  if (!payload) return;
  setCountdownLabel("Tiempo");
  showCountdown(payload.seconds);
});

socket.on("round_started", () => {
  if (IS_TOURNAMENT) return;
  setCountdownLabel("Tiempo");
  enableChoices(true);
  resetResult();
  clearLoserFx();
  hideTieModal();
  if (p1Throw) p1Throw.hidden = true;
  if (p2Throw) p2Throw.hidden = true;
});

socket.on("choice_registered", (payload) => {
  if (IS_TOURNAMENT) return;
  enableChoices(false);
  const c = payload && payload.choice ? payload.choice : "";
  for (const b of buttons) {
    if (b.dataset.choice === c) b.classList.add("btn--selected");
  }
  setStatus("Jugada elegida. Esperando al rival...");
});

socket.on("round_result", (payload) => {
  if (IS_TOURNAMENT) return;
  enableChoices(false);
  const p1ChoiceRaw = payload && payload.player_1_choice ? String(payload.player_1_choice) : "";
  const p2ChoiceRaw = payload && payload.player_2_choice ? String(payload.player_2_choice) : "";
  const p1Img = choiceImg(p1ChoiceRaw);
  const p2Img = choiceImg(p2ChoiceRaw);
  if (p1Throw) {
    if (p1Img) {
      p1Throw.src = p1Img;
      p1Throw.hidden = false;
    } else {
      p1Throw.hidden = true;
    }
  }
  if (p2Throw) {
    if (p2Img) {
      p2Throw.src = p2Img;
      p2Throw.hidden = false;
    } else {
      p2Throw.hidden = true;
    }
  }
  const p1 = choiceLabel(payload.player_1_choice);
  const p2 = choiceLabel(payload.player_2_choice);
  const n1 = p1Name ? String(p1Name.textContent || "").trim() : "Jugador 1";
  const n2 = p2Name ? String(p2Name.textContent || "").trim() : "Jugador 2";
  const r = payload && Number.isFinite(payload.round) ? payload.round : 0;
  const rt = payload && Number.isFinite(payload.rounds_total) ? payload.rounds_total : 3;
  const s1 = payload && Number.isFinite(payload.p1_score) ? payload.p1_score : 0;
  const s2 = payload && Number.isFinite(payload.p2_score) ? payload.p2_score : 0;
  if (matchScore && r) matchScore.textContent = `Ronda ${r}/${rt} · ${s1}-${s2}`;
  const roundTxt = r ? ` · Ronda ${r}/${rt} · ${s1}-${s2}` : "";
  const detail = `${n1}: ${p1} · ${n2}: ${p2}${roundTxt}`;
  showResult(payload.result_text || "Resultado", detail);
  const winnerSide = payload ? Number.parseInt(String(payload.winner_side ?? "0"), 10) : 0;
  if (winnerSide === 1 || winnerSide === 2) {
    triggerLoserFx(winnerSide);
  } else if (winnerSide === 0 && (p1ChoiceRaw || p2ChoiceRaw)) {
    // Solo si al menos uno eligió (evitar flash si nadie tiró nada en absoluto)
    flashTieLabel(2000);
    triggerTieClash();
  }
});

socket.on("duel_finished", (payload) => {
  if (IS_TOURNAMENT || IS_LOBBY) return;
  const s1 = payload && Number.isFinite(payload.p1_score) ? payload.p1_score : 0;
  const s2 = payload && Number.isFinite(payload.p2_score) ? payload.p2_score : 0;
  const rt = payload && Number.isFinite(payload.rounds_total) ? payload.rounds_total : 3;
  setStatus(`Partida terminada (${rt} rondas) · ${s1}-${s2}`);
  enableChoices(false);
  hideTieModal();
});

socket.on("tie_break_start", (payload) => {
  if (IS_TOURNAMENT || IS_LOBBY) return;
  enableChoices(false);
  clearLoserFx();
  const p1Name = payload && payload.p1_name ? String(payload.p1_name) : (p1Name ? String(p1Name.textContent || "") : "Jugador 1");
  const p2Name = payload && payload.p2_name ? String(payload.p2_name) : (p2Name ? String(p2Name.textContent || "") : "Jugador 2");
  const durationMs = payload ? Number.parseInt(String(payload.duration_ms ?? "5000"), 10) : 5000;
  
  // Mostrar letrero de EMPATE antes de la ruleta
  flashTieLabel(2500);
  triggerTieClash();
  setStatus("¡Empate final! Preparando ruleta...");

  setTimeout(() => {
    showTieModal({ p1Name, p2Name, durationMs });
    setStatus("Ruleta decidiendo el ganador...");
  }, 2500);
});

socket.on("tie_break_result", (payload) => {
  if (IS_TOURNAMENT || IS_LOBBY) return;
  const w = payload ? Number.parseInt(String(payload.winner_side ?? "0"), 10) : 0;
  const s1 = payload && Number.isFinite(payload.p1_score) ? payload.p1_score : 0;
  const s2 = payload && Number.isFinite(payload.p2_score) ? payload.p2_score : 0;
  setStatus(`Ruleta decidió · ${s1}-${s2}`);
  if (w === 1 || w === 2) triggerLoserFx(w);
  setTimeout(() => exitTieModal(), 650);
});

socket.on("duel_redirect", (payload) => {
  if (IS_TOURNAMENT || IS_LOBBY) return;
  const url = payload && payload.url ? String(payload.url).trim() : "";
  if (!url) return;
  setStatus("Pasas de ronda. Entrando a tu siguiente sala...");
  try {
    window.location.href = url;
  } catch {}
});

socket.on("duel_eliminated", (payload) => {
  if (IS_TOURNAMENT || IS_LOBBY) return;
  const text = payload && payload.text ? String(payload.text) : "Eliminado";
  setStatus(text);
  enableChoices(false);
  setTimeout(() => {
    try {
      window.location.href = "/perdiste";
    } catch {}
  }, 80);
});

socket.on("room_full", (payload) => {
  setConnectionPill("bad", "Sala llena");
  setStatus((payload && payload.text) || "La sala ya tiene 2 jugadores.");
  enableChoices(false);
});

socket.on("error_message", (payload) => {
  const text = (payload && payload.text) || "Error";
  setStatus(text);
});

socket.on("tournament_status", (payload) => {
  if (!IS_TOURNAMENT) return;
  if (!payload || !payload.text) return;
  setStatus(payload.text);
});

socket.on("tournament_bracket", (payload) => {
  if (!IS_TOURNAMENT) return;
  renderBracket(payload);
});

socket.on("tournament_state", (payload) => {
  if (!IS_TOURNAMENT) return;
  if (payload && payload.players) renderTournamentPlayers(payload.players);
  const active = payload && payload.active ? payload.active : null;
  const myName = youAre ? youAre.textContent.trim() : "";
  const isAdmin = tournamentRole && tournamentRole.textContent === "Organizador";
  const winnerProfile = payload && payload.winner_profile ? payload.winner_profile : null;
  renderWinnerProfile(winnerProfile);

  if (startNextBtn) {
    startNextBtn.disabled = true;
    if (isAdmin) {
      const ok = Boolean(payload && payload.bracket_generated && !payload.has_active && payload.has_pending);
      startNextBtn.disabled = !ok;
      startNextBtn.hidden = false;
    }
  }

  if (generateBracketBtn) {
    generateBracketBtn.disabled = true;
    if (isAdmin) {
      const ok = Boolean(payload && payload.players_full && !payload.bracket_generated);
      generateBracketBtn.disabled = !ok;
      generateBracketBtn.hidden = false;
    }
  }

  if (forceBattleBtn) {
    forceBattleBtn.hidden = !isAdmin;
    forceBattleBtn.disabled = !(isAdmin && active && active.status === "ready");
  }

  if (!active) {
    if (lastRevealed && Date.now() - lastRevealed.ts < 60000) {
      if (tournamentActive) tournamentActive.hidden = false;
      if (readyBtn) readyBtn.hidden = true;
      setCurrentMatchPlayers(lastRevealed.p1, lastRevealed.p2);
      showThrows(lastRevealed.p1_choice, lastRevealed.p2_choice);
      enableChoices(false);
      setCountdownLabel("Comienza en");
      showCountdown("—");
      return;
    }
    if (tournamentActive) tournamentActive.hidden = true;
    if (readyBtn) readyBtn.hidden = true;
    setCurrentMatchPlayers("", "");
    resetThrows();
    enableChoices(false);
    setCountdownLabel("Comienza en");
    showCountdown("—");
    return;
  }

  if (tournamentActive) tournamentActive.hidden = false;
  setCurrentMatchPlayers(active.p1, active.p2);
  resetThrows();
  showThrowWaiting();
  if (MODE === "admin_dashboard" && active.status === "picking") {
    showThrowProgress(Boolean(active.p1_threw), Boolean(active.p2_threw));
  }
  const isPlayerInMatch = myName === currentMatchPlayers.p1 || myName === currentMatchPlayers.p2;

  if (readyBtn) {
    readyBtn.hidden = !(active.status === "ready" && isPlayerInMatch);
    readyBtn.disabled = false;
  }
  enableChoices(false);
});

function pushTournamentFx(type, name) {
  if (!IS_TOURNAMENT) return;
  tournamentFxQueue.push({ type, name: normalizeName(name) });
  if (!tournamentFxShowing) runTournamentFxQueue();
}

function runTournamentFxQueue() {
  const wrap = document.getElementById("tournamentFx");
  const badgeEl = document.getElementById("tournamentFxBadge");
  const nameEl = document.getElementById("tournamentFxName");
  const subEl = document.getElementById("tournamentFxSub");
  if (!wrap || !badgeEl || !nameEl || !subEl) {
    tournamentFxQueue = [];
    tournamentFxShowing = false;
    return;
  }
  const next = tournamentFxQueue.shift();
  if (!next) {
    tournamentFxShowing = false;
    wrap.hidden = true;
    return;
  }
  tournamentFxShowing = true;
  const n = next.name || "—";
  const type = String(next.type || "").toLowerCase();
  wrap.className = type === "champion" ? "fx fx--champ" : type === "levelup" ? "fx fx--ok" : "fx";
  badgeEl.textContent = type === "champion" ? "Campeón" : type === "levelup" ? "Sube de nivel" : "Eliminado";
  nameEl.textContent = n;
  subEl.textContent =
    type === "champion"
      ? "Felicidades quedaste campeón"
      : type === "levelup"
        ? "Subiste de nivel"
        : "Has quedado eliminado";
  wrap.hidden = false;
  speakSfx(type);
  window.setTimeout(() => {
    wrap.hidden = true;
    runTournamentFxQueue();
  }, 3000);
}

socket.on("tournament_match_started", (payload) => {
  if (!IS_TOURNAMENT) return;
  const myName = youAre ? youAre.textContent.trim() : "";
  const p1 = (payload && payload.p1) || "Jugador";
  const p2 = (payload && payload.p2) || "Jugador";
  lastRevealed = null;
  setCurrentMatchPlayers(p1, p2);
  if (tournamentActive) tournamentActive.hidden = false;
  if (readyBtn) readyBtn.hidden = !(myName === currentMatchPlayers.p1 || myName === currentMatchPlayers.p2);
  enableChoices(false);
  resetThrows();
  showThrowWaiting();
  resetResult();
  setCountdownLabel("Comienza en");
  showCountdown("—");
});

socket.on("tournament_ready_update", (payload) => {
  if (!IS_TOURNAMENT) return;
  const p1Ready = payload && payload.p1_ready ? "Listo" : "No listo";
  const p2Ready = payload && payload.p2_ready ? "Listo" : "No listo";
  if (activeMatchText) activeMatchText.textContent = `${currentMatchPlayers.p1} vs ${currentMatchPlayers.p2} · ${p1Ready}/${p2Ready}`;
});

socket.on("tournament_countdown", (payload) => {
  if (!IS_TOURNAMENT) return;
  setCountdownLabel("Comienza en");
  showCountdown(payload.seconds);
  enableChoices(false);
});

socket.on("tournament_pick_started", (payload) => {
  if (!IS_TOURNAMENT) return;
  const myName = youAre ? youAre.textContent.trim() : "";
  const isPlayer = myName === currentMatchPlayers.p1 || myName === currentMatchPlayers.p2;
  setCountdownLabel("Tiempo");
  resetThrows();
  showThrowWaiting();
  resetResult();
  enableChoices(isPlayer);
  const sec = payload && typeof payload.seconds === "number" ? payload.seconds : 60;
  showCountdown(sec);
});

socket.on("tournament_pick_timer", (payload) => {
  if (!IS_TOURNAMENT) return;
  setCountdownLabel("Tiempo");
  showCountdown(payload.seconds);
});

socket.on("tournament_choice_registered", (payload) => {
  if (!IS_TOURNAMENT) return;
  enableChoices(false);
  const c = payload && payload.choice ? payload.choice : "";
  for (const b of buttons) {
    if (b.dataset.choice === c) b.classList.add("btn--selected");
  }
  setStatus("Jugada elegida. Esperando que termine el tiempo...");
});

socket.on("tournament_threw_update", (payload) => {
  if (MODE !== "admin_dashboard") return;
  if (!payload) return;
  showThrowProgress(Boolean(payload.p1_threw), Boolean(payload.p2_threw));
});

socket.on("tournament_admin_peek", (payload) => {
  if (MODE !== "admin_dashboard") return;
  if (!payload) return;
  showAdminPeek(payload.p1_choice, payload.p2_choice);
});

socket.on("tournament_result", (payload) => {
  if (!IS_TOURNAMENT) return;
  enableChoices(false);
  lastRevealed = {
    p1: currentMatchPlayers.p1 || "Jugador A",
    p2: currentMatchPlayers.p2 || "Jugador B",
    p1_choice: payload && payload.p1_choice ? payload.p1_choice : "",
    p2_choice: payload && payload.p2_choice ? payload.p2_choice : "",
    ts: Date.now(),
  };
  const p1 = choiceLabel(payload && payload.p1_choice);
  const p2 = choiceLabel(payload && payload.p2_choice);
  const detail = `${currentMatchPlayers.p1 || "Jugador A"}: ${p1} · ${currentMatchPlayers.p2 || "Jugador B"}: ${p2}`;
  showResult((payload && payload.result) || "Resultado", detail);
  showThrows(payload && payload.p1_choice, payload && payload.p2_choice);
  setCountdownLabel("Comienza en");
  showCountdown("—");

  const repeat = Boolean(payload && payload.repeat);
  const winner = payload && payload.winner ? String(payload.winner).trim() : "";
  if (!repeat && winner) {
    const p1n = currentMatchPlayers.p1 || "Jugador A";
    const p2n = currentMatchPlayers.p2 || "Jugador B";
    const loser = winner.toUpperCase() === p1n.toUpperCase() ? p2n : p1n;
    pushTournamentFx("eliminated", loser);
    if (tournamentFinishedWinnerName && tournamentFinishedWinnerName.toUpperCase() === winner.toUpperCase()) {
      pushTournamentFx("champion", winner);
    } else {
      pushTournamentFx("levelup", winner);
    }
  }
});

socket.on("tournament_finished", (payload) => {
  if (!IS_TOURNAMENT) return;
  enableChoices(false);
  const winner = (payload && payload.winner) || "—";
  tournamentFinishedWinnerName = String(winner || "").trim();
  let replaced = false;
  tournamentFxQueue = tournamentFxQueue.map((it) => {
    if (replaced) return it;
    if (it && it.type === "levelup" && String(it.name || "").toUpperCase() === tournamentFinishedWinnerName.toUpperCase()) {
      replaced = true;
      return { type: "champion", name: it.name };
    }
    return it;
  });
  if (!replaced && tournamentFinishedWinnerName) pushTournamentFx("champion", tournamentFinishedWinnerName);
  showResult(`Campeón: ${winner}`, "Torneo finalizado");
  renderWinnerProfile(payload && payload.profile ? payload.profile : null);
  if (startNextBtn) startNextBtn.disabled = true;
  if (readyBtn) readyBtn.hidden = true;
});

socket.on("tournament_regen_code_done", async (payload) => {
  if (MODE !== "admin_dashboard") return;
  const oldCode = payload && payload.old_code ? String(payload.old_code).trim().toUpperCase() : "";
  const newCode = payload && payload.new_code ? String(payload.new_code).trim().toUpperCase() : "";
  if (!oldCode || !newCode) return;
  const nodes = document.querySelectorAll(".adminDash__code");
  for (const n of nodes) {
    const el = n;
    const t = (el.dataset.code || el.textContent || "").toString().trim().toUpperCase();
    if (t === oldCode) {
      el.textContent = newCode;
      el.dataset.code = newCode;
    }
  }
  setStatus(`Código actualizado: ${oldCode} → ${newCode}`);
  try {
    await navigator.clipboard.writeText(newCode);
  } catch {
    // ignore
  }
});

function renderWinnerProfile(profile) {
  const sec = document.getElementById("winnerSection");
  const nameEl = document.getElementById("winnerName");
  const nameEl2 = document.getElementById("winnerName2");
  const accountTypeEl = document.getElementById("winnerAccountType");
  const accountEl = document.getElementById("winnerAccount");
  const details = document.getElementById("winnerDetails");
  const btn = document.getElementById("winnerDetailsBtn");
  if (!sec || !nameEl || !accountEl || !details || !btn || !accountTypeEl) return;
  details.hidden = true;
  if (!profile) {
    nameEl.textContent = "—";
    if (nameEl2) nameEl2.textContent = "—";
    accountTypeEl.textContent = "—";
    accountEl.textContent = "—";
    btn.disabled = true;
    return;
  }
  btn.disabled = false;
  const displayName = profile.name || "—";
  nameEl.textContent = displayName;
  if (nameEl2) nameEl2.textContent = displayName;
  accountTypeEl.textContent = profile.account_type || "—";
  accountEl.textContent = profile.account || "—";
}

(() => {
  const btn = document.getElementById("winnerDetailsBtn");
  const details = document.getElementById("winnerDetails");
  if (!btn || !details) return;
  btn.addEventListener("click", () => {
    details.hidden = !details.hidden;
  });
})();

(() => {
  if (MODE !== "admin_dashboard") return;
  window.addEventListener("DOMContentLoaded", () => {
    const msg = document.getElementById("codesCopyMsg");
    const modal = document.getElementById("codeModal");
    const modalOverlay = document.getElementById("codeModalOverlay");
    const modalCode = document.getElementById("codeModalCode");
    const modalCopyBtn = document.getElementById("codeModalCopyBtn");
    const modalUpdateBtn = document.getElementById("codeModalUpdateBtn");
    const modalCloseBtn = document.getElementById("codeModalCloseBtn");
    let activeEl = null;
    let activeCode = "";

    function setMsg(text) {
      if (!msg) return;
      msg.textContent = text;
      if (!text) return;
      window.setTimeout(() => {
        if (msg.textContent === text) msg.textContent = "";
      }, 1800);
    }

    function openModal(code, el) {
      activeEl = el || null;
      activeCode = (code || "").toString().trim().toUpperCase();
      if (modalCode) modalCode.textContent = activeCode || "—";
      if (modal) modal.hidden = false;
    }

    function closeModal() {
      if (modal) modal.hidden = true;
      activeEl = null;
      activeCode = "";
    }

    const nodes = document.querySelectorAll(".adminDash__code");
    for (const n of nodes) {
      const el = n;
      const code = (el.textContent || "").toString().trim().toUpperCase();
      if (code) el.dataset.code = code;
      el.addEventListener("click", () => {
        const oldCode = (el.dataset.code || el.textContent || "").toString().trim().toUpperCase();
        if (!oldCode) return;
        openModal(oldCode, el);
      });
      el.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter") return;
        const oldCode = (el.dataset.code || el.textContent || "").toString().trim().toUpperCase();
        if (!oldCode) return;
        openModal(oldCode, el);
      });
    }

    if (modalOverlay) modalOverlay.addEventListener("click", closeModal);
    if (modalCloseBtn) modalCloseBtn.addEventListener("click", closeModal);

    if (modalCopyBtn) {
      modalCopyBtn.addEventListener("click", () => {
        const text = activeCode;
        if (!text) return;
        navigator.clipboard
          .writeText(text)
          .then(() => setMsg(`Copiado: ${text}`))
          .catch(() => setMsg(`No se pudo copiar: ${text}`));
        closeModal();
      });
    }

    if (modalUpdateBtn) {
      modalUpdateBtn.addEventListener("click", () => {
        const oldCode = activeCode;
        if (!oldCode) return;
        const ok = window.confirm(`¿Actualizar código?\n\n${oldCode}\n\nSe generará uno nuevo y este quedará inválido.`);
        if (!ok) return;
        if (activeEl) activeEl.textContent = "ACTUALIZANDO...";
        socket.emit("tournament_regen_code", { old_code: oldCode });
        closeModal();
      });
    }
  });
})();

(() => {
  if (!IS_LOBBY) return;
  function actionFromButton(target) {
    const btn = target && target.closest ? target.closest("button[data-action][data-handle]") : null;
    if (!btn) return null;
    const action = String(btn.dataset.action || "").trim().toLowerCase();
    const handle = String(btn.dataset.handle || "").trim();
    if (!action || !handle) return null;
    return { action, handle };
  }

  function onListClick(ev) {
    const a = actionFromButton(ev.target);
    if (!a) return;
    if (MODE !== "lobby_admin") return;
    if (a.action === "approve") socket.emit("lobby_approve", { handle: a.handle });
    else if (a.action === "kick") socket.emit("lobby_kick", { handle: a.handle });
    else if (a.action === "winner") socket.emit("lobby_mark_winner", { handle: a.handle });
  }

  if (lobbyPending) lobbyPending.addEventListener("click", onListClick);
  if (lobbyTables) lobbyTables.addEventListener("click", onListClick);

  if (MODE !== "lobby_admin") return;

  if (lobbySetRequiredBtn) {
    lobbySetRequiredBtn.addEventListener("click", () => {
      const v = lobbyRequiredInput ? Number.parseInt(String(lobbyRequiredInput.value || "0"), 10) : 0;
      socket.emit("lobby_config", {
        required_value: Number.isFinite(v) ? v : 0,
      });
    });
  }

  if (lobbyAddDonationBtn) {
    lobbyAddDonationBtn.addEventListener("click", () => {
      const handle = lobbyDonorHandle ? String(lobbyDonorHandle.value || "").trim() : "";
      const gift_name = lobbyGiftName ? String(lobbyGiftName.value || "").trim() : "";
      const gift_value = lobbyGiftValue ? Number.parseFloat(String(lobbyGiftValue.value || "0")) : 0;
      const avatar_url = lobbyAvatarUrl ? String(lobbyAvatarUrl.value || "").trim() : "";
      socket.emit("lobby_add_donation", { handle, avatar_url, gift_name, gift_value, gift_count: 1 });
      if (lobbyDonorHandle) lobbyDonorHandle.value = "";
    });
  }
})();

for (const b of buttons) {
  b.addEventListener("click", () => {
    if (b.disabled) return;
    const choice = b.dataset.choice;
    enableChoices(false);
    socket.emit("make_choice", { choice });
  });
}

if (startNextBtn) {
  startNextBtn.addEventListener("click", () => {
    if (!IS_TOURNAMENT) return;
    startNextBtn.disabled = true;
    socket.emit("tournament_start_next");
  });
}

if (generateBracketBtn) {
  generateBracketBtn.addEventListener("click", () => {
    if (!IS_TOURNAMENT) return;
    generateBracketBtn.disabled = true;
    socket.emit("tournament_generate_bracket");
  });
}

if (forceBattleBtn) {
  forceBattleBtn.addEventListener("click", () => {
    if (!IS_TOURNAMENT) return;
    forceBattleBtn.disabled = true;
    socket.emit("tournament_force_battle");
  });
}

if (readyBtn) {
  readyBtn.addEventListener("click", () => {
    if (!IS_TOURNAMENT) return;
    readyBtn.disabled = true;
    socket.emit("tournament_ready");
  });
}

if (copyBtn) {
  copyBtn.addEventListener("click", async () => {
    const text = (shareUrlText && shareUrlText.textContent) ? shareUrlText.textContent.trim() : "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      if (copyMsg) copyMsg.textContent = "Enlace copiado.";
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        if (copyMsg) copyMsg.textContent = "Enlace copiado.";
      } catch {
        if (copyMsg) copyMsg.textContent = "No se pudo copiar. Copia manualmente el enlace.";
      }
    }
  });
}
