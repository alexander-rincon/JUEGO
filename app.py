import os
import random
import string
import json
from io import BytesIO
from dataclasses import dataclass, field
import threading

ASYNC_MODE = os.environ.get("ASYNC_MODE", "").strip().lower()
if ASYNC_MODE not in {"eventlet", "threading"}:
    ASYNC_MODE = "threading" if os.name == "nt" else "eventlet"
if ASYNC_MODE == "eventlet":
    try:
        import eventlet
    except ModuleNotFoundError as exc:
        raise SystemExit(
            "Falta la dependencia 'eventlet'.\n"
            "Solución recomendada:\n"
            "  python -m venv .venv\n"
            "  .\\.venv\\Scripts\\python -m ensurepip --upgrade\n"
            "  .\\.venv\\Scripts\\python -m pip install -r requirements.txt\n"
            "  .\\.venv\\Scripts\\python app.py\n"
        ) from exc
    eventlet.monkey_patch()

from flask import Flask, Response, redirect, render_template, render_template_string, request, send_file, session, url_for
from flask_socketio import SocketIO, disconnect, emit, join_room, leave_room
import qrcode


def _generate_room_id(length: int = 6) -> str:
    # ID corto, legible y apto para compartir por link/QR.
    alphabet = string.ascii_uppercase + string.digits
    return "".join(random.choice(alphabet) for _ in range(length))


def _generate_invite_code(length: int = 8) -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "".join(random.choice(alphabet) for _ in range(length))


def _generate_secret(length: int = 24) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(random.choice(alphabet) for _ in range(length))


@dataclass
class GameRoom:
    room_id: str
    # request.sid de cada jugador (máximo 2).
    players: list[str] = field(default_factory=list)
    # Elecciones de la ronda actual: {sid: "piedra"|"papel"|"tijera"}.
    choices: dict[str, str] = field(default_factory=dict)
    # Estado actual del flujo de juego.
    state: str = "waiting"
    # Bandera para evitar iniciar múltiples contadores simultáneos.
    countdown_task_running: bool = False


@dataclass
class PlayerProfile:
    code: str
    name: str
    age: str
    account_type: str
    account: str


@dataclass
class TournamentMatch:
    p1_code: str
    p2_code: str | None
    status: str = "pending"
    ready: set[str] = field(default_factory=set)
    choices: dict[str, str] = field(default_factory=dict)
    winner_code: str | None = None
    loser_code: str | None = None


@dataclass
class TournamentRoom:
    room_id: str
    max_players: int = 10
    prize: str = ""
    countdown_seconds: int = 3
    battle_seconds: int = 60
    admin_key: str = field(default_factory=_generate_secret)
    admin_sid: str | None = None
    spectator_code: str = field(default_factory=_generate_invite_code)
    invite_codes: list[str] = field(default_factory=list)
    redeemed_codes: set[str] = field(default_factory=set)
    profiles: dict[str, PlayerProfile] = field(default_factory=dict)
    player_keys: dict[str, str] = field(default_factory=dict)
    code_to_sid: dict[str, str] = field(default_factory=dict)
    sid_to_code: dict[str, str] = field(default_factory=dict)
    state: str = "lobby"
    final_winner_code: str | None = None
    round_index: int = 0
    rounds: list[list[TournamentMatch]] = field(default_factory=list)
    active_round: int | None = None
    active_match: int | None = None
    bracket_generated: bool = False


app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-secret-key-change-me")

socketio = SocketIO(
    app,
    async_mode=ASYNC_MODE,
    # Para producción se recomienda restringir CORS al dominio real.
    cors_allowed_origins=os.environ.get("CORS_ALLOWED_ORIGINS", "*"),
    ping_interval=25,
    ping_timeout=60,
)

# Estado en memoria (requisito): salas y mapeo sid -> sala.
rooms: dict[str, object] = {}
sid_to_room: dict[str, str] = {}
invite_code_to_tournament: dict[str, str] = {}
# Exclusión mutua básica para modificaciones concurrentes del estado.
rooms_lock = threading.RLock()

_printed_entry_links = False


def _print_entry_links(base_url: str) -> None:
    global _printed_entry_links
    if _printed_entry_links:
        return
    _printed_entry_links = True
    admin_url = base_url.rstrip("/") + "/admin/login"
    users_url = base_url.rstrip("/") + "/usuarios"
    print(f"Admin:    {admin_url}")
    print(f"Usuarios: {users_url}")


def _admin_creds_path() -> str:
    os.makedirs(app.instance_path, exist_ok=True)
    return os.path.join(app.instance_path, "admin_credentials.json")


def _load_admin_credentials() -> tuple[str, str]:
    env_user = (os.environ.get("ADMIN_USER") or "").strip()
    env_pass = os.environ.get("ADMIN_PASSWORD") or ""
    if env_user and env_pass:
        return env_user, env_pass

    path = _admin_creds_path()
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f) or {}
        user = str(data.get("user", "")).strip()
        pw = str(data.get("password", ""))
        if user and pw:
            return user, pw
    except FileNotFoundError:
        pass
    except (OSError, ValueError, TypeError):
        pass
    return "", ""


def _save_admin_credentials(user: str, password: str) -> None:
    path = _admin_creds_path()
    payload = {"user": user.strip(), "password": password}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)


@app.before_request
def _print_entry_links_once():
    base_url = os.environ.get("PUBLIC_BASE_URL") or request.host_url.rstrip("/")
    _print_entry_links(base_url)
    return None


def _ensure_invite_index() -> None:
    if invite_code_to_tournament:
        return
    for obj in rooms.values():
        if isinstance(obj, TournamentRoom):
            for code in obj.invite_codes:
                invite_code_to_tournament[code] = obj.room_id


def _unique_invite_codes(count: int) -> list[str]:
    codes: list[str] = []
    while len(codes) < count:
        c = _generate_invite_code()
        if c in invite_code_to_tournament:
            continue
        if c in codes:
            continue
        codes.append(c)
    return codes


def _get_or_create_room(room_id: str) -> GameRoom:
    # Crea la sala si aún no existe (permite entrar por URL directa /juego/<id>).
    if room_id not in rooms:
        rooms[room_id] = GameRoom(room_id=room_id)
    room = rooms[room_id]
    if isinstance(room, TournamentRoom):
        raise RuntimeError("Sala ya creada como torneo.")
    return room  # type: ignore[return-value]


def _get_or_create_tournament(room_id: str, max_players: int) -> TournamentRoom:
    if room_id not in rooms:
        rooms[room_id] = TournamentRoom(room_id=room_id, max_players=max_players)
    room = rooms[room_id]
    if isinstance(room, GameRoom):
        raise RuntimeError("Sala ya creada como duelo.")
    if max_players:
        room.max_players = max_players
        if not room.invite_codes:
            _ensure_invite_index()
            room.invite_codes = _unique_invite_codes(room.max_players)
            for c in room.invite_codes:
                invite_code_to_tournament[c] = room.room_id
    return room


def _player_name(room: GameRoom, sid: str) -> str:
    if sid not in room.players:
        return "Espectador"
    index = room.players.index(sid)
    return f"Jugador {index + 1}"


def _players_payload(room: GameRoom) -> dict:
    items = []
    for slot_index in range(2):
        if slot_index < len(room.players):
            items.append({"name": f"Jugador {slot_index + 1}", "connected": True})
        else:
            items.append({"name": f"Jugador {slot_index + 1}", "connected": False})
    return {"count": len(room.players), "players": items}


def _broadcast_room_state(room: GameRoom) -> None:
    # Actualiza la UI de ambos jugadores con el estado de conexión.
    socketio.emit("players_update", _players_payload(room), room=room.room_id)
    if len(room.players) < 2:
        socketio.emit(
            "status",
            {"text": "Esperando jugador..."},
            room=room.room_id,
        )


def _winner_for_choices(choice_1: str, choice_2: str) -> int:
    # 0 empate, 1 gana jugador 1, 2 gana jugador 2.
    if choice_1 == choice_2:
        return 0
    wins_against = {"piedra": "tijera", "tijera": "papel", "papel": "piedra"}
    return 1 if wins_against[choice_1] == choice_2 else 2


def _start_countdown_if_ready(room_id: str) -> None:
    with rooms_lock:
        room = rooms.get(room_id)
        if not room:
            return
        # Seguridad básica: el juego solo inicia con exactamente 2 jugadores.
        if len(room.players) != 2:
            return
        # Evita duplicar tareas si llegan eventos casi simultáneos.
        if room.countdown_task_running:
            return
        room.state = "countdown"
        room.countdown_task_running = True
        room.choices.clear()

    def _task() -> None:
        try:
            # Limpia UI y lanza la cuenta regresiva en tiempo real (WebSockets).
            socketio.emit("round_reset", {}, room=room_id)
            socketio.emit("status", {"text": "Preparados... comienza en"}, room=room_id)
            for seconds in range(5, 0, -1):
                socketio.emit("countdown", {"seconds": seconds}, room=room_id)
                socketio.sleep(1)

            with rooms_lock:
                room = rooms.get(room_id)
                if not room:
                    return
                # Si alguien se fue durante el contador, aborta y vuelve a waiting.
                if len(room.players) != 2:
                    room.state = "waiting"
                    return
                # Se habilitan elecciones.
                room.state = "playing"
                room.choices.clear()

            socketio.emit("countdown", {"seconds": 0}, room=room_id)
            socketio.emit("round_started", {}, room=room_id)
            socketio.emit("status", {"text": "Elige tu jugada"}, room=room_id)
            duel_seconds = int(os.environ.get("DUEL_BATTLE_SECONDS", "20"))
            socketio.start_background_task(_duel_run_pick_timer, room_id, duel_seconds)
        finally:
            with rooms_lock:
                room = rooms.get(room_id)
                if room:
                    room.countdown_task_running = False

    socketio.start_background_task(_task)


def _schedule_next_round(room_id: str) -> None:
    # Reinicia la partida automáticamente (requisito) sin recargar la página.
    def _task() -> None:
        socketio.sleep(5)
        _start_countdown_if_ready(room_id)

    socketio.start_background_task(_task)


def _duel_run_pick_timer(room_id: str, battle_seconds: int) -> None:
    for remaining in range(battle_seconds, -1, -1):
        with rooms_lock:
            room = rooms.get(room_id)
            if not isinstance(room, GameRoom):
                return
            if room.state != "playing":
                return
            if len(room.players) != 2:
                return
        socketio.emit("pick_timer", {"seconds": remaining}, room=room_id)
        socketio.sleep(1)

    with rooms_lock:
        room = rooms.get(room_id)
        if not isinstance(room, GameRoom):
            return
        if room.state != "playing":
            return
        if len(room.players) != 2:
            return
        sid_1, sid_2 = room.players[0], room.players[1]
        choice_1 = room.choices.get(sid_1, "")
        choice_2 = room.choices.get(sid_2, "")
        room.state = "result"

    if not choice_1 and not choice_2:
        result_text = "Nadie eligió"
    elif choice_1 and not choice_2:
        result_text = "Gana Jugador 1 (el rival no eligió)"
    elif choice_2 and not choice_1:
        result_text = "Gana Jugador 2 (el rival no eligió)"
    else:
        winner = _winner_for_choices(choice_1, choice_2)
        result_text = "¡Empate!" if winner == 0 else ("Gana Jugador 1" if winner == 1 else "Gana Jugador 2")

    socketio.emit(
        "round_result",
        {"player_1_choice": choice_1, "player_2_choice": choice_2, "result_text": result_text},
        room=room_id,
    )
    socketio.emit("status", {"text": "Nueva ronda en 5 segundos..."}, room=room_id)
    _schedule_next_round(room_id)


def _tournament_name_for_code(room: TournamentRoom, code: str | None) -> str:
    if not code:
        return "—"
    profile = room.profiles.get(code)
    if profile and profile.name:
        return profile.name
    return f"Jugador {code}"


def _tournament_registered_payload(room: TournamentRoom) -> dict:
    items = []
    for code in room.invite_codes:
        prof = room.profiles.get(code)
        items.append(
            {
                "code": code,
                "redeemed": code in room.redeemed_codes,
                "name": prof.name if prof else "",
                "connected": code in room.code_to_sid,
            }
        )
    return {"count": len(room.redeemed_codes), "max": room.max_players, "players": items}


def _tournament_bracket_payload(room: TournamentRoom) -> dict:
    rounds = []
    for r_idx, rnd in enumerate(room.rounds):
        matches = []
        for m_idx, m in enumerate(rnd):
            matches.append(
                {
                    "round": r_idx,
                    "match": m_idx,
                    "p1": _tournament_name_for_code(room, m.p1_code),
                    "p2": _tournament_name_for_code(room, m.p2_code),
                    "status": m.status,
                    "winner": _tournament_name_for_code(room, m.winner_code),
                }
            )
        rounds.append({"round": r_idx, "matches": matches})
    return {"round_index": room.round_index, "rounds": rounds}


def _tournament_profile_payload(room: TournamentRoom, code: str | None) -> dict | None:
    if not code:
        return None
    prof = room.profiles.get(code)
    return {
        "code": code,
        "name": (prof.name if prof else "") or _tournament_name_for_code(room, code),
        "age": prof.age if prof else "",
        "account_type": prof.account_type if prof else "",
        "account": prof.account if prof else "",
    }


def _tournament_state_payload(room: TournamentRoom) -> dict:
    active = None
    if room.active_round is not None and room.active_match is not None:
        m = room.rounds[room.active_round][room.active_match]
        active = {
            "round": room.active_round,
            "match": room.active_match,
            "p1": _tournament_name_for_code(room, m.p1_code),
            "p2": _tournament_name_for_code(room, m.p2_code),
            "status": m.status,
        }

    has_active = room.active_round is not None and room.active_match is not None
    players_full = len(room.redeemed_codes) == room.max_players
    has_pending = False
    if room.state == "in_progress" and room.rounds:
        for m in room.rounds[room.round_index]:
            if m.status == "pending" and m.p2_code is not None:
                has_pending = True
                break

    return {
        "state": room.state,
        "prize": room.prize,
        "battle_seconds": room.battle_seconds,
        "countdown_seconds": room.countdown_seconds,
        "players": _tournament_registered_payload(room),
        "active": active,
        "players_full": players_full,
        "has_active": has_active,
        "has_pending": has_pending,
        "bracket_generated": room.bracket_generated,
        "winner_profile": _tournament_profile_payload(room, room.final_winner_code),
    }


def _build_round_from_codes(codes: list[str]) -> list[TournamentMatch]:
    matches: list[TournamentMatch] = []
    i = 0
    while i < len(codes):
        p1 = codes[i]
        p2 = codes[i + 1] if i + 1 < len(codes) else None
        m = TournamentMatch(p1_code=p1, p2_code=p2)
        if p2 is None:
            m.status = "done"
            m.winner_code = p1
        matches.append(m)
        i += 2
    return matches


def _advance_if_round_complete(room: TournamentRoom) -> None:
    if room.state != "in_progress":
        return
    if not room.rounds:
        return
    current = room.rounds[room.round_index]
    if any(m.status != "done" for m in current):
        return
    winners = [m.winner_code for m in current if m.winner_code]
    if len(winners) <= 1:
        room.state = "finished"
        room.final_winner_code = winners[0] if winners else room.final_winner_code
        room.active_round = None
        room.active_match = None
        return
    room.round_index += 1
    if room.round_index >= len(room.rounds):
        room.rounds.append(_build_round_from_codes([w for w in winners if w]))
    room.active_round = None
    room.active_match = None


def _tournament_start_next_match(room: TournamentRoom) -> TournamentMatch | None:
    if room.state != "in_progress":
        return None
    if room.active_round is not None or room.active_match is not None:
        return None
    rnd = room.rounds[room.round_index]
    for idx, m in enumerate(rnd):
        if m.status == "pending" and m.p2_code is not None:
            m.status = "ready"
            m.ready.clear()
            m.choices.clear()
            m.winner_code = None
            m.loser_code = None
            room.active_round = room.round_index
            room.active_match = idx
            return m
    return None


def _tournament_finish_active_as_win(room: TournamentRoom, winner_code: str, loser_code: str | None) -> None:
    if room.active_round is None or room.active_match is None:
        return
    m = room.rounds[room.active_round][room.active_match]
    m.status = "done"
    m.winner_code = winner_code
    m.loser_code = loser_code
    room.active_round = None
    room.active_match = None

    _advance_if_round_complete(room)

    if room.state == "finished":
        room.final_winner_code = winner_code
        socketio.emit(
            "tournament_finished",
            {
                "winner": _tournament_name_for_code(room, winner_code),
                "profile": _tournament_profile_payload(room, winner_code),
            },
            room=room.room_id,
        )

    socketio.emit("tournament_bracket", _tournament_bracket_payload(room), room=room.room_id)
    socketio.emit("tournament_state", _tournament_state_payload(room), room=room.room_id)


def _tournament_resolve_active_pick(room_id: str, room: TournamentRoom) -> None:
    if room.active_round is None or room.active_match is None:
        return
    m = room.rounds[room.active_round][room.active_match]
    if m.status != "picking":
        return

    c1 = m.choices.get(m.p1_code, "")
    c2 = m.choices.get(m.p2_code or "", "")

    p1_name = _tournament_name_for_code(room, m.p1_code)
    p2_name = _tournament_name_for_code(room, m.p2_code)

    if not c1 and not c2:
        m.status = "ready"
        m.ready.clear()
        m.choices.clear()
        socketio.emit(
            "tournament_result",
            {"result": "Nadie eligió. Repitan la pelea.", "p1_choice": "", "p2_choice": "", "repeat": True, "winner": ""},
            room=room_id,
        )
        socketio.emit("tournament_status", {"text": "Presionen 'Estoy listo' otra vez."}, room=room_id)
        socketio.emit("tournament_state", _tournament_state_payload(room), room=room_id)
        return

    if c1 and not c2:
        winner_code = m.p1_code
        loser_code = m.p2_code
        result_text = f"Gana {p1_name} (el rival no eligió)"
        socketio.emit(
            "tournament_result",
            {"result": result_text, "p1_choice": c1, "p2_choice": "", "repeat": False, "winner": p1_name},
            room=room_id,
        )
        _tournament_finish_active_as_win(room, winner_code, loser_code)
        return

    if c2 and not c1:
        winner_code = m.p2_code  # type: ignore[assignment]
        loser_code = m.p1_code
        result_text = f"Gana {p2_name} (el rival no eligió)"
        socketio.emit(
            "tournament_result",
            {"result": result_text, "p1_choice": "", "p2_choice": c2, "repeat": False, "winner": p2_name},
            room=room_id,
        )
        _tournament_finish_active_as_win(room, winner_code, loser_code)
        return

    winner = _winner_for_choices(c1, c2)
    if winner == 0:
        m.status = "ready"
        m.ready.clear()
        m.choices.clear()
        socketio.emit(
            "tournament_result",
            {"result": "¡Empate! Repitan la pelea.", "p1_choice": c1, "p2_choice": c2, "repeat": True, "winner": ""},
            room=room_id,
        )
        socketio.emit("tournament_status", {"text": "Presionen 'Estoy listo' otra vez."}, room=room_id)
        socketio.emit("tournament_state", _tournament_state_payload(room), room=room_id)
        return

    if winner == 1:
        winner_code = m.p1_code
        loser_code = m.p2_code
        winner_name = p1_name
    else:
        winner_code = m.p2_code  # type: ignore[assignment]
        loser_code = m.p1_code
        winner_name = p2_name

    result_text = f"Gana {winner_name}"
    socketio.emit(
        "tournament_result",
        {"result": result_text, "p1_choice": c1, "p2_choice": c2, "repeat": False, "winner": winner_name},
        room=room_id,
    )
    _tournament_finish_active_as_win(room, winner_code, loser_code)


def _tournament_run_countdown_and_pick(room_id: str, countdown_seconds: int, battle_seconds: int) -> None:
    for sec in range(countdown_seconds, 0, -1):
        socketio.emit("tournament_countdown", {"seconds": sec}, room=room_id)
        socketio.sleep(1)

    with rooms_lock:
        room = rooms.get(room_id)
        if not isinstance(room, TournamentRoom):
            return
        if room.active_round is None or room.active_match is None:
            return
        m = room.rounds[room.active_round][room.active_match]
        if m.status != "countdown":
            return
        m.status = "picking"
        m.choices.clear()

    socketio.emit("tournament_pick_started", {"seconds": battle_seconds}, room=room_id)
    for remaining in range(battle_seconds, -1, -1):
        with rooms_lock:
            room = rooms.get(room_id)
            if not isinstance(room, TournamentRoom):
                return
            if room.active_round is None or room.active_match is None:
                return
            m = room.rounds[room.active_round][room.active_match]
            if m.status != "picking":
                break
        socketio.emit("tournament_pick_timer", {"seconds": remaining}, room=room_id)
        socketio.sleep(1)

    with rooms_lock:
        room = rooms.get(room_id)
        if not isinstance(room, TournamentRoom):
            return
        _tournament_resolve_active_pick(room_id, room)


@app.get("/")
def index():
    return render_template_string(
        """
<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Inicio</title>
    <link rel="stylesheet" href="{{ url_for('static', filename='estilos.css') }}" />
  </head>
  <body class="page--home">
    <main class="app app--home">
      <header class="top">
        <div class="brand brand--home">
          <img class="homeLogo" src="{{ url_for('static', filename='rps/INICIO.jpg') }}" alt="Bienvenidos - Piedra Papel Tijera" />
          <p class="subtitle">Elige cómo entrar</p>
        </div>
      </header>

      <section class="panel">
        <div class="status">Selecciona una opción:</div>
        <div class="actions actions--home">
          <a class="btn btn--paper" href="{{ url_for('users_portal') }}">Usuario</a>
          <a class="btn btn--rock" href="{{ url_for('admin_login') }}">Admin</a>
        </div>
      </section>
    </main>
  </body>
</html>
        """.strip()
    )


@app.get("/juego/<id_sala>")
def juego(id_sala: str):
    id_sala = id_sala.strip().upper()
    if not id_sala:
        return redirect(url_for("index"))
    with rooms_lock:
        _get_or_create_room(id_sala)
    return render_template("juego.html", room_id=id_sala, mode="duel", max_players=2)


@app.get("/torneo")
def torneo_create():
    try:
        n = int(request.args.get("n", "10"))
    except ValueError:
        n = 10
    n = max(2, min(64, n))
    return redirect(url_for("admin_login", next=url_for("admin_setup", n=n)))


@app.get("/torneo/<id_torneo>")
def torneo_room(id_torneo: str):
    return redirect(url_for("join_tournament", id_torneo=id_torneo.strip().upper()))


def _is_admin_logged_in() -> bool:
    return bool(session.get("admin_auth"))


@app.route("/admin/login", methods=["GET", "POST"])
def admin_login():
    next_url = (request.args.get("next") or request.form.get("next") or url_for("admin_menu")).strip()
    if request.method == "GET":
        if _is_admin_logged_in():
            return redirect(next_url or url_for("admin_menu"))
        return render_template("admin_login.html", next_url=next_url, error="")

    username = (request.form.get("username") or "").strip()
    password = (request.form.get("password") or "").strip()

    expected_user, expected = _load_admin_credentials()
    if not expected_user or not expected:
        return render_template("admin_login.html", next_url=next_url, error="Admin no configurado.")
    if username.strip().upper() != expected_user.strip().upper():
        return render_template("admin_login.html", next_url=next_url, error="Usuario incorrecto.")
    if password != expected:
        return render_template("admin_login.html", next_url=next_url, error="Contraseña incorrecta.")

    session["admin_auth"] = True
    session["admin_username"] = username or "Admin"
    return redirect(next_url or url_for("admin_menu"))


@app.get("/admin/logout")
def admin_logout():
    session.pop("admin_auth", None)
    session.pop("admin_username", None)
    return redirect(url_for("admin_login"))


@app.get("/admin")
def admin_menu():
    if not _is_admin_logged_in():
        return redirect(url_for("admin_login", next=url_for("admin_menu")))
    base_url = os.environ.get("PUBLIC_BASE_URL") or request.host_url.rstrip("/")
    with rooms_lock:
        tournaments = []
        for obj in rooms.values():
            if isinstance(obj, TournamentRoom):
                tournaments.append(
                    {
                        "id": obj.room_id,
                        "join_url": base_url + url_for("join_tournament", id_torneo=obj.room_id),
                        "admin_url": url_for("admin_dashboard", id_torneo=obj.room_id),
                        "count": len(obj.redeemed_codes),
                        "max": obj.max_players,
                    }
                )
        tournaments.sort(key=lambda x: x["id"])
    return render_template(
        "admin_menu.html",
        username=session.get("admin_username", "Admin"),
        tournaments=tournaments,
    )


@app.route("/admin/setup", methods=["GET", "POST"])
def admin_setup():
    if not _is_admin_logged_in():
        return redirect(url_for("admin_login", next=url_for("admin_setup", n=request.args.get("n", "10"))))
    base_url = os.environ.get("PUBLIC_BASE_URL") or request.host_url.rstrip("/")
    if request.method == "GET":
        try:
            n = int(request.args.get("n", "10"))
        except ValueError:
            n = 10
        n = max(2, min(64, n))
        return render_template("admin_setup.html", base_url=base_url, max_players=n)

    try:
        max_players = int(request.form.get("max_players", "10"))
    except ValueError:
        max_players = 10
    max_players = max(2, min(64, max_players))

    prize = (request.form.get("prize") or "").strip()

    try:
        battle_seconds = int(request.form.get("battle_seconds", "60"))
    except ValueError:
        battle_seconds = 60
    battle_seconds = max(10, min(600, battle_seconds))

    try:
        countdown_seconds = int(request.form.get("countdown_seconds", "3"))
    except ValueError:
        countdown_seconds = 3
    countdown_seconds = max(1, min(10, countdown_seconds))

    room_id = _generate_room_id()
    with rooms_lock:
        room = _get_or_create_tournament(room_id, max_players)
        room.prize = prize
        room.battle_seconds = battle_seconds
        room.countdown_seconds = countdown_seconds
        if not room.invite_codes:
            _ensure_invite_index()
            room.invite_codes = _unique_invite_codes(room.max_players)
            for c in room.invite_codes:
                invite_code_to_tournament[c] = room.room_id

    return redirect(url_for("admin_dashboard", id_torneo=room_id))


@app.get("/admin/t/<id_torneo>")
def admin_dashboard(id_torneo: str):
    if not _is_admin_logged_in():
        return redirect(url_for("admin_login", next=url_for("admin_dashboard", id_torneo=id_torneo)))
    id_torneo = id_torneo.strip().upper()
    base_url = os.environ.get("PUBLIC_BASE_URL") or request.host_url.rstrip("/")
    with rooms_lock:
        room = rooms.get(id_torneo)
        if not isinstance(room, TournamentRoom):
            return ("Torneo no encontrado", 404)
        join_url = base_url + url_for("users_portal")
        play_url = base_url + url_for("play_tournament", id_torneo=id_torneo)
        spectator_code = room.spectator_code
        spectator_url = base_url + url_for("play_tournament", id_torneo=id_torneo, sk=spectator_code)
        payload = _tournament_state_payload(room)
        invite_codes = list(room.invite_codes)

    return render_template(
        "admin_dashboard.html",
        room_id=id_torneo,
        base_url=base_url,
        join_url=join_url,
        play_url=play_url,
        spectator_code=spectator_code,
        spectator_url=spectator_url,
        username=session.get("admin_username", "Admin"),
        tournament=payload,
        invite_codes=invite_codes,
    )


@app.get("/admin/t/<id_torneo>/codes.txt")
def admin_codes_txt(id_torneo: str):
    if not _is_admin_logged_in():
        return redirect(url_for("admin_login", next=url_for("admin_codes_txt", id_torneo=id_torneo)))
    id_torneo = id_torneo.strip().upper()
    with rooms_lock:
        room = rooms.get(id_torneo)
        if not isinstance(room, TournamentRoom):
            return ("Torneo no encontrado", 404)
        codes = list(room.invite_codes)
    body = "\n".join([c.strip().upper() for c in codes if c]) + "\n"
    filename = f"{id_torneo}_codigos.txt"
    return Response(
        body,
        mimetype="text/plain",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.route("/join/<id_torneo>", methods=["GET", "POST"])
def join_tournament(id_torneo: str):
    id_torneo = id_torneo.strip().upper()
    base_url = os.environ.get("PUBLIC_BASE_URL") or request.host_url.rstrip("/")
    with rooms_lock:
        room = rooms.get(id_torneo)
        if not isinstance(room, TournamentRoom):
            return ("Torneo no encontrado", 404)
        prize = room.prize
        count = len(room.redeemed_codes)
        max_players = room.max_players

    if request.method == "GET":
        prefill_code = (request.args.get("code") or "").strip().upper()
        return render_template(
            "join.html",
            room_id=id_torneo,
            base_url=base_url,
            prize=prize,
            count=count,
            max_players=max_players,
            prefill_code=prefill_code,
            error="",
        )

    code = (request.form.get("code") or "").strip().upper()
    name = (request.form.get("name") or "").strip()
    age = (request.form.get("age") or "").strip()
    account_type = (request.form.get("account_type") or "").strip().upper()
    account = (request.form.get("account") or "").strip()

    with rooms_lock:
        room = rooms.get(id_torneo)
        if not isinstance(room, TournamentRoom):
            return ("Torneo no encontrado", 404)
        if not code or code not in room.invite_codes:
            error = "Código inválido."
        elif code in room.redeemed_codes:
            error = "Ese código ya fue usado."
        elif len(room.redeemed_codes) >= room.max_players:
            error = "El torneo ya está completo."
        else:
            room.redeemed_codes.add(code)
            room.profiles[code] = PlayerProfile(code=code, name=name, age=age, account_type=account_type, account=account)
            player_key = _generate_secret(18)
            room.player_keys[player_key] = code
            error = ""
        count = len(room.redeemed_codes)
        state_payload = _tournament_state_payload(room)

    if error:
        return render_template(
            "join.html",
            room_id=id_torneo,
            base_url=base_url,
            prize=prize,
            count=count,
            max_players=max_players,
            prefill_code=code,
            prefill_account_type=account_type,
            error=error,
        )

    socketio.emit("tournament_state", state_payload, room=id_torneo)
    return redirect(url_for("play_tournament", id_torneo=id_torneo, k=player_key))


@app.route("/usuarios", methods=["GET", "POST"])
def users_portal():
    base_url = os.environ.get("PUBLIC_BASE_URL") or request.host_url.rstrip("/")
    if request.method == "POST":
        token = (request.form.get("token") or "").strip().upper()
        if not token:
            return redirect(url_for("users_portal"))

        with rooms_lock:
            _ensure_invite_index()
            torneo_id = None
            prefill_code = ""
            status_error = ""

            obj = rooms.get(token)
            if isinstance(obj, TournamentRoom):
                torneo_id = obj.room_id
            else:
                mapped = invite_code_to_tournament.get(token)
                if mapped:
                    torneo_id = mapped
                    prefill_code = token

            if torneo_id and prefill_code:
                tor = rooms.get(torneo_id)
                if isinstance(tor, TournamentRoom):
                    if prefill_code in tor.redeemed_codes:
                        status_error = "usado"
                    elif len(tor.redeemed_codes) >= tor.max_players:
                        status_error = "lleno"
                else:
                    torneo_id = None

        if not torneo_id:
            return redirect(url_for("users_portal", e="noexiste"))
        if status_error:
            return redirect(url_for("users_portal", e=status_error))

        if prefill_code:
            return redirect(url_for("join_tournament", id_torneo=torneo_id, code=prefill_code))
        return redirect(url_for("join_tournament", id_torneo=torneo_id))

    error = ""
    e = (request.args.get("e") or "").strip().lower()
    if e == "noexiste":
        error = "No existe ese código/torneo. Pídele al organizador el código correcto o asegúrate de que el torneo ya fue creado."
    elif e == "usado":
        error = "Ese código ya fue usado. Pídele al organizador otro código."
    elif e == "lleno":
        error = "El torneo ya está completo. No se aceptan más jugadores."

    return render_template_string(
        """
<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Usuarios</title>
    <link rel="stylesheet" href="{{ css }}" />
  </head>
  <body>
    <main class="app">
      <header class="top">
        <div class="brand">
          <h1 class="title">Ingreso de jugadores</h1>
          <p class="subtitle">Pega el ID del torneo y entra</p>
        </div>
      </header>

      <section class="panel">
        <div class="panel__row">
          <div class="pill pill--ok">Listo</div>
          <div class="pill pill--accent">Usuarios</div>
        </div>

        <div class="status">Ingresa el código que te dio el organizador</div>
        <section class="join">
          {% if error %}
            <div class="join__error" style="margin-bottom:10px">{{ error }}</div>
          {% endif %}
          <form class="join__form" action="{{ action }}" method="post">
            <label class="join__field" style="grid-column: 1 / -1;">
              <span class="join__label">Código</span>
              <input class="join__input" type="text" name="token" placeholder="Ej: A1B2C3D4" required />
            </label>
            <button class="btn btn--paper" type="submit">Entrar</button>
          </form>
        </section>
      </section>
    </main>
  </body>
</html>
        """,
        css=url_for("static", filename="estilos.css"),
        action=url_for("users_portal"),
        error=error,
        base_url=base_url,
    )


@app.get("/t/<id_torneo>")
def play_tournament(id_torneo: str):
    id_torneo = id_torneo.strip().upper()
    player_key = (request.args.get("k") or "").strip()
    spectator_key = (request.args.get("sk") or "").strip().upper()
    base_url = os.environ.get("PUBLIC_BASE_URL") or request.host_url.rstrip("/")
    is_spectator = False
    with rooms_lock:
        room = rooms.get(id_torneo)
        if not isinstance(room, TournamentRoom):
            return ("Torneo no encontrado", 404)
        is_spectator = bool(spectator_key and spectator_key == (room.spectator_code or "").upper())
        if not is_spectator:
            if player_key not in room.player_keys:
                return ("Acceso inválido", 403)
        prize = room.prize
        battle_seconds = room.battle_seconds
        countdown_seconds = room.countdown_seconds

    return render_template(
        "tournament.html",
        room_id=id_torneo,
        base_url=base_url,
        player_key=player_key if not is_spectator else "",
        spectator_key=spectator_key if is_spectator else "",
        prize=prize,
        battle_seconds=battle_seconds,
        countdown_seconds=countdown_seconds,
    )


@app.get("/qr/<room_id>.png")
def qr_png(room_id: str):
    room_id = (room_id or "").strip().upper()
    if not room_id:
        return ("Sala inválida", 400)

    url_to_encode = request.args.get("u")
    if not url_to_encode:
        base_url = os.environ.get("PUBLIC_BASE_URL") or request.host_url.rstrip("/")
        url_to_encode = base_url + url_for("juego", id_sala=room_id)

    if not (url_to_encode.startswith("http://") or url_to_encode.startswith("https://")):
        return ("URL inválida", 400)

    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=12,
        border=2,
    )
    qr.add_data(url_to_encode)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")

    buf = BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)

    return send_file(
        buf,
        mimetype="image/png",
        download_name=f"qr_{room_id}.png",
        max_age=0,
    )


@socketio.on("join")
def on_join(data):
    room_id = (data or {}).get("room_id", "")
    room_id = str(room_id).strip().upper()
    if not room_id:
        emit("error_message", {"text": "Sala inválida."})
        return

    mode = str((data or {}).get("mode", "duel")).strip().lower()

    base_url = os.environ.get("PUBLIC_BASE_URL") or request.host_url.rstrip("/")

    with rooms_lock:
        if mode == "tournament_admin":
            if not _is_admin_logged_in():
                emit("error_message", {"text": "Admin no autenticado."})
                disconnect()
                return
            room = rooms.get(room_id)
            if not isinstance(room, TournamentRoom):
                emit("error_message", {"text": "Torneo no encontrado."})
                disconnect()
                return
            room.admin_sid = request.sid
            sid_to_room[request.sid] = room_id
        elif mode == "tournament_spectator":
            room = rooms.get(room_id)
            if not isinstance(room, TournamentRoom):
                emit("error_message", {"text": "Torneo no encontrado."})
                disconnect()
                return
            spectator_key = str((data or {}).get("spectator_key", "")).strip().upper()
            if not spectator_key or spectator_key != (room.spectator_code or "").upper():
                emit("error_message", {"text": "Acceso inválido."})
                disconnect()
                return
            sid_to_room[request.sid] = room_id
        elif mode == "tournament_player":
            room = rooms.get(room_id)
            if not isinstance(room, TournamentRoom):
                emit("error_message", {"text": "Torneo no encontrado."})
                disconnect()
                return
            player_key = str((data or {}).get("player_key", "")).strip()
            code = room.player_keys.get(player_key)
            if not code:
                emit("error_message", {"text": "Acceso inválido."})
                disconnect()
                return
            if code not in room.redeemed_codes:
                emit("error_message", {"text": "Código no registrado."})
                disconnect()
                return
            old_sid = room.code_to_sid.get(code)
            if old_sid and old_sid != request.sid:
                room.sid_to_code.pop(old_sid, None)
                sid_to_room.pop(old_sid, None)
                try:
                    socketio.server.disconnect(old_sid)
                except Exception:
                    pass
            room.code_to_sid[code] = request.sid
            room.sid_to_code[request.sid] = code
            sid_to_room[request.sid] = room_id
        else:
            room = _get_or_create_room(room_id)
            if request.sid in room.players:
                sid_to_room[request.sid] = room_id
            else:
                if len(room.players) >= 2:
                    emit("room_full", {"text": "La sala ya tiene 2 jugadores."})
                    disconnect()
                    return
                room.players.append(request.sid)
                sid_to_room[request.sid] = room_id

    # join_room habilita que los emits con room=<id> lleguen solo a esa sala.
    join_room(room_id)

    if mode == "tournament_admin":
        share_url = base_url + url_for("join_tournament", id_torneo=room_id)
        you_are = "Organizador"
        is_admin = True
    elif mode == "tournament_spectator":
        share_url = base_url + url_for("users_portal")
        you_are = "Espectador"
        is_admin = False
    elif mode == "tournament_player":
        share_url = base_url + url_for("join_tournament", id_torneo=room_id)
        code = room.sid_to_code.get(request.sid) if isinstance(room, TournamentRoom) else None
        you_are = _tournament_name_for_code(room, code) if isinstance(room, TournamentRoom) else "Jugador"
        is_admin = False
    else:
        share_url = base_url + url_for("juego", id_sala=room_id)
        you_are = _player_name(room, request.sid)
        is_admin = False

    emit(
        "joined",
        {
            "room_id": room_id,
            "you_are": you_are,
            "share_url": share_url,
            "qr_path": url_for("qr_png", room_id=room_id),
            "mode": mode,
            "is_admin": is_admin,
        },
    )

    with rooms_lock:
        room = rooms.get(room_id)
        if not room:
            return
        if isinstance(room, TournamentRoom):
            socketio.emit("tournament_bracket", _tournament_bracket_payload(room), room=room.room_id)
            if room.state == "lobby":
                socketio.emit(
                    "tournament_status",
                    {"text": f"Registrados: {len(room.redeemed_codes)}/{room.max_players}. Esperando al organizador..."},
                    room=room.room_id,
                )
            if room.state == "in_progress" and room.active_round is None and room.active_match is None:
                socketio.emit(
                    "tournament_status",
                    {"text": "Esperando a que el organizador inicie la siguiente pelea..."},
                    room=room.room_id,
                )
            socketio.emit("tournament_state", _tournament_state_payload(room), room=room.room_id)
        else:
            _broadcast_room_state(room)
            _start_countdown_if_ready(room_id)


@socketio.on("tournament_generate_bracket")
def on_tournament_generate_bracket():
    with rooms_lock:
        room_id = sid_to_room.get(request.sid)
        room = rooms.get(room_id or "")
        if not isinstance(room, TournamentRoom):
            emit("error_message", {"text": "No estás en un torneo."})
            return
        if room.admin_sid != request.sid:
            emit("error_message", {"text": "Solo el organizador puede repartir jugadores."})
            return
        if room.bracket_generated:
            emit("error_message", {"text": "Las llaves ya fueron generadas."})
            return
        if len(room.redeemed_codes) != room.max_players:
            emit("error_message", {"text": "Aún faltan jugadores registrados."})
            return
        participants = list(room.redeemed_codes)
        random.shuffle(participants)
        room.round_index = 0
        room.rounds = [_build_round_from_codes(participants)]
        room.active_round = None
        room.active_match = None
        room.state = "in_progress"
        room.bracket_generated = True
        room.final_winner_code = None

    socketio.emit("tournament_bracket", _tournament_bracket_payload(room), room=room.room_id)
    socketio.emit("tournament_state", _tournament_state_payload(room), room=room.room_id)
    socketio.emit("tournament_status", {"text": "Llaves generadas. Inicia la primera pelea."}, room=room.room_id)


@socketio.on("tournament_start_next")
def on_tournament_start_next():
    with rooms_lock:
        room_id = sid_to_room.get(request.sid)
        room = rooms.get(room_id or "")
        if not isinstance(room, TournamentRoom):
            emit("error_message", {"text": "No estás en un torneo."})
            return
        if room.admin_sid != request.sid:
            emit("error_message", {"text": "Solo el organizador puede iniciar peleas."})
            return
        if not room.bracket_generated or room.state != "in_progress":
            emit("error_message", {"text": "Primero reparte jugadores (generar llaves)."})
            return
        match = _tournament_start_next_match(room)
        if not match:
            _advance_if_round_complete(room)
            if room.state == "finished":
                emit("error_message", {"text": "El torneo ya terminó."})
                return
            emit("error_message", {"text": "No hay peleas pendientes para iniciar."})
            socketio.emit("tournament_bracket", _tournament_bracket_payload(room), room=room.room_id)
            socketio.emit("tournament_state", _tournament_state_payload(room), room=room.room_id)
            return

        socketio.emit(
            "tournament_match_started",
            {
                "p1": _tournament_name_for_code(room, match.p1_code),
                "p2": _tournament_name_for_code(room, match.p2_code),
            },
            room=room.room_id,
        )
        socketio.emit("tournament_bracket", _tournament_bracket_payload(room), room=room.room_id)
        socketio.emit("tournament_state", _tournament_state_payload(room), room=room.room_id)
        socketio.emit("tournament_status", {"text": "Jugadores del duelo: presionen 'Estoy listo'."}, room=room.room_id)


@socketio.on("tournament_ready")
def on_tournament_ready():
    state_payload = None
    bracket_payload = None
    with rooms_lock:
        room_id = sid_to_room.get(request.sid)
        room = rooms.get(room_id or "")
        if not isinstance(room, TournamentRoom):
            emit("error_message", {"text": "No estás en un torneo."})
            return
        if room.active_round is None or room.active_match is None:
            emit("error_message", {"text": "Aún no hay pelea activa."})
            return
        code = room.sid_to_code.get(request.sid)
        if not code:
            emit("error_message", {"text": "Acceso inválido."})
            return
        m = room.rounds[room.active_round][room.active_match]
        if m.status != "ready":
            emit("error_message", {"text": "La pelea no está esperando 'listo'."})
            return
        if code not in {m.p1_code, m.p2_code}:
            emit("error_message", {"text": "No eres jugador de esta pelea."})
            return
        m.ready.add(code)
        socketio.emit(
            "tournament_ready_update",
            {
                "p1_ready": m.p1_code in m.ready,
                "p2_ready": (m.p2_code in m.ready) if m.p2_code else False,
            },
            room=room.room_id,
        )

        if m.p2_code is None:
            return
        if m.p1_code not in m.ready or m.p2_code not in m.ready:
            return

        if m.status in {"countdown", "picking"}:
            return
        m.status = "countdown"
        m.choices.clear()

        countdown_seconds = room.countdown_seconds
        battle_seconds = room.battle_seconds
        state_payload = _tournament_state_payload(room)
        bracket_payload = _tournament_bracket_payload(room)

    if bracket_payload is not None:
        socketio.emit("tournament_bracket", bracket_payload, room=room_id)
    if state_payload is not None:
        socketio.emit("tournament_state", state_payload, room=room_id)
    socketio.start_background_task(_tournament_run_countdown_and_pick, room_id, countdown_seconds, battle_seconds)


@socketio.on("tournament_force_battle")
def on_tournament_force_battle():
    state_payload = None
    bracket_payload = None
    with rooms_lock:
        room_id = sid_to_room.get(request.sid)
        room = rooms.get(room_id or "")
        if not isinstance(room, TournamentRoom):
            emit("error_message", {"text": "No estás en un torneo."})
            return
        if room.admin_sid != request.sid:
            emit("error_message", {"text": "Solo el organizador puede forzar la batalla."})
            return
        if room.active_round is None or room.active_match is None:
            emit("error_message", {"text": "Aún no hay pelea activa."})
            return
        m = room.rounds[room.active_round][room.active_match]
        if m.p2_code is None:
            emit("error_message", {"text": "No se puede forzar una pelea sin rival."})
            return
        if m.status != "ready":
            emit("error_message", {"text": "La pelea no está esperando 'listo'."})
            return
        m.status = "countdown"
        m.choices.clear()
        countdown_seconds = room.countdown_seconds
        battle_seconds = room.battle_seconds
        state_payload = _tournament_state_payload(room)
        bracket_payload = _tournament_bracket_payload(room)

    socketio.emit("tournament_status", {"text": "BATALLA forzada por el organizador."}, room=room_id)
    if bracket_payload is not None:
        socketio.emit("tournament_bracket", bracket_payload, room=room_id)
    if state_payload is not None:
        socketio.emit("tournament_state", state_payload, room=room_id)
    socketio.start_background_task(_tournament_run_countdown_and_pick, room_id, countdown_seconds, battle_seconds)


@socketio.on("tournament_regen_code")
def on_tournament_regen_code(data=None):
    old_code = str((data or {}).get("old_code", "")).strip().upper()
    if not old_code:
        emit("error_message", {"text": "Código inválido."})
        return

    state_payload = None
    new_code = ""
    with rooms_lock:
        room_id = sid_to_room.get(request.sid)
        room = rooms.get(room_id or "")
        if not isinstance(room, TournamentRoom):
            emit("error_message", {"text": "No estás en un torneo."})
            return
        if room.admin_sid != request.sid:
            emit("error_message", {"text": "Solo el organizador puede actualizar códigos."})
            return
        if old_code not in room.invite_codes:
            emit("error_message", {"text": "Ese código no existe en este torneo."})
            return
        if old_code in room.code_to_sid:
            emit("error_message", {"text": "Ese jugador está conectado. No se puede cambiar el código."})
            return
        if room.state != "lobby" and old_code in room.redeemed_codes:
            emit("error_message", {"text": "El torneo ya empezó. No se puede cambiar un código ya usado."})
            return

        if old_code in room.redeemed_codes:
            room.redeemed_codes.discard(old_code)
            room.profiles.pop(old_code, None)
            keys_to_delete = [k for k, v in room.player_keys.items() if v == old_code]
            for k in keys_to_delete:
                room.player_keys.pop(k, None)

        while True:
            c = _generate_invite_code()
            if c in invite_code_to_tournament:
                continue
            if c in room.invite_codes:
                continue
            new_code = c
            break

        idx = room.invite_codes.index(old_code)
        room.invite_codes[idx] = new_code
        invite_code_to_tournament.pop(old_code, None)
        invite_code_to_tournament[new_code] = room.room_id
        state_payload = _tournament_state_payload(room)

    emit("tournament_regen_code_done", {"old_code": old_code, "new_code": new_code})
    if state_payload is not None:
        socketio.emit("tournament_state", state_payload, room=room_id)


@socketio.on("make_choice")
def on_make_choice(data):
    choice = (data or {}).get("choice", "")
    choice = str(choice).strip().lower()
    if choice not in {"piedra", "papel", "tijera"}:
        emit("error_message", {"text": "Jugada inválida."})
        return

    with rooms_lock:
        room_id = sid_to_room.get(request.sid)
        room = rooms.get(room_id or "")
        if isinstance(room, TournamentRoom):
            if room.active_round is None or room.active_match is None:
                emit("error_message", {"text": "No hay pelea activa."})
                return
            code = room.sid_to_code.get(request.sid)
            if not code:
                emit("error_message", {"text": "Acceso inválido."})
                return
            m = room.rounds[room.active_round][room.active_match]
            if m.status != "picking":
                emit("error_message", {"text": "Aún no puedes elegir (espera el conteo)."})
                return
            if code not in {m.p1_code, m.p2_code}:
                emit("error_message", {"text": "No eres jugador de esta pelea."})
                return
            if code in m.choices:
                emit("error_message", {"text": "Ya elegiste."})
                return
            m.choices[code] = choice
            emit("tournament_choice_registered", {"choice": choice})
            return

        if not isinstance(room, GameRoom):
            emit("error_message", {"text": "Sala no encontrada."})
            return
        if request.sid not in room.players:
            emit("error_message", {"text": "No estás dentro de la sala."})
            return
        if len(room.players) != 2:
            emit("error_message", {"text": "Aún falta un jugador."})
            return
        if room.state != "playing":
            emit("error_message", {"text": "Aún no puedes elegir (espera la cuenta regresiva)."})
            return
        if request.sid in room.choices:
            emit("error_message", {"text": "Ya elegiste. Espera el resultado."})
            return

        room.choices[request.sid] = choice
        emit("choice_registered", {"choice": choice})

        if len(room.choices) < 2:
            socketio.emit(
                "status",
                {"text": "Esperando la jugada del rival..."},
                room=room.room_id,
            )
            return
        socketio.emit("status", {"text": "Ambos eligieron. Espera que termine el tiempo..."}, room=room.room_id)
        return


@socketio.on("disconnect")
def on_disconnect():
    room_id = sid_to_room.pop(request.sid, None)
    if not room_id:
        return

    leave_room(room_id)

    with rooms_lock:
        room = rooms.get(room_id)
        if not room:
            return
        if isinstance(room, TournamentRoom):
            if room.admin_sid == request.sid:
                room.admin_sid = None

            code = room.sid_to_code.pop(request.sid, None)
            if code:
                room.code_to_sid.pop(code, None)

            if code and room.active_round is not None and room.active_match is not None:
                m = room.rounds[room.active_round][room.active_match]
                if code in {m.p1_code, m.p2_code} and m.p2_code is not None:
                    other = m.p2_code if code == m.p1_code else m.p1_code
                    other_name = _tournament_name_for_code(room, other)
                    m.choices.pop(code, None)
                    socketio.emit(
                        "tournament_result",
                        {
                            "result": f"Gana {other_name} (el rival se desconectó)",
                            "p1_choice": "",
                            "p2_choice": "",
                            "repeat": False,
                            "winner": other_name,
                        },
                        room=room.room_id,
                    )
                    _tournament_finish_active_as_win(room, other, code)

            socketio.emit("tournament_bracket", _tournament_bracket_payload(room), room=room.room_id)
            socketio.emit("tournament_state", _tournament_state_payload(room), room=room.room_id)
            return

        if isinstance(room, GameRoom):
            if request.sid in room.players:
                room.players.remove(request.sid)
            room.choices.pop(request.sid, None)
            if len(room.players) == 0:
                rooms.pop(room_id, None)
                return
            room.state = "waiting"

    if isinstance(room, GameRoom):
        _broadcast_room_state(room)


if __name__ == "__main__":
    import socket

    def _pick_free_port(bind_host: str, start_port: int) -> int:
        for candidate in range(start_port, start_port + 25):
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            try:
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                sock.bind((bind_host, candidate))
            except OSError:
                continue
            finally:
                try:
                    sock.close()
                except OSError:
                    pass
            return candidate
        return start_port

    port = int(os.environ.get("PORT", "5000"))
    host = os.environ.get("HOST", "0.0.0.0")
    debug = os.environ.get("DEBUG", "0") == "1"
    port = _pick_free_port(host, port)
    public_base_url = os.environ.get("PUBLIC_BASE_URL")
    if public_base_url:
        _print_entry_links(public_base_url)
    else:
        _print_entry_links(f"http://127.0.0.1:{port}")
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            local_ip = s.getsockname()[0]
            try:
                s.close()
            except OSError:
                pass
            if local_ip and local_ip != "127.0.0.1":
                _print_entry_links(f"http://{local_ip}:{port}")
        except OSError:
            pass

    run_kwargs = {"host": host, "port": port, "debug": debug}
    if ASYNC_MODE == "threading":
        run_kwargs["allow_unsafe_werkzeug"] = True
    socketio.run(app, **run_kwargs)
