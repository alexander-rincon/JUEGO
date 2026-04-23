const ROOM_ID = (window.__ROOM_ID__ || "").toString().trim().toUpperCase();
const MODE = (window.__MODE__ || "duel").toString().trim().toLowerCase();
const MAX_PLAYERS = Number.isFinite(window.__MAX_PLAYERS__) ? Number(window.__MAX_PLAYERS__) : 2;
const PLAYER_KEY = (window.__PLAYER_KEY__ || "").toString().trim();
const SPECTATOR_KEY = (window.__SPECTATOR_KEY__ || "").toString().trim().toUpperCase();
const IS_TOURNAMENT = MODE === "tournament" || MODE === "admin_dashboard";

const $ = (id) => document.getElementById(id);

const connectionPill = $("connectionPill");
const youAre = $("youAre");
const statusText = $("statusText");
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
const playersBox = $("playersBox");

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

const buttons = [
  $("btnPiedra"),
  $("btnPapel"),
  $("btnTijera"),
].filter(Boolean);

let currentMatchPlayers = { p1: "", p2: "" };
let lastRevealed = null;

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
}

function choiceLabel(choice) {
  if (choice === "piedra") return "Piedra";
  if (choice === "papel") return "Papel";
  if (choice === "tijera") return "Tijera";
  return "—";
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
  socket.emit("join", { room_id: ROOM_ID, mode: "duel" });
});

socket.on("disconnect", () => {
  setConnectionPill("bad", "Desconectado");
  setStatus("Se perdió la conexión. Reintentando...");
  enableChoices(false);
});

socket.on("joined", (payload) => {
  const myName = payload.you_are || "Jugador";
  if (youAre) youAre.textContent = myName;
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
  if (IS_TOURNAMENT) return;
  setPlayers(payload);
  const count = payload && payload.count ? payload.count : 0;
  if (count < 2) {
    enableChoices(false);
    showCountdown("—");
  }
});

socket.on("status", (payload) => {
  if (IS_TOURNAMENT) return;
  if (!payload || !payload.text) return;
  setStatus(payload.text);
});

socket.on("round_reset", () => {
  if (IS_TOURNAMENT) return;
  enableChoices(false);
  resetResult();
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
  const p1 = choiceLabel(payload.player_1_choice);
  const p2 = choiceLabel(payload.player_2_choice);
  const detail = `Jugador 1: ${p1} · Jugador 2: ${p2}`;
  showResult(payload.result_text || "Resultado", detail);
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
  const isPlayerInMatch = myName === currentMatchPlayers.p1 || myName === currentMatchPlayers.p2;

  if (readyBtn) {
    readyBtn.hidden = !(active.status === "ready" && isPlayerInMatch);
    readyBtn.disabled = false;
  }
  enableChoices(false);
});

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
});

socket.on("tournament_finished", (payload) => {
  if (!IS_TOURNAMENT) return;
  enableChoices(false);
  const winner = (payload && payload.winner) || "—";
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
