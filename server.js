const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

const ejs = require("ejs");
const express = require("express");
const session = require("express-session");
const QRCode = require("qrcode");
const { Server } = require("socket.io");

const ADMIN_USER_DEFAULT = "ADMIN";
const ADMIN_PASSWORD_DEFAULT = "12345";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateRoomId(length = 6) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < length; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function generateInviteCode(length = 8) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < length; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function generateSecret(length = 24) {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < length; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function baseUrlForReq(req) {
  const envBase = (process.env.PUBLIC_BASE_URL || "").trim();
  if (envBase) return envBase.replace(/\/+$/, "");
  const proto = (req.headers["x-forwarded-proto"] || req.protocol || "http").toString().split(",")[0].trim();
  const host = (req.headers["x-forwarded-host"] || req.get("host") || "").toString().split(",")[0].trim();
  return `${proto}://${host}`.replace(/\/+$/, "");
}

function instancePath() {
  return path.join(__dirname, "instance");
}

function adminCredsFilePath() {
  return path.join(instancePath(), "admin_credentials.json");
}

function loadAdminCredentials() {
  const envUser = (process.env.ADMIN_USER || "").trim();
  const envPass = process.env.ADMIN_PASSWORD || "";
  if (envUser && envPass) return { user: envUser, password: envPass };
  return { user: ADMIN_USER_DEFAULT, password: ADMIN_PASSWORD_DEFAULT };
}

function winnerForChoices(c1, c2) {
  if (c1 === c2) return 0;
  const winsAgainst = { piedra: "tijera", tijera: "papel", papel: "piedra" };
  return winsAgainst[c1] === c2 ? 1 : 2;
}

function tournamentNameForCode(room, code) {
  if (!code) return "—";
  const prof = room.profiles.get(code);
  if (prof && prof.name) return prof.name;
  return `Jugador ${code}`;
}

function tournamentProfilePayload(room, code) {
  if (!code) return null;
  const prof = room.profiles.get(code);
  return {
    code,
    name: (prof && prof.name) || tournamentNameForCode(room, code),
    account_type: (prof && prof.account_type) || "",
    account: (prof && prof.account) || "",
  };
}

function tournamentRegisteredPayload(room) {
  const items = room.invite_codes.map((code) => {
    const prof = room.profiles.get(code);
    return {
      code,
      redeemed: room.redeemed_codes.has(code),
      name: prof ? prof.name : "",
      connected: room.code_to_sid.has(code),
    };
  });
  return { count: room.redeemed_codes.size, max: room.max_players, players: items };
}

function tournamentBracketPayload(room) {
  const rounds = room.rounds.map((rnd, rIdx) => {
    const matches = rnd.matches.map((m, mIdx) => ({
      round: rIdx,
      match: mIdx,
      p1: tournamentNameForCode(room, m.p1_code),
      p2: tournamentNameForCode(room, m.p2_code),
      status: m.status,
      winner: tournamentNameForCode(room, m.winner_code),
    }));
    return { round: rIdx, matches };
  });
  return { round_index: room.round_index, rounds };
}

function tournamentStatePayload(room) {
  let active = null;
  if (room.active_round != null && room.active_match != null) {
    const m = room.rounds[room.active_round]?.matches?.[room.active_match];
    if (m) {
      const p1_threw = m.choices.has(m.p1_code);
      const p2_threw = m.p2_code ? m.choices.has(m.p2_code) : false;
      active = {
        round: room.active_round,
        match: room.active_match,
        p1: tournamentNameForCode(room, m.p1_code),
        p2: tournamentNameForCode(room, m.p2_code),
        status: m.status,
        p1_threw,
        p2_threw,
      };
    }
  }

  const has_active = room.active_round != null && room.active_match != null;
  const players_full = room.redeemed_codes.size === room.max_players;
  let has_pending = false;
  if (room.state === "in_progress" && room.rounds.length) {
    const current = room.rounds[room.round_index]?.matches || [];
    for (const m of current) {
      if (m.status === "pending" && m.p2_code != null) {
        has_pending = true;
        break;
      }
    }
  }

  return {
    state: room.state,
    prize: room.prize,
    battle_seconds: room.battle_seconds,
    countdown_seconds: room.countdown_seconds,
    players: tournamentRegisteredPayload(room),
    active,
    players_full,
    has_active,
    has_pending,
    bracket_generated: room.bracket_generated,
    winner_profile: tournamentProfilePayload(room, room.final_winner_code),
  };
}

function buildRoundFromCodes(codes) {
  const matches = [];
  for (let i = 0; i < codes.length; i += 2) {
    const p1 = codes[i];
    const p2 = i + 1 < codes.length ? codes[i + 1] : null;
    const m = {
      p1_code: p1,
      p2_code: p2,
      status: "pending",
      ready: new Set(),
      choices: new Map(),
      winner_code: null,
      loser_code: null,
    };
    if (p2 == null) {
      m.status = "done";
      m.winner_code = p1;
    }
    matches.push(m);
  }
  return { matches };
}

function advanceIfRoundComplete(room, io) {
  if (room.state !== "in_progress") return;
  if (!room.rounds.length) return;
  const current = room.rounds[room.round_index]?.matches || [];
  if (current.some((m) => m.status !== "done")) return;
  const winners = current.map((m) => m.winner_code).filter(Boolean);
  if (winners.length <= 1) {
    room.state = "finished";
    room.final_winner_code = winners[0] || room.final_winner_code;
    room.active_round = null;
    room.active_match = null;
    return;
  }
  room.round_index += 1;
  if (room.round_index >= room.rounds.length) room.rounds.push(buildRoundFromCodes(winners));
  room.active_round = null;
  room.active_match = null;
  io.to(room.room_id).emit("tournament_bracket", tournamentBracketPayload(room));
  io.to(room.room_id).emit("tournament_state", tournamentStatePayload(room));
}

function tournamentStartNextMatch(room) {
  if (room.state !== "in_progress") return null;
  if (room.active_round != null || room.active_match != null) return null;
  const rnd = room.rounds[room.round_index]?.matches || [];
  for (let idx = 0; idx < rnd.length; idx += 1) {
    const m = rnd[idx];
    if (m.status === "pending" && m.p2_code != null) {
      m.status = "ready";
      m.ready.clear();
      m.choices.clear();
      m.winner_code = null;
      m.loser_code = null;
      room.active_round = room.round_index;
      room.active_match = idx;
      return m;
    }
  }
  return null;
}

function tournamentFinishActiveAsWin(room, io, winner_code, loser_code) {
  if (room.active_round == null || room.active_match == null) return;
  const m = room.rounds[room.active_round]?.matches?.[room.active_match];
  if (!m) return;
  m.status = "done";
  m.winner_code = winner_code;
  m.loser_code = loser_code || null;
  room.active_round = null;
  room.active_match = null;

  advanceIfRoundComplete(room, io);

  if (room.state === "finished") {
    room.final_winner_code = winner_code;
    io.to(room.room_id).emit("tournament_finished", {
      winner: tournamentNameForCode(room, winner_code),
      profile: tournamentProfilePayload(room, winner_code),
    });
  }

  io.to(room.room_id).emit("tournament_bracket", tournamentBracketPayload(room));
  io.to(room.room_id).emit("tournament_state", tournamentStatePayload(room));
}

function tournamentResolveActivePick(room, io) {
  if (room.active_round == null || room.active_match == null) return;
  const m = room.rounds[room.active_round]?.matches?.[room.active_match];
  if (!m) return;
  if (m.status !== "picking") return;
  const c1 = m.choices.get(m.p1_code) || "";
  const c2 = m.p2_code ? m.choices.get(m.p2_code) || "" : "";

  const p1Name = tournamentNameForCode(room, m.p1_code);
  const p2Name = tournamentNameForCode(room, m.p2_code);

  if (!c1 && !c2) {
    m.status = "ready";
    m.ready.clear();
    m.choices.clear();
    io.to(room.room_id).emit("tournament_result", {
      result: "Nadie eligió. Repitan la pelea.",
      p1_choice: "",
      p2_choice: "",
      repeat: true,
      winner: "",
    });
    io.to(room.room_id).emit("tournament_status", { text: "Presionen 'Estoy listo' otra vez." });
    io.to(room.room_id).emit("tournament_state", tournamentStatePayload(room));
    return;
  }

  if (c1 && !c2) {
    const resultText = `Gana ${p1Name} (el rival no eligió)`;
    io.to(room.room_id).emit("tournament_result", {
      result: resultText,
      p1_choice: c1,
      p2_choice: "",
      repeat: false,
      winner: p1Name,
    });
    tournamentFinishActiveAsWin(room, io, m.p1_code, m.p2_code);
    return;
  }

  if (c2 && !c1) {
    const resultText = `Gana ${p2Name} (el rival no eligió)`;
    io.to(room.room_id).emit("tournament_result", {
      result: resultText,
      p1_choice: "",
      p2_choice: c2,
      repeat: false,
      winner: p2Name,
    });
    tournamentFinishActiveAsWin(room, io, m.p2_code, m.p1_code);
    return;
  }

  const winner = winnerForChoices(c1, c2);
  if (winner === 0) {
    m.status = "ready";
    m.ready.clear();
    m.choices.clear();
    io.to(room.room_id).emit("tournament_result", {
      result: "¡Empate! Repitan la pelea.",
      p1_choice: c1,
      p2_choice: c2,
      repeat: true,
      winner: "",
    });
    io.to(room.room_id).emit("tournament_status", { text: "Presionen 'Estoy listo' otra vez." });
    io.to(room.room_id).emit("tournament_state", tournamentStatePayload(room));
    return;
  }

  let winnerCode;
  let loserCode;
  let winnerName;
  if (winner === 1) {
    winnerCode = m.p1_code;
    loserCode = m.p2_code;
    winnerName = p1Name;
  } else {
    winnerCode = m.p2_code;
    loserCode = m.p1_code;
    winnerName = p2Name;
  }

  io.to(room.room_id).emit("tournament_result", {
    result: `Gana ${winnerName}`,
    p1_choice: c1,
    p2_choice: c2,
    repeat: false,
    winner: winnerName,
  });
  tournamentFinishActiveAsWin(room, io, winnerCode, loserCode);
}

async function tournamentRunCountdownAndPick(room, io, countdownSeconds, battleSeconds) {
  for (let sec = countdownSeconds; sec >= 1; sec -= 1) {
    io.to(room.room_id).emit("tournament_countdown", { seconds: sec });
    await sleep(1000);
  }

  if (room.active_round == null || room.active_match == null) return;
  const m = room.rounds[room.active_round]?.matches?.[room.active_match];
  if (!m) return;
  if (m.status !== "countdown") return;
  m.status = "picking";
  m.choices.clear();

  io.to(room.room_id).emit("tournament_pick_started", { seconds: battleSeconds });
  if (room.admin_sid) {
    io.to(room.admin_sid).emit("tournament_threw_update", { p1_threw: false, p2_threw: false });
    io.to(room.admin_sid).emit("tournament_admin_peek", { p1_choice: "", p2_choice: "" });
  }
  for (let remaining = battleSeconds; remaining >= 0; remaining -= 1) {
    if (room.active_round == null || room.active_match == null) return;
    const mm = room.rounds[room.active_round]?.matches?.[room.active_match];
    if (!mm) return;
    if (mm.status !== "picking") break;
    io.to(room.room_id).emit("tournament_pick_timer", { seconds: remaining });
    await sleep(1000);
  }

  tournamentResolveActivePick(room, io);
}

const app = express();
app.engine("html", ejs.renderFile);
app.set("views", path.join(__dirname, "templates"));
app.set("view engine", "html");
app.disable("x-powered-by");

app.use(express.urlencoded({ extended: true }));
app.use("/static", express.static(path.join(__dirname, "static")));

const sessionSecret =
  process.env.SESSION_SECRET ||
  process.env.SECRET_KEY ||
  crypto.randomBytes(32).toString("hex");

const sessionMiddleware = session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    sameSite: "lax",
  },
});

app.use(sessionMiddleware);

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: (process.env.CORS_ALLOWED_ORIGINS || "*").split(",").map((s) => s.trim()) },
  pingInterval: 25_000,
  pingTimeout: 60_000,
});

io.use((socket, next) => {
  sessionMiddleware(socket.request, socket.request.res || {}, next);
});

const rooms = new Map();
const sidToRoom = new Map();
const sidToMode = new Map();
const inviteCodeToTournament = new Map();
const LOBBY_ID = "LOBBY";
const lobbyCodeToRoom = new Map();
const lobbyAdvanceQueue = new Map();
const lobby = {
  required_value: 1,
  duel_countdown_seconds: 5,
  duel_battle_seconds: 20,
  prize_value: 0,
  participants: new Map(),
  approved: new Set(),
  kicked: new Set(),
  eliminated: new Set(),
  winners: [],
  total_value: 0,
  live_connected: false,
  live_handle: "",
  bracket_size: 0,
  bracket_seeds: [],
  match_codes: [],
};
let tiktokConnection = null;
let tiktokConnectionHandle = "";

function getTikTokLiveConnector() {
  try {
    return require("tiktok-live-connector");
  } catch {
    return null;
  }
}

function formatLiveError(err) {
  if (!err) return "Error desconocido";
  if (typeof err === "string") return err;
  const msg = err && (err.message || err.reason || err.error) ? String(err.message || err.reason || err.error) : "";
  if (msg) return msg;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function lobbyPayload() {
  const participants = [];
  for (const p of lobby.participants.values()) {
    participants.push({
      handle: String(p.handle || "").trim(),
      avatar_url: String(p.avatar_url || "").trim(),
      total_value: Number.isFinite(p.total_value) ? p.total_value : 0,
      gifts: Array.isArray(p.gifts) ? p.gifts.slice(0, 25) : [],
      approved: lobby.approved.has(p.handle),
      kicked: lobby.kicked.has(p.handle),
    });
  }
  participants.sort((a, b) => (b.total_value || 0) - (a.total_value || 0));

  const pending = participants.filter((p) => !p.approved && !p.kicked);
  const approved = participants.filter((p) => p.approved && !p.kicked);
  const kicked = participants.filter((p) => p.kicked);

  const tables = [];
  for (let i = 0; i < approved.length; i += 4) tables.push(approved.slice(i, i + 4));

  const winners = Array.isArray(lobby.winners) ? lobby.winners.slice(0, 200) : [];
  const total = Number.isFinite(lobby.total_value) ? lobby.total_value : 0;
  const bracketSize = Number.isFinite(lobby.bracket_size) ? lobby.bracket_size : 0;
  const bracketSeeds = Array.isArray(lobby.bracket_seeds) ? lobby.bracket_seeds.slice(0, 32) : [];
  const matchCodes = Array.isArray(lobby.match_codes) ? lobby.match_codes.slice(0, 64) : [];

  return {
    required_value: Number.isFinite(lobby.required_value) ? lobby.required_value : 0,
    duel_countdown_seconds: Number.isFinite(lobby.duel_countdown_seconds) ? lobby.duel_countdown_seconds : 5,
    duel_battle_seconds: Number.isFinite(lobby.duel_battle_seconds) ? lobby.duel_battle_seconds : 20,
    prize_value: Number.isFinite(lobby.prize_value) ? lobby.prize_value : 0,
    total_value: total,
    pending,
    approved,
    kicked,
    tables,
    winners,
    live_connected: Boolean(lobby.live_connected),
    live_handle: String(lobby.live_handle || "").trim(),
    bracket_size: bracketSize,
    bracket_seeds: bracketSeeds,
    match_codes: matchCodes,
  };
}

function uniqueLobbyMatchCode() {
  for (let tries = 0; tries < 10000; tries += 1) {
    const c = generateInviteCode(8);
    if (!lobbyCodeToRoom.has(c)) return c;
  }
  return generateInviteCode(10);
}

function lobbyPairsFromSeeds() {
  const size = Number.isFinite(lobby.bracket_size) ? lobby.bracket_size : 0;
  const seeds = Array.isArray(lobby.bracket_seeds) ? lobby.bracket_seeds : [];
  const n = size && seeds.length ? Math.min(size, seeds.length) : 0;
  const pairs = [];
  for (let i = 0; i + 1 < n; i += 2) {
    const a = seeds[i] || {};
    const b = seeds[i + 1] || {};
    const aH = normalizeHandle(a.handle || "");
    const bH = normalizeHandle(b.handle || "");
    pairs.push({
      p1_handle: aH,
      p1_avatar: String(a.avatar_url || "").trim(),
      p2_handle: bH,
      p2_avatar: String(b.avatar_url || "").trim(),
    });
  }
  return pairs;
}

function normalizeHandle(v) {
  const raw = String(v || "").trim();
  if (!raw) return "";
  return raw.startsWith("@") ? raw : `@${raw}`;
}

function lobbyUpsertDonation({ handle, avatar_url, gift_name, gift_value, gift_count }) {
  const h = normalizeHandle(handle);
  if (!h) return { ok: false, error: "Falta @usuario." };
  if (lobby.kicked.has(h)) return { ok: false, error: "Ese usuario fue expulsado." };
  const value = Number.isFinite(gift_value) ? gift_value : Number.parseFloat(String(gift_value || "0"));
  const countRaw = Number.isFinite(gift_count) ? gift_count : Number.parseInt(String(gift_count || "1"), 10);
  const count = Number.isFinite(countRaw) && countRaw > 0 ? countRaw : 1;
  const amount = Math.max(0, Number.isFinite(value) ? value : 0) * count;
  const gift = String(gift_name || "").trim() || "Donación";

  const existing = lobby.participants.get(h);
  const p = existing || { handle: h, avatar_url: "", total_value: 0, gifts: [] };
  if (!p.avatar_url && avatar_url) p.avatar_url = String(avatar_url || "").trim();
  p.total_value = (Number.isFinite(p.total_value) ? p.total_value : 0) + amount;

  const idx = Array.isArray(p.gifts) ? p.gifts.findIndex((g) => g && g.name === gift) : -1;
  if (!Array.isArray(p.gifts)) p.gifts = [];
  if (idx >= 0) {
    p.gifts[idx].count = (Number.isFinite(p.gifts[idx].count) ? p.gifts[idx].count : 0) + count;
    p.gifts[idx].value = Number.isFinite(p.gifts[idx].value) ? p.gifts[idx].value : value;
  } else {
    p.gifts.unshift({ name: gift, count, value: Number.isFinite(value) ? value : 0 });
  }

  lobby.participants.set(h, p);
  lobby.total_value = (Number.isFinite(lobby.total_value) ? lobby.total_value : 0) + amount;

  const required = Number.isFinite(lobby.required_value) ? lobby.required_value : 0;
  const totalNow = Number.isFinite(p.total_value) ? p.total_value : 0;
  if (totalNow >= required) lobby.approved.add(h);
  return { ok: true, handle: h };
}

function getOrCreateDuelRoom(roomId) {
  const existing = rooms.get(roomId);
  if (existing && existing.type === "duel") return existing;
  const battleSeconds = Number.parseInt(process.env.DUEL_BATTLE_SECONDS || "20", 10) || 20;
  const countdownSeconds = Number.parseInt(process.env.DUEL_COUNTDOWN_SECONDS || "5", 10) || 5;
  const room = {
    type: "duel",
    room_id: roomId,
    subtree_size: 1,
    manual_start: false,
    started: true,
    slot_sids: [null, null],
    slot_profiles: [
      { handle: "", avatar_url: "" },
      { handle: "", avatar_url: "" },
    ],
    choices: new Map(),
    state: "waiting",
    countdown_task_running: false,
    admin_sids: new Set(),
    battle_seconds: Math.max(5, Math.min(300, battleSeconds)),
    countdown_seconds: Math.max(1, Math.min(20, countdownSeconds)),
    rounds_total: 3,
    round_index: 0,
    p1_wins: 0,
    p2_wins: 0,
  };
  rooms.set(roomId, room);
  return room;
}

function ensureInviteIndex() {
  for (const obj of rooms.values()) {
    if (obj && obj.type === "tournament") {
      for (const code of obj.invite_codes) inviteCodeToTournament.set(code, obj.room_id);
    }
  }
}

function isInviteCodeTaken(code) {
  const c = String(code || "").trim().toUpperCase();
  if (!c) return false;
  return inviteCodeToTournament.has(c);
}

function uniqueInviteCodes(count) {
  ensureInviteIndex();
  const out = [];
  while (out.length < count) {
    const c = generateInviteCode();
    if (isInviteCodeTaken(c)) continue;
    if (out.includes(c)) continue;
    out.push(c);
  }
  return out;
}

function getOrCreateTournament(roomId, maxPlayers) {
  const existing = rooms.get(roomId);
  if (existing && existing.type === "tournament") return existing;
  const room = {
    type: "tournament",
    room_id: roomId,
    max_players: maxPlayers,
    prize: "",
    countdown_seconds: 3,
    battle_seconds: 60,
    admin_key: generateSecret(24),
    admin_sid: null,
    spectator_code: generateInviteCode(8),
    invite_codes: [],
    redeemed_codes: new Set(),
    profiles: new Map(),
    player_keys: new Map(),
    code_to_sid: new Map(),
    sid_to_code: new Map(),
    state: "lobby",
    final_winner_code: null,
    round_index: 0,
    rounds: [],
    active_round: null,
    active_match: null,
    bracket_generated: false,
  };
  rooms.set(roomId, room);
  return room;
}

function playersPayload(room) {
  const sids = Array.isArray(room.slot_sids) ? room.slot_sids : [null, null];
  const profs = Array.isArray(room.slot_profiles) ? room.slot_profiles : [{}, {}];
  const p = [0, 1].map((idx) => {
    const sid = sids[idx] || null;
    const prof = profs[idx] || {};
    const name = prof && prof.handle ? String(prof.handle).trim() : `Jugador ${idx + 1}`;
    const avatar_url = prof && prof.avatar_url ? String(prof.avatar_url).trim() : "";
    return { sid, connected: Boolean(sid), name, avatar_url };
  });
  const count = p.filter((x) => x.connected).length;
  const roundsTotal = Number.isFinite(room.rounds_total) ? room.rounds_total : 3;
  const roundIndex = Number.isFinite(room.round_index) ? room.round_index : 0;
  const p1Wins = Number.isFinite(room.p1_wins) ? room.p1_wins : 0;
  const p2Wins = Number.isFinite(room.p2_wins) ? room.p2_wins : 0;
  return { count, players: p, score: { round: Math.min(roundIndex + 1, roundsTotal), rounds_total: roundsTotal, p1: p1Wins, p2: p2Wins } };
}

function broadcastRoomState(room) {
  io.to(room.room_id).emit("players_update", playersPayload(room));
  const sids = Array.isArray(room.slot_sids) ? room.slot_sids : [null, null];
  if (!sids[0] || !sids[1]) io.to(room.room_id).emit("status", { text: "Esperando jugador..." });
}

function lobbyMatchByRoomId(roomId) {
  const rid = String(roomId || "").trim();
  const list = Array.isArray(lobby.match_codes) ? lobby.match_codes : [];
  return list.find((m) => m && String(m.room_id || "").trim() === rid) || null;
}

function lobbyMatchByIndex(idx) {
  const n = Number(idx);
  const list = Array.isArray(lobby.match_codes) ? lobby.match_codes : [];
  return list.find((m) => m && Number(m.index) === n) || null;
}

function duelAssignProfileToSlot(duelRoom, slotIdx, profile) {
  if (!duelRoom || duelRoom.type !== "duel") return;
  const idx = slotIdx === 1 ? 1 : 0;
  if (!Array.isArray(duelRoom.slot_profiles)) duelRoom.slot_profiles = [{}, {}];
  const h = normalizeHandle(profile && profile.handle ? profile.handle : "");
  const a = String((profile && profile.avatar_url) || "").trim();
  duelRoom.slot_profiles[idx] = { handle: h, avatar_url: a };
}

function duelResetForNextMatch(duelRoom) {
  if (!duelRoom || duelRoom.type !== "duel") return;
  duelRoom.choices.clear();
  duelRoom.state = "waiting";
  duelRoom.started = false;
  duelRoom.rounds_total = 3;
  duelRoom.round_index = 0;
  duelRoom.p1_wins = 0;
  duelRoom.p2_wins = 0;
}

function lobbySetMatchPlayers(idx, p1, p2) {
  lobby.match_codes = (Array.isArray(lobby.match_codes) ? lobby.match_codes : []).map((m) => {
    if (!m || Number(m.index) !== Number(idx)) return m;
    return {
      ...m,
      p1_handle: normalizeHandle((p1 && p1.handle) || ""),
      p1_avatar: String((p1 && p1.avatar_url) || "").trim(),
      p2_handle: normalizeHandle((p2 && p2.handle) || ""),
      p2_avatar: String((p2 && p2.avatar_url) || "").trim(),
    };
  });
}

function lobbyMarkMatchWaiting(idx, subtreeSize) {
  lobby.match_codes = (Array.isArray(lobby.match_codes) ? lobby.match_codes : []).map((m) => {
    if (!m || Number(m.index) !== Number(idx)) return m;
    return {
      ...m,
      subtree_size: Number.isFinite(Number(subtreeSize)) ? Number(subtreeSize) : (Number.isFinite(m.subtree_size) ? m.subtree_size : 1),
      finished: false,
      winner_handle: "",
      loser_handle: "",
      code_used: true,
      p1_score: 0,
      p2_score: 0,
      round: 0,
      rounds_total: 3,
    };
  });
}

function lobbyTryDeliverAdvance(targetIndex, targetSubtree) {
  const q = lobbyAdvanceQueue.get(Number(targetIndex)) || [];
  if (!q.length) return;
  const mc = lobbyMatchByIndex(targetIndex);
  if (!mc || !mc.room_id) return;
  const duelRoom = rooms.get(String(mc.room_id));
  if (!duelRoom || duelRoom.type !== "duel") return;
  const roomSub = Number.isFinite(duelRoom.subtree_size) ? duelRoom.subtree_size : 1;
  const needSub = Number.isFinite(Number(targetSubtree)) ? Number(targetSubtree) : roomSub;
  if (roomSub !== needSub) return;

  const sids = Array.isArray(duelRoom.slot_sids) ? duelRoom.slot_sids : [null, null];
  const profs = Array.isArray(duelRoom.slot_profiles) ? duelRoom.slot_profiles : [{}, {}];

  while (q.length) {
    const item = q.shift();
    const sid = item && item.sid ? String(item.sid) : "";
    const profile = item && item.profile ? item.profile : null;
    const h = normalizeHandle(profile && profile.handle ? profile.handle : "");
    if (!sid || !h) continue;
    const wantSub = Number.isFinite(Number(item.targetSubtree)) ? Number(item.targetSubtree) : needSub;
    if (wantSub !== needSub) {
      q.unshift(item);
      break;
    }

    let slot = -1;
    if (normalizeHandle((profs[0] && profs[0].handle) || "") === h) slot = 0;
    else if (normalizeHandle((profs[1] && profs[1].handle) || "") === h) slot = 1;
    else if (!normalizeHandle((profs[0] && profs[0].handle) || "")) slot = 0;
    else if (!normalizeHandle((profs[1] && profs[1].handle) || "")) slot = 1;
    else break;

    duelAssignProfileToSlot(duelRoom, slot, profile);
    const nowProfs = Array.isArray(duelRoom.slot_profiles) ? duelRoom.slot_profiles : [{}, {}];
    lobbySetMatchPlayers(targetIndex, nowProfs[0] || {}, nowProfs[1] || {});

    io.to(sid).emit("duel_redirect", { url: `/juego/${encodeURIComponent(String(mc.room_id))}?h=${encodeURIComponent(h)}` });
    setTimeout(() => {
      try {
        io.sockets.sockets.get(sid)?.disconnect(true);
      } catch {}
    }, 300);
    break;
  }

  if (q.length) lobbyAdvanceQueue.set(Number(targetIndex), q);
  else lobbyAdvanceQueue.delete(Number(targetIndex));

  io.to(LOBBY_ID).emit("lobby_state", lobbyPayload());
}

function duelFinalizeMatch(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.type !== "duel") return;
  const sids = Array.isArray(room.slot_sids) ? room.slot_sids : [null, null];
  const roundsTotal = Number.isFinite(room.rounds_total) ? room.rounds_total : 3;
  const p1Name = room.slot_profiles && room.slot_profiles[0] && room.slot_profiles[0].handle ? String(room.slot_profiles[0].handle).trim() : "Jugador 1";
  const p2Name = room.slot_profiles && room.slot_profiles[1] && room.slot_profiles[1].handle ? String(room.slot_profiles[1].handle).trim() : "Jugador 2";
  const p1 = Number.isFinite(room.p1_wins) ? room.p1_wins : 0;
  const p2 = Number.isFinite(room.p2_wins) ? room.p2_wins : 0;
  if (p1 === p2) return;
  room.state = "finished";
  room.tie_break_running = false;
  room.tie_break_winner_side = 0;

  const winnerHandle = p1 > p2 ? p1Name : p2Name;
  const loserHandle = p1 > p2 ? p2Name : p1Name;
  const mcSelf = lobbyMatchByRoomId(roomId);
  const idxSelf = mcSelf && Number.isFinite(Number(mcSelf.index)) ? Number(mcSelf.index) : 0;
  const curSub = mcSelf && Number.isFinite(Number(mcSelf.subtree_size)) ? Number(mcSelf.subtree_size) : (Number.isFinite(room.subtree_size) ? room.subtree_size : 1);

  lobby.match_codes = (Array.isArray(lobby.match_codes) ? lobby.match_codes : []).map((m) => {
    if (!m || String(m.room_id || "") !== roomId) return m;
    const hist = Array.isArray(m.history) ? m.history.slice(0, 50) : [];
    hist.push({
      subtree_size: curSub,
      p1_handle: normalizeHandle(p1Name),
      p1_avatar: (room.slot_profiles && room.slot_profiles[0] && room.slot_profiles[0].avatar_url) ? String(room.slot_profiles[0].avatar_url).trim() : "",
      p2_handle: normalizeHandle(p2Name),
      p2_avatar: (room.slot_profiles && room.slot_profiles[1] && room.slot_profiles[1].avatar_url) ? String(room.slot_profiles[1].avatar_url).trim() : "",
      p1_score: p1,
      p2_score: p2,
      rounds_total: roundsTotal,
      finished: true,
      winner_handle: normalizeHandle(winnerHandle),
      loser_handle: normalizeHandle(loserHandle),
    });
    return {
      ...m,
      finished: true,
      winner_handle: normalizeHandle(winnerHandle),
      loser_handle: normalizeHandle(loserHandle),
      subtree_size: curSub,
      history: hist.slice(-50),
      code_used: true,
    };
  });
  if (mcSelf && mcSelf.code) {
    const usedCode = String(mcSelf.code).trim().toUpperCase();
    if (usedCode) lobbyCodeToRoom.delete(usedCode);
  }
  io.to(LOBBY_ID).emit("lobby_state", lobbyPayload());

  lobby.eliminated.add(normalizeHandle(loserHandle));
  const loserIdx = normalizeHandle(loserHandle) === normalizeHandle(p1Name) ? 0 : 1;
  const loserSid = sids[loserIdx];
  if (loserSid) {
    io.to(loserSid).emit("duel_eliminated", { text: "Perdiste. Quedas eliminado." });
    setTimeout(() => {
      try {
        io.sockets.sockets.get(loserSid)?.disconnect(true);
      } catch {}
    }, 1400);
  }

  const nextSub = curSub * 2;
  const winnerProfile =
    normalizeHandle(winnerHandle) === normalizeHandle(p1Name)
      ? { handle: p1Name, avatar_url: (room.slot_profiles && room.slot_profiles[0] && room.slot_profiles[0].avatar_url) ? room.slot_profiles[0].avatar_url : "" }
      : { handle: p2Name, avatar_url: (room.slot_profiles && room.slot_profiles[1] && room.slot_profiles[1].avatar_url) ? room.slot_profiles[1].avatar_url : "" };
  const winnerSid =
    normalizeHandle(winnerHandle) === normalizeHandle(p1Name)
      ? sids[0]
      : sids[1];

  if (idxSelf && winnerSid && curSub >= 16) {
    const wh = normalizeHandle(winnerProfile.handle);
    const already = (Array.isArray(lobby.winners) ? lobby.winners : []).some((w) => normalizeHandle(w && w.handle ? w.handle : "") === wh);
    if (!already) {
      const p = lobby.participants.get(wh);
      lobby.winners.unshift({
        handle: wh,
        avatar_url: String((p && p.avatar_url) ? p.avatar_url : (winnerProfile.avatar_url || "")).trim(),
        total_value: p && Number.isFinite(p.total_value) ? p.total_value : 0,
        prize_value: Number.isFinite(lobby.prize_value) ? lobby.prize_value : 0,
        at: Date.now(),
      });
      io.to(LOBBY_ID).emit("lobby_state", lobbyPayload());
      io.to(LOBBY_ID).emit("lobby_status", { text: `Ganador: ${wh}` });
    }
  }

  if (idxSelf && winnerSid && nextSub <= 16) {
    const parentIdx = idxSelf - ((idxSelf - 1) % nextSub);
    if (parentIdx === idxSelf) {
      room.subtree_size = nextSub;
      duelResetForNextMatch(room);
      room.slot_profiles = [winnerProfile, { handle: "", avatar_url: "" }];
      room.slot_sids = [winnerSid, null];
      lobbyMarkMatchWaiting(idxSelf, nextSub);
      lobbySetMatchPlayers(idxSelf, winnerProfile, {});
      io.to(LOBBY_ID).emit("lobby_state", lobbyPayload());
      io.to(winnerSid).emit("status", { text: "Pasas de ronda. Esperando rival..." });
      lobbyTryDeliverAdvance(idxSelf, nextSub);
      return;
    }

    const parent = lobbyMatchByIndex(parentIdx);
    if (parent && parent.room_id) {
      const q = lobbyAdvanceQueue.get(parentIdx) || [];
      q.push({ sid: winnerSid, profile: winnerProfile, targetSubtree: nextSub });
      lobbyAdvanceQueue.set(parentIdx, q);
      lobbyTryDeliverAdvance(parentIdx, nextSub);
      io.to(winnerSid).emit("status", { text: "Pasas de ronda. Entrando cuando la sala esté lista..." });
    }
  }

  const final = p1 > p2 ? `Gana ${p1Name} ${p1}-${p2}` : `Gana ${p2Name} ${p2}-${p1}`;
  io.to(roomId).emit("status", { text: `Partida terminada (${roundsTotal} rondas): ${final}` });
  io.to(roomId).emit("duel_finished", { p1_score: p1, p2_score: p2, rounds_total: roundsTotal });
}

async function duelRunPickTimer(roomId, battleSeconds) {
  for (let remaining = battleSeconds; remaining >= 0; remaining -= 1) {
    const room = rooms.get(roomId);
    if (!room || room.type !== "duel") return;
    if (room.state !== "playing") return;
    const sids = Array.isArray(room.slot_sids) ? room.slot_sids : [null, null];
    if (!sids[0] || !sids[1]) return;
    io.to(roomId).emit("pick_timer", { seconds: remaining });
    await sleep(1000);
  }

  const room = rooms.get(roomId);
  if (!room || room.type !== "duel") return;
  if (room.state !== "playing") return;
  const sids = Array.isArray(room.slot_sids) ? room.slot_sids : [null, null];
  if (!sids[0] || !sids[1]) return;

  const sid1 = sids[0];
  const sid2 = sids[1];
  const c1 = room.choices.get(sid1) || "";
  const c2 = room.choices.get(sid2) || "";
  room.state = "result";

  const roundsTotal = Number.isFinite(room.rounds_total) ? room.rounds_total : 3;
  const roundIndex = Number.isFinite(room.round_index) ? room.round_index : 0;
  const p1Name = room.slot_profiles && room.slot_profiles[0] && room.slot_profiles[0].handle ? String(room.slot_profiles[0].handle).trim() : "Jugador 1";
  const p2Name = room.slot_profiles && room.slot_profiles[1] && room.slot_profiles[1].handle ? String(room.slot_profiles[1].handle).trim() : "Jugador 2";

  let resultText = "Resultado";
  let winnerSide = 0;
  if (!c1 && !c2) {
    resultText = "Nadie eligió";
    winnerSide = 0;
  } else if (c1 && !c2) {
    resultText = `Gana ${p1Name} (el rival no eligió)`;
    winnerSide = 1;
  } else if (c2 && !c1) {
    resultText = `Gana ${p2Name} (el rival no eligió)`;
    winnerSide = 2;
  } else {
    const w = winnerForChoices(c1, c2);
    winnerSide = w;
    resultText = w === 0 ? "¡Empate!" : w === 1 ? `Gana ${p1Name}` : `Gana ${p2Name}`;
  }

  if (winnerSide === 1) room.p1_wins = (Number.isFinite(room.p1_wins) ? room.p1_wins : 0) + 1;
  if (winnerSide === 2) room.p2_wins = (Number.isFinite(room.p2_wins) ? room.p2_wins : 0) + 1;
  room.round_index = roundIndex + 1;

  io.to(roomId).emit("round_result", {
    player_1_choice: c1,
    player_2_choice: c2,
    result_text: resultText,
    winner_side: winnerSide,
    round: Math.min(roundIndex + 1, roundsTotal),
    rounds_total: roundsTotal,
    p1_score: Number.isFinite(room.p1_wins) ? room.p1_wins : 0,
    p2_score: Number.isFinite(room.p2_wins) ? room.p2_wins : 0,
  });

  lobby.match_codes = (Array.isArray(lobby.match_codes) ? lobby.match_codes : []).map((m) => {
    if (!m || String(m.room_id || "") !== roomId) return m;
    return {
      ...m,
      p1_score: Number.isFinite(room.p1_wins) ? room.p1_wins : 0,
      p2_score: Number.isFinite(room.p2_wins) ? room.p2_wins : 0,
      round: Math.min(Number.isFinite(room.round_index) ? room.round_index : 0, roundsTotal),
      rounds_total: roundsTotal,
      subtree_size: Number.isFinite(room.subtree_size) ? room.subtree_size : (Number.isFinite(m.subtree_size) ? m.subtree_size : 1),
    };
  });
  io.to(LOBBY_ID).emit("lobby_state", lobbyPayload());

  const finished = (Number.isFinite(room.round_index) ? room.round_index : 0) >= roundsTotal;
  if (finished) {
    const p1 = Number.isFinite(room.p1_wins) ? room.p1_wins : 0;
    const p2 = Number.isFinite(room.p2_wins) ? room.p2_wins : 0;
    if (p1 === p2) {
      if (room.tie_break_running) return;
      room.tie_break_running = true;
      room.tie_break_winner_side = Math.random() < 0.5 ? 1 : 2;
      room.state = "tiebreak";
      io.to(roomId).emit("status", { text: "Empate. Ruleta en 5 segundos..." });
      io.to(roomId).emit("tie_break_start", {
        p1_name: p1Name,
        p2_name: p2Name,
        winner_side: room.tie_break_winner_side,
        duration_ms: 5000,
      });
      setTimeout(() => {
        const r = rooms.get(roomId);
        if (!r || r.type !== "duel") return;
        if (!r.tie_break_running) return;
        const w = r.tie_break_winner_side === 1 || r.tie_break_winner_side === 2 ? r.tie_break_winner_side : (Math.random() < 0.5 ? 1 : 2);
        if (w === 1) r.p1_wins = (Number.isFinite(r.p1_wins) ? r.p1_wins : 0) + 1;
        if (w === 2) r.p2_wins = (Number.isFinite(r.p2_wins) ? r.p2_wins : 0) + 1;
        r.tie_break_running = false;
        io.to(roomId).emit("tie_break_result", {
          winner_side: w,
          p1_score: Number.isFinite(r.p1_wins) ? r.p1_wins : 0,
          p2_score: Number.isFinite(r.p2_wins) ? r.p2_wins : 0,
          rounds_total: roundsTotal,
        });
        duelFinalizeMatch(roomId);
      }, 5000);
      return;
    }
    duelFinalizeMatch(roomId);
    return;
  }

  io.to(roomId).emit("status", { text: `Siguiente ronda (${Math.min(room.round_index + 1, roundsTotal)}/${roundsTotal}) en 5 segundos...` });
  setTimeout(() => startCountdownIfReady(roomId), 5000);
}

async function startCountdownIfReady(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.type !== "duel") return;
  const sids = Array.isArray(room.slot_sids) ? room.slot_sids : [null, null];
  if (!sids[0] || !sids[1]) return;
  if (room.manual_start && !room.started) {
    room.state = "waiting_admin";
    io.to(roomId).emit("status", { text: "Esperando que el admin inicie la sala..." });
    return;
  }
  if (room.countdown_task_running) return;
  const roundsTotal = Number.isFinite(room.rounds_total) ? room.rounds_total : 3;
  const roundIndex = Number.isFinite(room.round_index) ? room.round_index : 0;
  if (roundIndex >= roundsTotal) return;
  room.state = "countdown";
  room.countdown_task_running = true;
  room.choices.clear();

  try {
    io.to(roomId).emit("round_reset", {});
    io.to(roomId).emit("status", { text: `Ronda ${roundIndex + 1}/${roundsTotal} · Preparados...` });
    const countdownSeconds = Number.isFinite(room.countdown_seconds) ? room.countdown_seconds : 5;
    for (let seconds = countdownSeconds; seconds >= 1; seconds -= 1) {
      io.to(roomId).emit("countdown", { seconds });
      await sleep(1000);
    }

    const r = rooms.get(roomId);
    if (!r || r.type !== "duel") return;
    const rsids = Array.isArray(r.slot_sids) ? r.slot_sids : [null, null];
    if (!rsids[0] || !rsids[1]) {
      r.state = "waiting";
      return;
    }
    r.state = "playing";
    r.choices.clear();
    io.to(roomId).emit("countdown", { seconds: 0 });
    io.to(roomId).emit("round_started", {});
    io.to(roomId).emit("status", { text: "Elige tu jugada" });
    const duelSeconds = Number.isFinite(r.battle_seconds) ? r.battle_seconds : (Number.parseInt(process.env.DUEL_BATTLE_SECONDS || "20", 10) || 20);
    duelRunPickTimer(roomId, duelSeconds);
  } finally {
    const r = rooms.get(roomId);
    if (r && r.type === "duel") r.countdown_task_running = false;
  }
}

function isAdminLoggedInFromSocket(socket) {
  return Boolean(socket.request && socket.request.session && socket.request.session.admin_auth);
}

function isAdminLoggedIn(req) {
  return Boolean(req.session && req.session.admin_auth);
}

function canControlLobbyFromSocket(socket) {
  if (isAdminLoggedInFromSocket(socket)) return true;
  return sidToMode.get(socket.id) === "lobby_participants";
}

app.get("/", (req, res) => {
  return res.redirect("/lobby");
});

app.get("/lobby", (req, res) => {
  const error = String(req.query.error || "").trim();
  const handle = String(req.query.handle || "").trim();
  const code = String(req.query.code || "").trim().toUpperCase();
  return res.render("lobby.html", { error, handle, code });
});

app.post("/lobby/enter", (req, res) => {
  const handle = normalizeHandle(String(req.body.handle || ""));
  const code = String(req.body.code || "").trim().toUpperCase();
  if (!handle || !code) {
    return res.redirect(`/lobby?error=${encodeURIComponent("Completa @ y código")}&handle=${encodeURIComponent(handle)}&code=${encodeURIComponent(code)}`);
  }
  if (lobby.eliminated && lobby.eliminated instanceof Set && lobby.eliminated.has(handle)) {
    return res.redirect(`/lobby?error=${encodeURIComponent("Ese usuario ya fue eliminado")}&handle=${encodeURIComponent(handle)}&code=${encodeURIComponent("")}`);
  }
  const roomId = lobbyCodeToRoom.get(code);
  if (!roomId) {
    return res.redirect(`/lobby?error=${encodeURIComponent("Código inválido")}&handle=${encodeURIComponent(handle)}&code=${encodeURIComponent(code)}`);
  }
  const m = (Array.isArray(lobby.match_codes) ? lobby.match_codes : []).find((x) => x && String(x.code || "").trim().toUpperCase() === code) || null;
  if (m && m.code_used) {
    return res.redirect(`/lobby?error=${encodeURIComponent("Ese código ya no sirve")}&handle=${encodeURIComponent(handle)}&code=${encodeURIComponent("")}`);
  }
  if (m) {
    const p1 = normalizeHandle(m.p1_handle || "");
    const p2 = normalizeHandle(m.p2_handle || "");
    if (p1 && p2 && handle !== p1 && handle !== p2) {
      return res.redirect(`/lobby?error=${encodeURIComponent("Ese @ no pertenece a esa sala")}&handle=${encodeURIComponent(handle)}&code=${encodeURIComponent("")}`);
    }
  }
  try {
    const duelRoom = rooms.get(String(roomId || "").trim());
    if (duelRoom && duelRoom.type === "duel") {
      const mSlot =
        m && normalizeHandle(m.p1_handle || "") && handle === normalizeHandle(m.p1_handle || "")
          ? 0
          : 1;
      const fromLobby = lobby.participants.get(handle);
      const avatarFromLobby = fromLobby && fromLobby.avatar_url ? String(fromLobby.avatar_url).trim() : "";
      if (!Array.isArray(duelRoom.slot_profiles)) duelRoom.slot_profiles = [{ handle: "", avatar_url: "" }, { handle: "", avatar_url: "" }];
      const cur = duelRoom.slot_profiles[mSlot] || { handle: "", avatar_url: "" };
      duelRoom.slot_profiles[mSlot] = {
        handle,
        avatar_url: cur.avatar_url ? String(cur.avatar_url).trim() : avatarFromLobby,
      };
      if (m) {
        lobby.match_codes = (Array.isArray(lobby.match_codes) ? lobby.match_codes : []).map((x) => {
          if (!x || String(x.code || "").trim().toUpperCase() !== code) return x;
          return mSlot === 0
            ? { ...x, p1_handle: handle, p1_avatar: x.p1_avatar ? String(x.p1_avatar).trim() : avatarFromLobby }
            : { ...x, p2_handle: handle, p2_avatar: x.p2_avatar ? String(x.p2_avatar).trim() : avatarFromLobby };
        });
      }
    }
  } catch {}
  return res.redirect(`/juego/${encodeURIComponent(roomId)}?h=${encodeURIComponent(handle)}`);
});

app.get("/participantes", (req, res) => {
  return res.render("participantes.html");
});

app.get("/bracket", (req, res) => {
  return res.render("bracket.html");
});

app.get("/premios", (req, res) => {
  return res.render("premios.html");
});

app.get("/perdiste", (req, res) => {
  return res.render("perdiste.html");
});

app.get("/lobby/admin", (req, res) => {
  if (!isAdminLoggedIn(req)) return res.redirect(`/admin/login?next=${encodeURIComponent("/lobby/admin")}`);
  res.type("html").send(
    `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Admin · Sala de espera</title>
    <link rel="stylesheet" href="/static/estilos.css" />
  </head>
  <body>
    <main class="app">
      <header class="top">
        <div class="brand">
          <h1 class="title">Admin · Sala de espera</h1>
          <p class="subtitle">Usuario: ${String(req.session.admin_username || "Admin")}</p>
        </div>
        <div class="room">
          <div class="room__label">Panel</div>
          <div class="room__id">OK</div>
          <a class="room__link" href="/admin/logout">Cerrar sesión</a>
          <a class="room__link" href="/lobby">Ver pantalla</a>
        </div>
      </header>

      <section class="panel">
        <div class="panel__row">
          <div class="pill" id="connectionPill">Conectando...</div>
          <div class="pill pill--accent" id="youAre">Administrador</div>
          <button class="btn btn--paper" id="audioArmBtn" type="button">Activar audio</button>
          <button class="btn btn--paper" id="lobbyOpenLiveModalBtn" type="button">Conectarse al live</button>
          <button class="btn btn--paper" id="lobbyBracketShuffleBtn" type="button">Emparejar</button>
          <button class="btn btn--rock" id="lobbyResetBtn" type="button">Limpiar todo</button>
          <button class="btn btn--paper" id="lobbyEditDuelBtn" type="button">Editar sala</button>
          <button class="btn btn--paper" id="lobbyStartDuelsBtn" type="button">Iniciar salas</button>
          <button class="btn btn--paper" id="lobbyRoutesBtn" type="button">Rutas</button>
        </div>
        <div class="status" id="statusText">Listo.</div>

        <div class="lobbyAdminGrid">
          <section class="lobbyBox">
            <div class="lobbyBox__title">Configuración</div>
            <div class="lobbyForm">
              <label class="admin__field" style="grid-column: 1 / -1;">
                <span class="admin__label">Meta mínima (valor)</span>
                <input class="admin__input" id="lobbyRequiredInput" type="number" min="0" step="1" value="1" />
              </label>
              <button class="btn btn--paper" id="lobbySetRequiredBtn" type="button">Aplicar</button>
            </div>
            <div class="hint" style="margin-top:10px">Los jugadores deben cumplir la meta para entrar a mesas (a decisión del admin).</div>
          </section>

          <section class="lobbyBox">
            <div class="lobbyBox__title">Simular donación (por ahora)</div>
            <div class="lobbyForm">
              <label class="admin__field">
                <span class="admin__label">@usuario</span>
                <input class="admin__input" id="lobbyDonorHandle" type="text" placeholder="@usuario" />
              </label>
              <label class="admin__field">
                <span class="admin__label">Regalo</span>
                <input class="admin__input" id="lobbyGiftName" type="text" placeholder="Rosa" />
              </label>
              <label class="admin__field">
                <span class="admin__label">Valor</span>
                <input class="admin__input" id="lobbyGiftValue" type="number" min="0" step="1" value="1" />
              </label>
              <label class="admin__field" style="grid-column: 1 / -1;">
                <span class="admin__label">Avatar URL (opcional)</span>
                <input class="admin__input" id="lobbyAvatarUrl" type="text" placeholder="https://..." />
              </label>
              <button class="btn btn--rock" id="lobbyAddDonationBtn" type="button">Agregar</button>
            </div>
          </section>

          <section class="lobbyBox" style="grid-column: 1 / -1;">
            <div class="lobbyBox__title">Salas y códigos (1 por pareja)</div>
            <div class="panel__row" style="margin: 10px 0 6px 0;">
              <button class="btn btn--paper" id="lobbyGenerateMatchCodesBtn" type="button">Generar todos</button>
              <button class="btn btn--paper" id="lobbyRegenAllMatchCodesBtn" type="button">Actualizar todos</button>
              <button class="btn btn--paper" id="lobbyCopyAllMatchCodesBtn" type="button">Copiar todos</button>
            </div>
            <textarea class="admin__input" id="lobbyAllMatchCodesText" rows="6" readonly style="width:100%; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;"></textarea>
            <div class="lobbyList lobbyList--admin" id="lobbyMatchCodes"></div>
            <div class="hint" style="margin-top:10px">Los códigos se basan en el bracket actual (emparejado). Copia el código y se lo das a cada pareja.</div>
          </section>

          <section class="lobbyBox" style="grid-column: 1 / -1;">
            <div class="lobbyBox__title">Donaciones / Espera</div>
            <div class="lobbyList lobbyList--admin" id="lobbyPending"></div>
          </section>

          <section class="lobbyBox" style="grid-column: 1 / -1;">
            <div class="lobbyBox__title">Mesas (4 por mesa)</div>
            <div class="lobbyTables" id="lobbyTables"></div>
          </section>

          <section class="lobbyBox" style="grid-column: 1 / -1;">
            <div class="lobbyBox__title">Ganadores</div>
            <div class="lobbyList lobbyList--admin" id="lobbyWinners"></div>
          </section>
        </div>
      </section>
    </main>

    <div class="modal" id="liveModal" hidden>
      <div class="modal__backdrop" data-close="1"></div>
      <div class="modal__card" role="dialog" aria-modal="true">
        <div class="modal__title">Conectarse al live</div>
        <div class="modal__sub">Pega el @ del TikTok que está en live</div>
        <div class="modal__form">
          <input class="lobbyLoginInput" id="lobbyLiveHandle" type="text" placeholder="@tuusuario" autocomplete="username" />
          <button class="btn btn--paper" id="lobbyLiveConnectBtn" type="button">Conectar</button>
          <button class="btn btn--rock" id="lobbyLiveCloseBtn" type="button">Cerrar</button>
        </div>
        <div class="hint" style="margin-top:10px">Al conectar, las donaciones aparecen en “Donaciones / Espera”.</div>
      </div>
    </div>

    <div class="modal" id="duelConfigModal" hidden>
      <div class="modal__backdrop" data-close="1"></div>
      <div class="modal__card" role="dialog" aria-modal="true">
        <div class="modal__title">Editar sala</div>
        <div class="modal__sub">Ajusta tiempos y premio</div>
        <div class="modal__form">
          <input class="lobbyLoginInput" id="duelConfigBattleInput" type="number" min="5" step="1" value="20" />
          <input class="lobbyLoginInput" id="duelConfigCountdownInput" type="number" min="1" step="1" value="5" />
          <input class="lobbyLoginInput" id="duelConfigPrizeInput" type="number" min="0" step="1" value="0" />
          <button class="btn btn--paper" id="duelConfigSaveBtn" type="button">Guardar cambios</button>
          <button class="btn btn--rock" id="duelConfigCloseBtn" type="button">Cerrar</button>
        </div>
        <div class="hint" style="margin-top:10px">Tiempo por ronda (seg) · Cuenta regresiva (seg) · Premio</div>
      </div>
    </div>

    <div class="modal" id="routesModal" hidden>
      <div class="modal__backdrop" data-close="1"></div>
      <div class="modal__card" role="dialog" aria-modal="true" style="width:min(720px,100%);">
        <div class="modal__title">Rutas de pantallas</div>
        <div class="modal__sub">Abre estas URLs en el navegador</div>
        <div class="hint" style="margin-top:10px">
          <div class="hint__mono" style="line-height:1.6">
            <a class="room__link" href="/lobby" target="_blank" rel="noreferrer">/lobby</a> · Login participantes<br/>
            <a class="room__link" href="/lobby/admin" target="_blank" rel="noreferrer">/lobby/admin</a> · Admin sala de espera<br/>
            <a class="room__link" href="/participantes" target="_blank" rel="noreferrer">/participantes</a> · Mesas / pantalla<br/>
            <a class="room__link" href="/bracket" target="_blank" rel="noreferrer">/bracket</a> · Llaves<br/>
            <a class="room__link" href="/premios" target="_blank" rel="noreferrer">/premios</a> · Ganadores / premio<br/>
            <a class="room__link" href="/perdiste" target="_blank" rel="noreferrer">/perdiste</a> · Pantalla perdedor<br/>
            <a class="room__link" href="/admin/login" target="_blank" rel="noreferrer">/admin/login</a> · Login admin
          </div>
        </div>
        <textarea class="admin__input" id="routesText" rows="7" readonly style="margin-top:10px; width:100%; resize:vertical; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;">/lobby
/lobby/admin
/participantes
/bracket
/premios
/perdiste
/admin/login
/juego/ROOMID?h=@usuario
/juego/ROOMID/admin</textarea>
        <div class="panel__row" style="margin-top:10px; justify-content:flex-end;">
          <button class="btn btn--paper" id="routesCopyBtn" type="button">Copiar</button>
          <button class="btn btn--rock" id="routesCloseBtn" type="button">Cerrar</button>
        </div>
      </div>
    </div>

    <script>
      window.__ROOM_ID__ = "${LOBBY_ID}";
      window.__MODE__ = "lobby_admin";
    </script>
    <script src="https://cdn.socket.io/4.7.5/socket.io.min.js" crossorigin="anonymous" onerror="this.onerror=null;this.src='/socket.io/socket.io.js';"></script>
    <script src="/static/script.js"></script>
  </body>
</html>`,
  );
});

app.get("/juego/:id_sala", (req, res) => {
  const id = String(req.params.id_sala || "").trim().toUpperCase();
  if (!id) return res.redirect("/");
  getOrCreateDuelRoom(id);
  return res.render("juego.html", { room_id: id, mode: "duel", max_players: 2 });
});

app.get("/juego/:id_sala/admin", (req, res) => {
  const id = String(req.params.id_sala || "").trim().toUpperCase();
  if (!id) return res.redirect("/");
  if (!isAdminLoggedIn(req)) return res.redirect(`/admin/login?next=${encodeURIComponent(`/juego/${encodeURIComponent(id)}/admin`)}`);
  getOrCreateDuelRoom(id);
  return res.render("juego.html", { room_id: id, mode: "duel_admin", max_players: 2 });
});

app.get("/torneo", (req, res) => {
  const nRaw = String(req.query.n || "10");
  let n = Number.parseInt(nRaw, 10);
  if (!Number.isFinite(n)) n = 10;
  n = Math.max(2, Math.min(64, n));
  return res.redirect(`/admin/login?next=${encodeURIComponent(`/admin/setup?n=${n}`)}`);
});

app.get("/torneo/:id_torneo", (req, res) => {
  const id = String(req.params.id_torneo || "").trim().toUpperCase();
  return res.redirect(`/join/${encodeURIComponent(id)}`);
});

app.get("/admin/login", (req, res) => {
  const nextUrl = String(req.query.next || "/lobby/admin").trim() || "/lobby/admin";
  if (isAdminLoggedIn(req)) return res.redirect(nextUrl);
  return res.render("admin_login.html", { next_url: nextUrl, error: "" });
});

app.post("/admin/login", (req, res) => {
  const nextUrl = String(req.body.next || req.query.next || "/lobby/admin").trim() || "/lobby/admin";
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const creds = loadAdminCredentials();
  if (!creds.user || !creds.password) return res.render("admin_login.html", { next_url: nextUrl, error: "Admin no configurado." });
  if (username.toUpperCase() !== creds.user.toUpperCase()) return res.render("admin_login.html", { next_url: nextUrl, error: "Usuario incorrecto." });
  if (password !== creds.password) return res.render("admin_login.html", { next_url: nextUrl, error: "Contraseña incorrecta." });
  req.session.admin_auth = true;
  req.session.admin_username = username || "Admin";
  return res.redirect(nextUrl);
});

app.get("/admin/logout", (req, res) => {
  if (req.session) {
    req.session.admin_auth = undefined;
    req.session.admin_username = undefined;
  }
  res.redirect("/admin/login");
});

app.get("/admin", (req, res) => {
  return res.redirect("/lobby/admin");
});

app.get("/admin/setup", (req, res) => {
  if (!isAdminLoggedIn(req)) return res.redirect(`/admin/login?next=${encodeURIComponent("/admin/setup")}`);
  const nRaw = String(req.query.n || "10");
  let n = Number.parseInt(nRaw, 10);
  if (!Number.isFinite(n)) n = 10;
  n = Math.max(2, Math.min(64, n));
  res.render("admin_setup.html", { base_url: baseUrlForReq(req), max_players: n });
});

app.post("/admin/setup", (req, res) => {
  if (!isAdminLoggedIn(req)) return res.redirect(`/admin/login?next=${encodeURIComponent("/admin/setup")}`);
  let maxPlayers = Number.parseInt(String(req.body.max_players || "10"), 10);
  if (!Number.isFinite(maxPlayers)) maxPlayers = 10;
  maxPlayers = Math.max(2, Math.min(64, maxPlayers));
  const prize = String(req.body.prize || "").trim();
  let battleSeconds = Number.parseInt(String(req.body.battle_seconds || "60"), 10);
  if (!Number.isFinite(battleSeconds)) battleSeconds = 60;
  battleSeconds = Math.max(10, Math.min(600, battleSeconds));
  let countdownSeconds = Number.parseInt(String(req.body.countdown_seconds || "3"), 10);
  if (!Number.isFinite(countdownSeconds)) countdownSeconds = 3;
  countdownSeconds = Math.max(1, Math.min(10, countdownSeconds));

  let roomId = generateRoomId();
  while (rooms.has(roomId)) roomId = generateRoomId();
  const room = getOrCreateTournament(roomId, maxPlayers);
  room.prize = prize;
  room.battle_seconds = battleSeconds;
  room.countdown_seconds = countdownSeconds;
  if (!room.invite_codes.length) {
    room.invite_codes = uniqueInviteCodes(room.max_players);
    for (const c of room.invite_codes) inviteCodeToTournament.set(c, room.room_id);
  }
  res.redirect(`/admin/t/${roomId}`);
});

app.get("/admin/t/:id_torneo", (req, res) => {
  if (!isAdminLoggedIn(req)) return res.redirect(`/admin/login?next=${encodeURIComponent(`/admin/t/${req.params.id_torneo}`)}`);
  const id = String(req.params.id_torneo || "").trim().toUpperCase();
  const baseUrl = baseUrlForReq(req);
  const room = rooms.get(id);
  if (!room || room.type !== "tournament") return res.status(404).send("Torneo no encontrado");
  const spectatorCode = room.spectator_code;
  const joinUrl = `${baseUrl}/lobby`;
  const playUrl = `${baseUrl}/t/${id}`;
  const spectatorUrl = `${baseUrl}/t/${id}?sk=${encodeURIComponent(spectatorCode)}`;
  res.render("admin_dashboard.html", {
    room_id: id,
    base_url: baseUrl,
    join_url: joinUrl,
    play_url: playUrl,
    spectator_code: spectatorCode,
    spectator_url: spectatorUrl,
    username: req.session.admin_username || "Admin",
    tournament: tournamentStatePayload(room),
    invite_codes: [...room.invite_codes],
  });
});

app.get("/admin/t/:id_torneo/codes.txt", (req, res) => {
  if (!isAdminLoggedIn(req)) return res.redirect(`/admin/login?next=${encodeURIComponent(`/admin/t/${req.params.id_torneo}/codes.txt`)}`);
  const id = String(req.params.id_torneo || "").trim().toUpperCase();
  const room = rooms.get(id);
  if (!room || room.type !== "tournament") return res.status(404).send("Torneo no encontrado");
  const body = `${room.invite_codes.map((c) => String(c).trim().toUpperCase()).filter(Boolean).join("\n")}\n`;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${id}_codigos.txt"`);
  res.send(body);
});

app.get("/join/:id_torneo", (req, res) => {
  const id = String(req.params.id_torneo || "").trim().toUpperCase();
  const baseUrl = baseUrlForReq(req);
  const room = rooms.get(id);
  if (!room || room.type !== "tournament") return res.status(404).send("Torneo no encontrado");
  const prefillCode = String(req.query.code || "").trim().toUpperCase();
  res.render("join.html", {
    room_id: id,
    base_url: baseUrl,
    prize: room.prize,
    count: room.redeemed_codes.size,
    max_players: room.max_players,
    prefill_code: prefillCode,
    prefill_account_type: "",
    error: "",
  });
});

app.post("/join/:id_torneo", (req, res) => {
  const id = String(req.params.id_torneo || "").trim().toUpperCase();
  const baseUrl = baseUrlForReq(req);
  const room = rooms.get(id);
  if (!room || room.type !== "tournament") return res.status(404).send("Torneo no encontrado");
  const code = String(req.body.code || "").trim().toUpperCase();
  const name = String(req.body.name || "").trim();
  const account_type = String(req.body.account_type || "").trim().toUpperCase();
  let account = String(req.body.account || "").trim();
  if (!account || account.toUpperCase() === "NO") account = "NO";

  let error = "";
  if (!code || !room.invite_codes.includes(code)) error = "Código inválido.";
  else if (room.redeemed_codes.has(code)) error = "Ese código ya fue usado.";
  else if (room.redeemed_codes.size >= room.max_players) error = "El torneo ya está completo.";

  if (error) {
    return res.render("join.html", {
      room_id: id,
      base_url: baseUrl,
      prize: room.prize,
      count: room.redeemed_codes.size,
      max_players: room.max_players,
      prefill_code: code,
      prefill_account_type: account_type,
      error,
    });
  }

  room.redeemed_codes.add(code);
  room.profiles.set(code, { code, name, age: "", account_type, account });
  const playerKey = generateSecret(18);
  room.player_keys.set(playerKey, code);

  io.to(id).emit("tournament_state", tournamentStatePayload(room));
  return res.redirect(`/t/${id}?k=${encodeURIComponent(playerKey)}`);
});

app.get("/usuarios", (req, res) => {
  return res.redirect("/lobby");
});

app.post("/usuarios", (req, res) => {
  return res.redirect("/lobby");
});

app.get("/t/:id_torneo", (req, res) => {
  const id = String(req.params.id_torneo || "").trim().toUpperCase();
  const playerKey = String(req.query.k || "").trim();
  const spectatorKey = String(req.query.sk || "").trim().toUpperCase();
  const baseUrl = baseUrlForReq(req);
  const room = rooms.get(id);
  if (!room || room.type !== "tournament") return res.status(404).send("Torneo no encontrado");
  const isSpectator = Boolean(spectatorKey && spectatorKey === String(room.spectator_code || "").toUpperCase());
  if (!isSpectator) {
    if (!playerKey || !room.player_keys.has(playerKey)) return res.status(403).send("Acceso inválido");
  }
  res.render("tournament.html", {
    room_id: id,
    base_url: baseUrl,
    player_key: isSpectator ? "" : playerKey,
    spectator_key: isSpectator ? spectatorKey : "",
    prize: room.prize,
    battle_seconds: room.battle_seconds,
    countdown_seconds: room.countdown_seconds,
  });
});

app.get("/qr/:room_id.png", async (req, res) => {
  const roomId = String(req.params.room_id || "").trim().toUpperCase();
  if (!roomId) return res.status(400).send("Sala inválida");
  let urlToEncode = String(req.query.u || "").trim();
  if (!urlToEncode) {
    const baseUrl = baseUrlForReq(req);
    urlToEncode = `${baseUrl}/juego/${encodeURIComponent(roomId)}`;
  }
  if (!/^https?:\/\//i.test(urlToEncode)) return res.status(400).send("URL inválida");
  try {
    const buf = await QRCode.toBuffer(urlToEncode, {
      errorCorrectionLevel: "M",
      margin: 2,
      scale: 8,
      type: "png",
    });
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store");
    res.send(buf);
  } catch {
    res.status(500).send("No se pudo generar el QR");
  }
});

io.on("connection", (socket) => {
  socket.on("join", (data) => {
    const roomId = String((data && data.room_id) || "").trim().toUpperCase();
    if (!roomId) {
      socket.emit("error_message", { text: "Sala inválida." });
      return;
    }
    const mode = String((data && data.mode) || "duel").trim().toLowerCase();
    const envBase = (process.env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
    const proto = String(socket.handshake.headers["x-forwarded-proto"] || "http")
      .split(",")[0]
      .trim();
    const host = String(socket.handshake.headers["x-forwarded-host"] || socket.handshake.headers.host || "")
      .split(",")[0]
      .trim();
    const headerBase = host ? `${proto}://${host}`.replace(/\/+$/, "") : "";
    const defaultBaseUrl = envBase || headerBase;

    if (mode === "lobby_admin" || mode === "lobby_display" || mode === "lobby_participants") {
      if (mode === "lobby_admin" && !isAdminLoggedInFromSocket(socket)) {
        socket.emit("error_message", { text: "Admin no autenticado." });
        socket.disconnect(true);
        return;
      }
      sidToRoom.set(socket.id, LOBBY_ID);
      sidToMode.set(socket.id, mode);
      socket.join(LOBBY_ID);
      socket.emit("joined", {
        room_id: LOBBY_ID,
        you_are: mode === "lobby_admin" ? "Administrador" : "Pantalla",
        share_url: `${defaultBaseUrl}/participantes`,
        qr_path: "",
        mode,
        is_admin: mode === "lobby_admin",
      });
      socket.emit("lobby_state", lobbyPayload());
      return;
    }

    if (mode === "tournament_admin") {
      if (!isAdminLoggedInFromSocket(socket)) {
        socket.emit("error_message", { text: "Admin no autenticado." });
        socket.disconnect(true);
        return;
      }
      const room = rooms.get(roomId);
      if (!room || room.type !== "tournament") {
        socket.emit("error_message", { text: "Torneo no encontrado." });
        socket.disconnect(true);
        return;
      }
      room.admin_sid = socket.id;
      sidToRoom.set(socket.id, roomId);
      socket.join(roomId);
      const shareUrl = `${defaultBaseUrl}/join/${roomId}`;
      socket.emit("joined", {
        room_id: roomId,
        you_are: "Organizador",
        share_url: shareUrl,
        qr_path: `/qr/${roomId}.png`,
        mode,
        is_admin: true,
      });
      io.to(roomId).emit("tournament_bracket", tournamentBracketPayload(room));
      if (room.state === "lobby") {
        io.to(roomId).emit("tournament_status", {
          text: `Registrados: ${room.redeemed_codes.size}/${room.max_players}. Esperando al organizador...`,
        });
      }
      if (room.state === "in_progress" && room.active_round == null && room.active_match == null) {
        io.to(roomId).emit("tournament_status", { text: "Esperando a que el organizador inicie la siguiente pelea..." });
      }
      io.to(roomId).emit("tournament_state", tournamentStatePayload(room));
      if (room.active_round != null && room.active_match != null) {
        const m = room.rounds[room.active_round]?.matches?.[room.active_match];
        if (m && m.status === "picking") {
          socket.emit("tournament_threw_update", {
            p1_threw: m.choices.has(m.p1_code),
            p2_threw: m.p2_code ? m.choices.has(m.p2_code) : false,
          });
          socket.emit("tournament_admin_peek", {
            p1_choice: m.choices.get(m.p1_code) || "",
            p2_choice: m.p2_code ? m.choices.get(m.p2_code) || "" : "",
          });
        }
      }
      return;
    }

    if (mode === "tournament_spectator") {
      const room = rooms.get(roomId);
      if (!room || room.type !== "tournament") {
        socket.emit("error_message", { text: "Torneo no encontrado." });
        socket.disconnect(true);
        return;
      }
      const spectatorKey = String((data && data.spectator_key) || "").trim().toUpperCase();
      if (!spectatorKey || spectatorKey !== String(room.spectator_code || "").toUpperCase()) {
        socket.emit("error_message", { text: "Acceso inválido." });
        socket.disconnect(true);
        return;
      }
      sidToRoom.set(socket.id, roomId);
      socket.join(roomId);
      const shareUrl = `${defaultBaseUrl}/lobby`;
      socket.emit("joined", {
        room_id: roomId,
        you_are: "Espectador",
        share_url: shareUrl,
        qr_path: `/qr/${roomId}.png`,
        mode,
        is_admin: false,
      });
      io.to(roomId).emit("tournament_bracket", tournamentBracketPayload(room));
      io.to(roomId).emit("tournament_state", tournamentStatePayload(room));
      return;
    }

    if (mode === "tournament_player") {
      const room = rooms.get(roomId);
      if (!room || room.type !== "tournament") {
        socket.emit("error_message", { text: "Torneo no encontrado." });
        socket.disconnect(true);
        return;
      }
      const playerKey = String((data && data.player_key) || "").trim();
      const code = room.player_keys.get(playerKey);
      if (!code) {
        socket.emit("error_message", { text: "Acceso inválido." });
        socket.disconnect(true);
        return;
      }
      if (!room.redeemed_codes.has(code)) {
        socket.emit("error_message", { text: "Código no registrado." });
        socket.disconnect(true);
        return;
      }
      const oldSid = room.code_to_sid.get(code);
      if (oldSid && oldSid !== socket.id) {
        room.sid_to_code.delete(oldSid);
        sidToRoom.delete(oldSid);
        try {
          io.sockets.sockets.get(oldSid)?.disconnect(true);
        } catch {}
      }
      room.code_to_sid.set(code, socket.id);
      room.sid_to_code.set(socket.id, code);
      sidToRoom.set(socket.id, roomId);
      socket.join(roomId);
      const shareUrl = `${defaultBaseUrl}/join/${roomId}`;
      socket.emit("joined", {
        room_id: roomId,
        you_are: tournamentNameForCode(room, code),
        share_url: shareUrl,
        qr_path: `/qr/${roomId}.png`,
        mode,
        is_admin: false,
      });
      io.to(roomId).emit("tournament_bracket", tournamentBracketPayload(room));
      io.to(roomId).emit("tournament_state", tournamentStatePayload(room));
      return;
    }

    if (mode === "duel_admin") {
      if (!isAdminLoggedInFromSocket(socket)) {
        socket.emit("error_message", { text: "Admin no autenticado." });
        socket.disconnect(true);
        return;
      }
      const room = getOrCreateDuelRoom(roomId);
      if (!room.admin_sids || !(room.admin_sids instanceof Set)) room.admin_sids = new Set();
      room.admin_sids.add(socket.id);
      sidToRoom.set(socket.id, roomId);
      sidToMode.set(socket.id, mode);
      socket.join(roomId);
      const shareUrl = `${defaultBaseUrl}/juego/${encodeURIComponent(roomId)}`;
      socket.emit("joined", {
        room_id: roomId,
        you_are: "Admin",
        share_url: shareUrl,
        qr_path: `/qr/${roomId}.png`,
        mode,
        is_admin: true,
      });
      broadcastRoomState(room);
      const sids = Array.isArray(room.slot_sids) ? room.slot_sids : [null, null];
      const sid1 = sids[0];
      const sid2 = sids[1];
      socket.emit("duel_admin_peek", {
        p1_choice: sid1 ? room.choices.get(sid1) || "" : "",
        p2_choice: sid2 ? room.choices.get(sid2) || "" : "",
      });
      return;
    }

    const room = getOrCreateDuelRoom(roomId);
    const wantedHandle = normalizeHandle(String((data && data.handle) || ""));
    const sids = Array.isArray(room.slot_sids) ? room.slot_sids : [null, null];
    const profs = Array.isArray(room.slot_profiles) ? room.slot_profiles : [{}, {}];
    const a1 = normalizeHandle((profs[0] && profs[0].handle) || "");
    const a2 = normalizeHandle((profs[1] && profs[1].handle) || "");
    if (a1 && a2 && wantedHandle && wantedHandle !== a1 && wantedHandle !== a2) {
      socket.emit("error_message", { text: "Ese @ no pertenece a esta sala." });
      socket.disconnect(true);
      return;
    }
    let slot = -1;
    if (wantedHandle) {
      const idx = profs.findIndex((p) => p && normalizeHandle(p.handle || "") === wantedHandle);
      if (idx !== -1) slot = idx;
    }
    if (slot === -1) slot = !sids[0] ? 0 : (!sids[1] ? 1 : -1);
    if (slot === -1) {
      socket.emit("room_full", { text: "La sala ya tiene 2 jugadores." });
      socket.disconnect(true);
      return;
    }
    const oldSid = sids[slot];
    if (oldSid && oldSid !== socket.id) {
      sidToRoom.delete(oldSid);
      try {
        io.sockets.sockets.get(oldSid)?.disconnect(true);
      } catch {}
    }
    sids[slot] = socket.id;
    room.slot_sids = sids;
    sidToRoom.set(socket.id, roomId);
    socket.join(roomId);
    try {
      if (!Array.isArray(room.slot_profiles)) room.slot_profiles = [{ handle: "", avatar_url: "" }, { handle: "", avatar_url: "" }];
      const fromLobby = wantedHandle ? lobby.participants.get(wantedHandle) : null;
      const avatarFromLobby = fromLobby && fromLobby.avatar_url ? String(fromLobby.avatar_url).trim() : "";
      const cur = room.slot_profiles[slot] || { handle: "", avatar_url: "" };
      const keepHandle = normalizeHandle(cur.handle || "");
      room.slot_profiles[slot] = {
        handle: wantedHandle || keepHandle || `Jugador ${slot + 1}`,
        avatar_url: cur.avatar_url ? String(cur.avatar_url).trim() : avatarFromLobby,
      };
      const mc = lobbyMatchByRoomId(roomId);
      if (mc && wantedHandle) {
        lobby.match_codes = (Array.isArray(lobby.match_codes) ? lobby.match_codes : []).map((m) => {
          if (!m || String(m.room_id || "").trim() !== roomId) return m;
          const p1h = normalizeHandle(m.p1_handle || "");
          const p2h = normalizeHandle(m.p2_handle || "");
          if (wantedHandle === p1h) return { ...m, p1_avatar: m.p1_avatar ? String(m.p1_avatar).trim() : avatarFromLobby };
          if (wantedHandle === p2h) return { ...m, p2_avatar: m.p2_avatar ? String(m.p2_avatar).trim() : avatarFromLobby };
          return m;
        });
      }
    } catch {}
    const shareUrl = `${defaultBaseUrl}/juego/${roomId}`;
    socket.emit("joined", {
      room_id: roomId,
      you_are: (room.slot_profiles && room.slot_profiles[slot] && room.slot_profiles[slot].handle)
        ? String(room.slot_profiles[slot].handle).trim()
        : `Jugador ${slot + 1}`,
      share_url: shareUrl,
      qr_path: `/qr/${roomId}.png`,
      mode,
      is_admin: false,
    });
    broadcastRoomState(room);
    startCountdownIfReady(roomId);
  });

  socket.on("lobby_config", (data) => {
    const roomId = sidToRoom.get(socket.id);
    if (roomId !== LOBBY_ID) {
      socket.emit("error_message", { text: "No estás en el lobby." });
      return;
    }
    if (!isAdminLoggedInFromSocket(socket)) {
      socket.emit("error_message", { text: "Solo admin puede hacer eso." });
      return;
    }
    const requiredRaw = Number.parseInt(String((data && data.required_value) ?? "0"), 10);
    const required = Number.isFinite(requiredRaw) ? Math.max(0, Math.min(999999, requiredRaw)) : 0;
    lobby.required_value = required;

    const prizeRaw = Number.parseInt(String((data && data.prize_value) ?? lobby.prize_value ?? "0"), 10);
    const prize = Number.isFinite(prizeRaw) ? Math.max(0, Math.min(999999999, prizeRaw)) : 0;
    lobby.prize_value = prize;

    const duelCountdownRaw = Number.parseInt(String((data && data.duel_countdown_seconds) ?? lobby.duel_countdown_seconds ?? "5"), 10);
    const duelBattleRaw = Number.parseInt(String((data && data.duel_battle_seconds) ?? lobby.duel_battle_seconds ?? "20"), 10);
    const duelCountdown = Number.isFinite(duelCountdownRaw) ? Math.max(1, Math.min(20, duelCountdownRaw)) : 5;
    const duelBattle = Number.isFinite(duelBattleRaw) ? Math.max(5, Math.min(300, duelBattleRaw)) : 20;
    lobby.duel_countdown_seconds = duelCountdown;
    lobby.duel_battle_seconds = duelBattle;

    for (const m of Array.isArray(lobby.match_codes) ? lobby.match_codes : []) {
      const rid = m && m.room_id ? String(m.room_id).trim() : "";
      if (!rid) continue;
      const r = rooms.get(rid);
      if (!r || r.type !== "duel") continue;
      r.countdown_seconds = duelCountdown;
      r.battle_seconds = duelBattle;
    }
    for (const h of [...lobby.approved]) {
      const p = lobby.participants.get(h);
      const total = p && Number.isFinite(p.total_value) ? p.total_value : 0;
      if (total < required) lobby.approved.delete(h);
    }
    for (const p of lobby.participants.values()) {
      const h = normalizeHandle(p && p.handle ? p.handle : "");
      if (!h) continue;
      if (lobby.kicked.has(h)) continue;
      const total = p && Number.isFinite(p.total_value) ? p.total_value : 0;
      if (total >= required) lobby.approved.add(h);
    }
    io.to(LOBBY_ID).emit("lobby_state", lobbyPayload());
    io.to(LOBBY_ID).emit("lobby_status", { text: `Config actualizada · Meta: ${required} · Premio: ${prize} · Tiempo: ${duelBattle}s · Cuenta: ${duelCountdown}s` });
  });

  socket.on("lobby_add_donation", (data) => {
    const roomId = sidToRoom.get(socket.id);
    if (roomId !== LOBBY_ID) {
      socket.emit("error_message", { text: "No estás en el lobby." });
      return;
    }
    if (!isAdminLoggedInFromSocket(socket)) {
      socket.emit("error_message", { text: "Solo admin puede hacer eso." });
      return;
    }
    const handle = String((data && data.handle) || "").trim();
    const avatar_url = String((data && data.avatar_url) || "").trim();
    const gift_name = String((data && data.gift_name) || "").trim();
    const gift_value = Number.parseFloat(String((data && data.gift_value) ?? "0"));
    const gift_count = Number.parseInt(String((data && data.gift_count) ?? "1"), 10);
    const r = lobbyUpsertDonation({ handle, avatar_url, gift_name, gift_value, gift_count });
    if (!r.ok) {
      socket.emit("error_message", { text: r.error || "No se pudo agregar." });
      return;
    }
    io.to(LOBBY_ID).emit("lobby_state", lobbyPayload());
  });

  socket.on("lobby_live_connect", async (data) => {
    const roomId = sidToRoom.get(socket.id);
    if (roomId !== LOBBY_ID) {
      socket.emit("error_message", { text: "No estás en el lobby." });
      return;
    }
    if (!canControlLobbyFromSocket(socket)) {
      socket.emit("error_message", { text: "No tienes permiso para conectar el live." });
      return;
    }
    const h = normalizeHandle((data && data.handle) || "");
    const username = h.replace(/^@/, "");
    if (!username) {
      socket.emit("error_message", { text: "Falta el @ del live." });
      return;
    }

    const mod = getTikTokLiveConnector();
    if (!mod || !mod.WebcastPushConnection) {
      socket.emit("error_message", { text: "Falta instalar: npm i tiktok-live-connector" });
      return;
    }

    if (tiktokConnection) {
      try {
        await tiktokConnection.disconnect();
      } catch {}
      tiktokConnection = null;
      tiktokConnectionHandle = "";
    }

    const { WebcastPushConnection } = mod;
    const conn = new WebcastPushConnection(username, {
      enableExtendedGiftInfo: true,
      logFetchFallbackErrors: true,
      webClientHeaders: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "Accept-Language": "es-CO,es;q=0.9,en;q=0.8",
        Accept: "text/html,application/json,application/protobuf",
      },
      webClientOptions: { timeout: 30000 },
      websocketOptions: { timeout: 30000 },
    });
    tiktokConnection = conn;
    tiktokConnectionHandle = h;
    lobby.live_connected = true;
    lobby.live_handle = h;
    io.to(LOBBY_ID).emit("lobby_state", lobbyPayload());
    io.to(LOBBY_ID).emit("lobby_status", { text: `Conectando al live: ${h}` });

    conn.on("gift", (evt) => {
      if (!evt) return;
      const giftType = Number(evt.giftType);
      const repeatEnd = Boolean(evt.repeatEnd);
      if (giftType === 1 && !repeatEnd) return;
      const handle = evt.uniqueId ? `@${String(evt.uniqueId).trim()}` : "";
      const avatar_url = String(evt.profilePictureUrl || "").trim();
      const gift_name = String(evt.giftName || evt.giftId || "Regalo").trim();
      const gift_value = Number.isFinite(Number(evt.diamondCount)) ? Number(evt.diamondCount) : 1;
      const gift_count = Number.isFinite(Number(evt.repeatCount)) ? Number(evt.repeatCount) : 1;
      const r = lobbyUpsertDonation({ handle, avatar_url, gift_name, gift_value, gift_count });
      if (!r.ok) return;
      io.to(LOBBY_ID).emit("lobby_state", lobbyPayload());
    });

    conn.on("disconnected", () => {
      if (tiktokConnection === conn) {
        tiktokConnection = null;
        tiktokConnectionHandle = "";
        lobby.live_connected = false;
        lobby.live_handle = "";
        io.to(LOBBY_ID).emit("lobby_state", lobbyPayload());
        io.to(LOBBY_ID).emit("lobby_status", { text: "Live desconectado" });
      }
    });

    conn.on("error", (err) => {
      const msg = formatLiveError(err);
      io.to(LOBBY_ID).emit("lobby_status", { text: `Error live: ${msg}` });
      try {
        process.stderr.write(`[TikTokLive] error ${tiktokConnectionHandle || ""} ${msg}\n`);
      } catch {}
    });

    try {
      let lastErr = null;
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        try {
          await conn.connect();
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
          const msg = formatLiveError(e);
          io.to(LOBBY_ID).emit("lobby_status", { text: `Conexión live falló (${attempt}/4): ${msg}` });
          if (attempt < 4) await sleep(1200);
        }
      }
      if (lastErr) throw lastErr;
      io.to(LOBBY_ID).emit("lobby_status", { text: `Conectado al live: ${h}` });
    } catch (err) {
      if (tiktokConnection === conn) {
        tiktokConnection = null;
        tiktokConnectionHandle = "";
      }
      lobby.live_connected = false;
      lobby.live_handle = "";
      io.to(LOBBY_ID).emit("lobby_state", lobbyPayload());
      const msg = formatLiveError(err);
      io.to(LOBBY_ID).emit("lobby_status", { text: `No se pudo conectar: ${msg}` });
      socket.emit("error_message", { text: `No se pudo conectar: ${msg}` });
      try {
        process.stderr.write(`[TikTokLive] connect_failed ${h} ${msg}\n`);
      } catch {}
    }
  });

  socket.on("lobby_live_disconnect", async () => {
    const roomId = sidToRoom.get(socket.id);
    if (roomId !== LOBBY_ID) {
      socket.emit("error_message", { text: "No estás en el lobby." });
      return;
    }
    if (!canControlLobbyFromSocket(socket)) {
      socket.emit("error_message", { text: "No tienes permiso para desconectar el live." });
      return;
    }
    if (tiktokConnection) {
      try {
        await tiktokConnection.disconnect();
      } catch {}
      tiktokConnection = null;
      tiktokConnectionHandle = "";
    }
    lobby.live_connected = false;
    lobby.live_handle = "";
    io.to(LOBBY_ID).emit("lobby_state", lobbyPayload());
    io.to(LOBBY_ID).emit("lobby_status", { text: "Live desconectado" });
  });

  socket.on("lobby_approve", (data) => {
    const roomId = sidToRoom.get(socket.id);
    if (roomId !== LOBBY_ID) {
      socket.emit("error_message", { text: "No estás en el lobby." });
      return;
    }
    if (!isAdminLoggedInFromSocket(socket)) {
      socket.emit("error_message", { text: "Solo admin puede hacer eso." });
      return;
    }
    const h = normalizeHandle((data && data.handle) || "");
    if (!h) return;
    if (lobby.kicked.has(h)) return;
    const p = lobby.participants.get(h);
    if (!p) {
      socket.emit("error_message", { text: "Ese usuario no está en la lista." });
      return;
    }
    const total = Number.isFinite(p.total_value) ? p.total_value : 0;
    const required = Number.isFinite(lobby.required_value) ? lobby.required_value : 0;
    if (total < required) {
      socket.emit("error_message", { text: `No cumple la meta (${total}/${required}).` });
      return;
    }
    lobby.approved.add(h);
    io.to(LOBBY_ID).emit("lobby_state", lobbyPayload());
  });

  socket.on("lobby_kick", (data) => {
    const roomId = sidToRoom.get(socket.id);
    if (roomId !== LOBBY_ID) {
      socket.emit("error_message", { text: "No estás en el lobby." });
      return;
    }
    if (!canControlLobbyFromSocket(socket)) {
      socket.emit("error_message", { text: "No tienes permiso para expulsar." });
      return;
    }
    const h = normalizeHandle((data && data.handle) || "");
    if (!h) return;
    lobby.approved.delete(h);
    lobby.kicked.add(h);
    io.to(LOBBY_ID).emit("lobby_state", lobbyPayload());
    io.to(LOBBY_ID).emit("lobby_status", { text: `${h} fue expulsado` });
  });

  socket.on("lobby_mark_winner", (data) => {
    const roomId = sidToRoom.get(socket.id);
    if (roomId !== LOBBY_ID) {
      socket.emit("error_message", { text: "No estás en el lobby." });
      return;
    }
    if (!isAdminLoggedInFromSocket(socket)) {
      socket.emit("error_message", { text: "Solo admin puede hacer eso." });
      return;
    }
    const h = normalizeHandle((data && data.handle) || "");
    if (!h) return;
    const p = lobby.participants.get(h);
    if (!p) return;
    lobby.winners.unshift({
      handle: h,
      avatar_url: String(p.avatar_url || "").trim(),
      total_value: Number.isFinite(p.total_value) ? p.total_value : 0,
      prize_value: Number.isFinite(lobby.prize_value) ? lobby.prize_value : 0,
      at: Date.now(),
    });
    io.to(LOBBY_ID).emit("lobby_state", lobbyPayload());
    io.to(LOBBY_ID).emit("lobby_status", { text: `Ganador: ${h}` });
  });

  socket.on("lobby_reset", () => {
    const roomId = sidToRoom.get(socket.id);
    if (roomId !== LOBBY_ID) {
      socket.emit("error_message", { text: "No estás en el lobby." });
      return;
    }
    if (!canControlLobbyFromSocket(socket)) {
      socket.emit("error_message", { text: "No tienes permiso para limpiar." });
      return;
    }
    lobby.participants.clear();
    lobby.approved.clear();
    lobby.kicked.clear();
    lobby.eliminated.clear();
    lobby.winners = [];
    lobby.total_value = 0;
    lobby.bracket_size = 0;
    lobby.bracket_seeds = [];
    lobby.match_codes = [];
    lobbyCodeToRoom.clear();
    io.to(LOBBY_ID).emit("lobby_state", lobbyPayload());
    io.to(LOBBY_ID).emit("lobby_status", { text: "Lobby reiniciado" });
  });

  socket.on("lobby_generate_match_codes", () => {
    const roomId = sidToRoom.get(socket.id);
    if (roomId !== LOBBY_ID) {
      socket.emit("error_message", { text: "No estás en el lobby." });
      return;
    }
    if (!canControlLobbyFromSocket(socket)) {
      socket.emit("error_message", { text: "No tienes permiso." });
      return;
    }

    const pairsAll = lobbyPairsFromSeeds();
    const pairs = pairsAll.filter((p) => p && p.p1_handle && p.p2_handle);
    if (!pairs.length) {
      socket.emit("error_message", { text: "Primero empareja (bracket) para poder generar salas." });
      return;
    }

    lobby.match_codes = [];
    lobbyCodeToRoom.clear();

    const maxPairs = Math.min(16, pairs.length);
    for (let i = 0; i < maxPairs; i += 1) {
      const pair = pairs[i];
      let duelRoomId = generateRoomId();
      while (rooms.has(duelRoomId)) duelRoomId = generateRoomId();
      const duelRoom = getOrCreateDuelRoom(duelRoomId);
      duelRoom.subtree_size = 1;
      duelRoom.manual_start = true;
      duelRoom.started = false;
      duelRoom.slot_profiles = [
        { handle: normalizeHandle(pair.p1_handle || ""), avatar_url: String(pair.p1_avatar || "").trim() },
        { handle: normalizeHandle(pair.p2_handle || ""), avatar_url: String(pair.p2_avatar || "").trim() },
      ];
      duelRoom.slot_sids = [null, null];
      duelRoom.choices.clear();
      duelRoom.state = "waiting";
      duelRoom.rounds_total = 3;
      duelRoom.round_index = 0;
      duelRoom.p1_wins = 0;
      duelRoom.p2_wins = 0;
      if (Number.isFinite(lobby.duel_battle_seconds)) duelRoom.battle_seconds = lobby.duel_battle_seconds;
      if (Number.isFinite(lobby.duel_countdown_seconds)) duelRoom.countdown_seconds = lobby.duel_countdown_seconds;
      const code = uniqueLobbyMatchCode();
      lobbyCodeToRoom.set(code, duelRoomId);
      lobby.match_codes.push({
        index: i + 1,
        code,
        room_id: duelRoomId,
        p1_handle: normalizeHandle(pair.p1_handle || ""),
        p1_avatar: String(pair.p1_avatar || "").trim(),
        p2_handle: normalizeHandle(pair.p2_handle || ""),
        p2_avatar: String(pair.p2_avatar || "").trim(),
        subtree_size: 1,
        code_used: false,
        p1_score: 0,
        p2_score: 0,
        round: 0,
        rounds_total: 3,
        finished: false,
        winner_handle: "",
        loser_handle: "",
        history: [],
      });
    }

    io.to(LOBBY_ID).emit("lobby_state", lobbyPayload());
    io.to(LOBBY_ID).emit("lobby_status", { text: `Salas llenas y códigos listos: ${lobby.match_codes.length}` });
  });

  socket.on("lobby_start_ready_duels", () => {
    const roomId = sidToRoom.get(socket.id);
    if (roomId !== LOBBY_ID) {
      socket.emit("error_message", { text: "No estás en el lobby." });
      return;
    }
    if (!isAdminLoggedInFromSocket(socket)) {
      socket.emit("error_message", { text: "Solo admin puede iniciar." });
      return;
    }

    let startedCount = 0;
    for (const m of Array.isArray(lobby.match_codes) ? lobby.match_codes : []) {
      const rid = m && m.room_id ? String(m.room_id).trim() : "";
      if (!rid) continue;
      const r = rooms.get(rid);
      if (!r || r.type !== "duel") continue;
      if (!r.manual_start) continue;
      if (r.started) continue;
      const sids = Array.isArray(r.slot_sids) ? r.slot_sids : [null, null];
      if (!sids[0] || !sids[1]) continue;
      const roundsTotal = Number.isFinite(r.rounds_total) ? r.rounds_total : 3;
      const roundIndex = Number.isFinite(r.round_index) ? r.round_index : 0;
      if (roundIndex >= roundsTotal) continue;
      if (Number.isFinite(lobby.duel_battle_seconds)) r.battle_seconds = lobby.duel_battle_seconds;
      if (Number.isFinite(lobby.duel_countdown_seconds)) r.countdown_seconds = lobby.duel_countdown_seconds;
      r.started = true;
      startedCount += 1;
      startCountdownIfReady(rid);
    }

    io.to(LOBBY_ID).emit("lobby_status", {
      text: startedCount ? `Salas iniciadas: ${startedCount}` : "No hay salas listas (necesitan 2 jugadores dentro).",
    });
  });

  socket.on("lobby_regen_match_code", (payload) => {
    const roomId = sidToRoom.get(socket.id);
    if (roomId !== LOBBY_ID) {
      socket.emit("error_message", { text: "No estás en el lobby." });
      return;
    }
    if (!canControlLobbyFromSocket(socket)) {
      socket.emit("error_message", { text: "No tienes permiso." });
      return;
    }
    const oldCode = payload && payload.code ? String(payload.code).trim().toUpperCase() : "";
    if (!oldCode) return;
    const duelRoomId = lobbyCodeToRoom.get(oldCode);
    if (!duelRoomId) {
      socket.emit("error_message", { text: "Código no encontrado." });
      return;
    }
    lobbyCodeToRoom.delete(oldCode);
    const newCode = uniqueLobbyMatchCode();
    lobbyCodeToRoom.set(newCode, duelRoomId);
    lobby.match_codes = (Array.isArray(lobby.match_codes) ? lobby.match_codes : []).map((m) => {
      if (m && String(m.code || "").toUpperCase() === oldCode) return { ...m, code: newCode };
      return m;
    });
    io.to(LOBBY_ID).emit("lobby_state", lobbyPayload());
    socket.emit("lobby_match_code_regen_done", { old_code: oldCode, new_code: newCode });
  });

  socket.on("lobby_regen_all_match_codes", () => {
    const roomId = sidToRoom.get(socket.id);
    if (roomId !== LOBBY_ID) {
      socket.emit("error_message", { text: "No estás en el lobby." });
      return;
    }
    if (!canControlLobbyFromSocket(socket)) {
      socket.emit("error_message", { text: "No tienes permiso." });
      return;
    }

    const current = Array.isArray(lobby.match_codes) ? lobby.match_codes : [];
    if (!current.length) {
      socket.emit("error_message", { text: "No hay códigos todavía. Primero genera salas y códigos." });
      return;
    }

    const oldMap = new Map(lobbyCodeToRoom);
    const resolvedRoomIds = current.map((m) => {
      const oldCode = m && m.code ? String(m.code).trim().toUpperCase() : "";
      const rid = m && m.room_id ? String(m.room_id).trim() : "";
      return rid || (oldCode ? String(oldMap.get(oldCode) || "").trim() : "");
    });
    if (resolvedRoomIds.some((rid) => !rid)) {
      socket.emit("error_message", { text: "No se pudieron actualizar: falta información de sala. Genera los códigos otra vez." });
      return;
    }

    lobbyCodeToRoom.clear();
    lobby.match_codes = current.map((m, idx) => {
      const duelRoomId = resolvedRoomIds[idx];
      const newCode = uniqueLobbyMatchCode();
      lobbyCodeToRoom.set(newCode, duelRoomId);
      return { ...m, code: newCode, room_id: duelRoomId };
    });

    io.to(LOBBY_ID).emit("lobby_state", lobbyPayload());
    io.to(LOBBY_ID).emit("lobby_status", { text: `Códigos actualizados: ${lobby.match_codes.length}` });
  });

  socket.on("lobby_bracket_shuffle", () => {
    const roomId = sidToRoom.get(socket.id);
    if (roomId !== LOBBY_ID) {
      socket.emit("error_message", { text: "No estás en el lobby." });
      return;
    }
    if (!canControlLobbyFromSocket(socket)) {
      socket.emit("error_message", { text: "No tienes permiso para emparejar." });
      return;
    }

    const candidates = [];
    for (const hRaw of lobby.approved) {
      const h = normalizeHandle(hRaw);
      if (!h) continue;
      if (lobby.kicked.has(h)) continue;
      const p = lobby.participants.get(h);
      if (!p) continue;
      candidates.push({ handle: h, avatar_url: String(p.avatar_url || "").trim(), total_value: Number(p.total_value) || 0 });
    }

    if (candidates.length < 2) {
      socket.emit("error_message", { text: "Necesitas al menos 2 participantes." });
      return;
    }

    for (let i = candidates.length - 1; i > 0; i -= 1) {
      const j = crypto.randomInt(i + 1);
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }

    const size = 32;

    const seeds = candidates.map((p) => ({ handle: String(p.handle || ""), avatar_url: String(p.avatar_url || "") }));
    while (seeds.length < size) seeds.push({ handle: "", avatar_url: "" });
    lobby.match_codes = [];
    lobbyCodeToRoom.clear();

    lobby.bracket_size = size;
    lobby.bracket_seeds = seeds.slice(0, size);

    io.to(LOBBY_ID).emit("lobby_state", lobbyPayload());
    io.to(LOBBY_ID).emit("lobby_status", { text: `Emparejado: ${Math.min(candidates.length, size)}/${size}` });
  });

  socket.on("tournament_generate_bracket", () => {
    const roomId = sidToRoom.get(socket.id);
    const room = rooms.get(roomId || "");
    if (!room || room.type !== "tournament") {
      socket.emit("error_message", { text: "No estás en un torneo." });
      return;
    }
    if (room.admin_sid !== socket.id) {
      socket.emit("error_message", { text: "Solo el organizador puede repartir jugadores." });
      return;
    }
    if (room.bracket_generated) {
      socket.emit("error_message", { text: "Las llaves ya fueron generadas." });
      return;
    }
    if (room.redeemed_codes.size !== room.max_players) {
      socket.emit("error_message", { text: "Aún faltan jugadores registrados." });
      return;
    }
    const participants = [...room.redeemed_codes];
    for (let i = participants.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [participants[i], participants[j]] = [participants[j], participants[i]];
    }
    room.round_index = 0;
    room.rounds = [buildRoundFromCodes(participants)];
    room.active_round = null;
    room.active_match = null;
    room.state = "in_progress";
    room.bracket_generated = true;
    room.final_winner_code = null;
    io.to(room.room_id).emit("tournament_bracket", tournamentBracketPayload(room));
    io.to(room.room_id).emit("tournament_state", tournamentStatePayload(room));
    io.to(room.room_id).emit("tournament_status", { text: "Llaves generadas. Inicia la primera pelea." });
  });

  socket.on("tournament_start_next", () => {
    const roomId = sidToRoom.get(socket.id);
    const room = rooms.get(roomId || "");
    if (!room || room.type !== "tournament") {
      socket.emit("error_message", { text: "No estás en un torneo." });
      return;
    }
    if (room.admin_sid !== socket.id) {
      socket.emit("error_message", { text: "Solo el organizador puede iniciar peleas." });
      return;
    }
    if (!room.bracket_generated || room.state !== "in_progress") {
      socket.emit("error_message", { text: "Primero reparte jugadores (generar llaves)." });
      return;
    }
    const match = tournamentStartNextMatch(room);
    if (!match) {
      advanceIfRoundComplete(room, io);
      if (room.state === "finished") {
        socket.emit("error_message", { text: "El torneo ya terminó." });
        return;
      }
      socket.emit("error_message", { text: "No hay peleas pendientes para iniciar." });
      io.to(room.room_id).emit("tournament_bracket", tournamentBracketPayload(room));
      io.to(room.room_id).emit("tournament_state", tournamentStatePayload(room));
      return;
    }
    io.to(room.room_id).emit("tournament_match_started", {
      p1: tournamentNameForCode(room, match.p1_code),
      p2: tournamentNameForCode(room, match.p2_code),
    });
    io.to(room.room_id).emit("tournament_bracket", tournamentBracketPayload(room));
    io.to(room.room_id).emit("tournament_state", tournamentStatePayload(room));
    io.to(room.room_id).emit("tournament_status", { text: "Jugadores del duelo: presionen 'Estoy listo'." });
  });

  socket.on("tournament_ready", () => {
    const roomId = sidToRoom.get(socket.id);
    const room = rooms.get(roomId || "");
    if (!room || room.type !== "tournament") {
      socket.emit("error_message", { text: "No estás en un torneo." });
      return;
    }
    if (room.active_round == null || room.active_match == null) {
      socket.emit("error_message", { text: "Aún no hay pelea activa." });
      return;
    }
    const code = room.sid_to_code.get(socket.id);
    if (!code) {
      socket.emit("error_message", { text: "Acceso inválido." });
      return;
    }
    const m = room.rounds[room.active_round]?.matches?.[room.active_match];
    if (!m) return;
    if (m.status !== "ready") {
      socket.emit("error_message", { text: "La pelea no está esperando 'listo'." });
      return;
    }
    if (![m.p1_code, m.p2_code].includes(code)) {
      socket.emit("error_message", { text: "No eres jugador de esta pelea." });
      return;
    }
    m.ready.add(code);
    io.to(room.room_id).emit("tournament_ready_update", {
      p1_ready: m.ready.has(m.p1_code),
      p2_ready: m.p2_code ? m.ready.has(m.p2_code) : false,
    });

    if (m.p2_code == null) return;
    if (!m.ready.has(m.p1_code) || !m.ready.has(m.p2_code)) return;
    if (["countdown", "picking"].includes(m.status)) return;
    m.status = "countdown";
    m.choices.clear();
    io.to(room.room_id).emit("tournament_bracket", tournamentBracketPayload(room));
    io.to(room.room_id).emit("tournament_state", tournamentStatePayload(room));
    tournamentRunCountdownAndPick(room, io, room.countdown_seconds, room.battle_seconds);
  });

  socket.on("tournament_force_battle", () => {
    const roomId = sidToRoom.get(socket.id);
    const room = rooms.get(roomId || "");
    if (!room || room.type !== "tournament") {
      socket.emit("error_message", { text: "No estás en un torneo." });
      return;
    }
    if (room.admin_sid !== socket.id) {
      socket.emit("error_message", { text: "Solo el organizador puede forzar la batalla." });
      return;
    }
    if (room.active_round == null || room.active_match == null) {
      socket.emit("error_message", { text: "Aún no hay pelea activa." });
      return;
    }
    const m = room.rounds[room.active_round]?.matches?.[room.active_match];
    if (!m) return;
    if (m.p2_code == null) {
      socket.emit("error_message", { text: "No se puede forzar una pelea sin rival." });
      return;
    }
    if (m.status !== "ready") {
      socket.emit("error_message", { text: "La pelea no está esperando 'listo'." });
      return;
    }
    m.status = "countdown";
    m.choices.clear();
    io.to(room.room_id).emit("tournament_status", { text: "BATALLA forzada por el organizador." });
    io.to(room.room_id).emit("tournament_bracket", tournamentBracketPayload(room));
    io.to(room.room_id).emit("tournament_state", tournamentStatePayload(room));
    tournamentRunCountdownAndPick(room, io, room.countdown_seconds, room.battle_seconds);
  });

  socket.on("tournament_regen_code", (data) => {
    const oldCode = String((data && data.old_code) || "").trim().toUpperCase();
    if (!oldCode) {
      socket.emit("error_message", { text: "Código inválido." });
      return;
    }
    const roomId = sidToRoom.get(socket.id);
    const room = rooms.get(roomId || "");
    if (!room || room.type !== "tournament") {
      socket.emit("error_message", { text: "No estás en un torneo." });
      return;
    }
    if (room.admin_sid !== socket.id) {
      socket.emit("error_message", { text: "Solo el organizador puede actualizar códigos." });
      return;
    }
    if (!room.invite_codes.includes(oldCode)) {
      socket.emit("error_message", { text: "Ese código no existe en este torneo." });
      return;
    }
    if (room.code_to_sid.has(oldCode)) {
      socket.emit("error_message", { text: "Ese jugador está conectado. No se puede cambiar el código." });
      return;
    }
    if (room.state !== "lobby" && room.redeemed_codes.has(oldCode)) {
      socket.emit("error_message", { text: "El torneo ya empezó. No se puede cambiar un código ya usado." });
      return;
    }

    if (room.redeemed_codes.has(oldCode)) {
      room.redeemed_codes.delete(oldCode);
      room.profiles.delete(oldCode);
      for (const [k, v] of [...room.player_keys.entries()]) {
        if (v === oldCode) room.player_keys.delete(k);
      }
    }

    let newCode = "";
    while (true) {
      const c = generateInviteCode();
      if (inviteCodeToTournament.has(c)) continue;
      if (room.invite_codes.includes(c)) continue;
      newCode = c;
      break;
    }

    const idx = room.invite_codes.indexOf(oldCode);
    room.invite_codes[idx] = newCode;
    inviteCodeToTournament.delete(oldCode);
    inviteCodeToTournament.set(newCode, room.room_id);
    socket.emit("tournament_regen_code_done", { old_code: oldCode, new_code: newCode });
    io.to(room.room_id).emit("tournament_state", tournamentStatePayload(room));
  });

  socket.on("make_choice", (data) => {
    const choice = String((data && data.choice) || "").trim().toLowerCase();
    if (!["piedra", "papel", "tijera"].includes(choice)) {
      socket.emit("error_message", { text: "Jugada inválida." });
      return;
    }
    const roomId = sidToRoom.get(socket.id);
    const room = rooms.get(roomId || "");
    if (!room) {
      socket.emit("error_message", { text: "Sala no encontrada." });
      return;
    }

    if (room.type === "tournament") {
      if (room.active_round == null || room.active_match == null) {
        socket.emit("error_message", { text: "No hay pelea activa." });
        return;
      }
      const code = room.sid_to_code.get(socket.id);
      if (!code) {
        socket.emit("error_message", { text: "Acceso inválido." });
        return;
      }
      const m = room.rounds[room.active_round]?.matches?.[room.active_match];
      if (!m) return;
      if (m.status !== "picking") {
        socket.emit("error_message", { text: "Aún no puedes elegir (espera el conteo)." });
        return;
      }
      if (![m.p1_code, m.p2_code].includes(code)) {
        socket.emit("error_message", { text: "No eres jugador de esta pelea." });
        return;
      }
      if (m.choices.has(code)) {
        socket.emit("error_message", { text: "Ya elegiste." });
        return;
      }
      m.choices.set(code, choice);
      socket.emit("tournament_choice_registered", { choice });
      if (room.admin_sid) {
        io.to(room.admin_sid).emit("tournament_threw_update", {
          p1_threw: m.choices.has(m.p1_code),
          p2_threw: m.p2_code ? m.choices.has(m.p2_code) : false,
        });
        io.to(room.admin_sid).emit("tournament_admin_peek", {
          p1_choice: m.choices.get(m.p1_code) || "",
          p2_choice: m.p2_code ? m.choices.get(m.p2_code) || "" : "",
        });
      }
      return;
    }

    const sids = Array.isArray(room.slot_sids) ? room.slot_sids : [null, null];
    if (!sids.includes(socket.id)) {
      socket.emit("error_message", { text: "No estás dentro de la sala." });
      return;
    }
    if (!sids[0] || !sids[1]) {
      socket.emit("error_message", { text: "Aún falta un jugador." });
      return;
    }
    if (room.state !== "playing") {
      socket.emit("error_message", { text: "Aún no puedes elegir (espera la cuenta regresiva)." });
      return;
    }
    if (room.choices.has(socket.id)) {
      socket.emit("error_message", { text: "Ya elegiste. Espera el resultado." });
      return;
    }
    room.choices.set(socket.id, choice);
    socket.emit("choice_registered", { choice });
    if (room.admin_sids && room.admin_sids instanceof Set && room.admin_sids.size) {
      const sid1 = sids[0];
      const sid2 = sids[1];
      const p1Choice = sid1 ? room.choices.get(sid1) || "" : "";
      const p2Choice = sid2 ? room.choices.get(sid2) || "" : "";
      for (const adminSid of room.admin_sids) {
        io.to(adminSid).emit("duel_admin_peek", { p1_choice: p1Choice, p2_choice: p2Choice });
      }
    }
    if (room.choices.size < 2) {
      io.to(room.room_id).emit("status", { text: "Esperando la jugada del rival..." });
      return;
    }
    io.to(room.room_id).emit("status", { text: "Ambos eligieron. Espera que termine el tiempo..." });
  });

  socket.on("disconnect", () => {
    const roomId = sidToRoom.get(socket.id);
    sidToRoom.delete(socket.id);
    sidToMode.delete(socket.id);
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (!room) return;
    if (room.type === "tournament") {
      if (room.admin_sid === socket.id) room.admin_sid = null;
      const code = room.sid_to_code.get(socket.id);
      room.sid_to_code.delete(socket.id);
      if (code) room.code_to_sid.delete(code);

      if (code && room.active_round != null && room.active_match != null) {
        const m = room.rounds[room.active_round]?.matches?.[room.active_match];
        if (m && [m.p1_code, m.p2_code].includes(code) && m.p2_code != null) {
          const other = code === m.p1_code ? m.p2_code : m.p1_code;
          const otherName = tournamentNameForCode(room, other);
          m.choices.delete(code);
          io.to(room.room_id).emit("tournament_result", {
            result: `Gana ${otherName} (el rival se desconectó)`,
            p1_choice: "",
            p2_choice: "",
            repeat: false,
            winner: otherName,
          });
          tournamentFinishActiveAsWin(room, io, other, code);
        }
      }
      io.to(room.room_id).emit("tournament_bracket", tournamentBracketPayload(room));
      io.to(room.room_id).emit("tournament_state", tournamentStatePayload(room));
      return;
    }

    if (room.admin_sids && room.admin_sids instanceof Set) room.admin_sids.delete(socket.id);
    const dsids = Array.isArray(room.slot_sids) ? room.slot_sids : [null, null];
    const slotIdx = dsids[0] === socket.id ? 0 : (dsids[1] === socket.id ? 1 : -1);
    if (slotIdx !== -1) dsids[slotIdx] = null;
    room.slot_sids = dsids;
    room.choices.delete(socket.id);
    if (!dsids[0] && !dsids[1]) {
      if (room.admin_sids && room.admin_sids instanceof Set && room.admin_sids.size) {
        room.state = "waiting";
        broadcastRoomState(room);
        for (const adminSid of room.admin_sids) {
          io.to(adminSid).emit("duel_admin_peek", { p1_choice: "", p2_choice: "" });
        }
        return;
      }
      rooms.delete(roomId);
      return;
    }
    room.state = "waiting";
    broadcastRoomState(room);
    if (room.admin_sids && room.admin_sids instanceof Set && room.admin_sids.size) {
      const sid1 = dsids[0];
      const sid2 = dsids[1];
      const p1Choice = sid1 ? room.choices.get(sid1) || "" : "";
      const p2Choice = sid2 ? room.choices.get(sid2) || "" : "";
      for (const adminSid of room.admin_sids) {
        io.to(adminSid).emit("duel_admin_peek", { p1_choice: p1Choice, p2_choice: p2Choice });
      }
    }
  });
});

const port = Number.parseInt(process.env.PORT || "5000", 10) || 5000;
const host = process.env.HOST || "0.0.0.0";

try {
  fs.mkdirSync(instancePath(), { recursive: true });
} catch {}

server.listen(port, host, () => {
  const base = process.env.PUBLIC_BASE_URL ? process.env.PUBLIC_BASE_URL.replace(/\/+$/, "") : `http://127.0.0.1:${port}`;
  process.stdout.write(`Admin: ${base}/admin/login\nLogin: ${base}/lobby\nAdmin lobby: ${base}/lobby/admin\n`);
});
