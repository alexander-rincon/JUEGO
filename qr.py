import argparse
import socket
import string
import random

import qrcode


def generate_room_id(length: int = 6) -> str:
    # Mantiene el mismo formato de sala que el servidor: 6 chars (A-Z, 0-9).
    alphabet = string.ascii_uppercase + string.digits
    return "".join(random.choice(alphabet) for _ in range(length))


def guess_local_ip() -> str:
    # Truco común: abrir un socket UDP “hacia afuera” para descubrir la IP local real.
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        ip = sock.getsockname()[0]
    finally:
        sock.close()
    return ip


def main() -> None:
    parser = argparse.ArgumentParser(description="Genera un QR para entrar a una sala del juego.")
    parser.add_argument("--ip", default=None, help="IP local (ej: 192.168.1.50). Si no se indica, se intenta detectar.")
    parser.add_argument("--port", default=5000, type=int, help="Puerto del servidor (por defecto: 5000).")
    parser.add_argument("--room", default=None, help="ID de sala (ej: ABC123). Si no se indica, se genera uno.")
    parser.add_argument("--output", default=None, help="Nombre de archivo PNG (por defecto: qr_<SALA>.png).")
    args = parser.parse_args()

    ip = args.ip or guess_local_ip()
    room_id = (args.room or generate_room_id()).strip().upper()
    url = f"http://{ip}:{args.port}/juego/{room_id}"
    output = args.output or f"qr_{room_id}.png"

    # El QR contiene la URL exacta para abrir la sala desde un celular.
    img = qrcode.make(url)
    img.save(output)

    print("Sala:", room_id)
    print("URL:", url)
    print("QR guardado en:", output)


if __name__ == "__main__":
    main()
