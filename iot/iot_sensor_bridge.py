"""
GreenSync IoT sensor bridge
Reads fill-level messages from Arduino/ESP8266 over serial and forwards them
to the FastAPI WebSocket endpoint.

Accepted serial formats:
    B-101,72
    B-101:72
    {"bin_id":"B-101","fill_level":72}
    72                  # uses DEFAULT_BIN_ID

Install:
    pip install pyserial websocket-client

Run:
    python iot_sensor_bridge.py
"""

from __future__ import annotations

import json
import os
import re
import time

import serial
from websocket import create_connection

SERIAL_PORT = os.getenv("SERIAL_PORT", "COM5")          # Windows example
BAUD_RATE = int(os.getenv("BAUD_RATE", "9600"))
WS_URL = os.getenv("GREENSYNC_WS_URL", "ws://localhost:8000/ws/bins")
DEFAULT_BIN_ID = os.getenv("DEFAULT_BIN_ID", "B-101")


def parse_serial_line(line: str) -> tuple[str, float] | None:
    line = line.strip()
    if not line:
        return None

    # JSON input
    try:
        data = json.loads(line)
        if "fill_level" in data:
            return str(data.get("bin_id", DEFAULT_BIN_ID)), float(data["fill_level"])
        if "fillLevel" in data:
            return str(data.get("bin_id", DEFAULT_BIN_ID)), float(data["fillLevel"])
    except (json.JSONDecodeError, ValueError, TypeError):
        pass

    # CSV / colon / key-value style
    match = re.search(r"([A-Za-z0-9_-]+)\s*[,;:]\s*([0-9]+(?:\.[0-9]+)?)", line)
    if match:
        return match.group(1), float(match.group(2))

    # A single numeric value means DEFAULT_BIN_ID
    match = re.fullmatch(r"\s*([0-9]+(?:\.[0-9]+)?)\s*", line)
    if match:
        return DEFAULT_BIN_ID, float(match.group(1))

    return None


def clamp_fill(value: float) -> float:
    return max(0.0, min(100.0, float(value)))


def main() -> None:
    print(f"GreenSync IoT bridge -> {WS_URL}")
    print(f"Serial: {SERIAL_PORT} @ {BAUD_RATE} baud")

    while True:
        try:
            with serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=1) as ser:
                print("Serial connected.")

                with create_connection(WS_URL, timeout=5) as ws:
                    print("WebSocket connected.")

                    while True:
                        raw = ser.readline().decode("utf-8", errors="ignore")
                        parsed = parse_serial_line(raw)
                        if not parsed:
                            continue

                        bin_id, fill_level = parsed
                        fill_level = clamp_fill(fill_level)

                        payload = {
                            "type": "telemetry",
                            "bin_id": bin_id,
                            "fill_level": fill_level,
                        }

                        ws.send(json.dumps(payload))
                        print("sent:", payload)

        except KeyboardInterrupt:
            print("\nBridge stopped.")
            break
        except Exception as exc:
            print(f"Connection error: {exc}")
            print("Retrying in 3 seconds...")
            time.sleep(3)


if __name__ == "__main__":
    main()
