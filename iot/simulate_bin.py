"""Continuously simulate Smart Bin telemetry for a laptop-only GreenSync demo.

No Arduino/ESP32 is required. Keep the Smart Bins page open in GreenSync and
watch B-101 move through Normal, Attention, and Critical states.
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request

URL = "http://localhost:8000/api/bins/B-101/telemetry"
LEVELS = [25, 42, 58, 72, 88, 96, 65, 35]

print("GreenSync Smart Bin Simulator")
print("Sending B-101 telemetry every 2 seconds. Press Ctrl+C to stop.\n")

try:
    while True:
        for level in LEVELS:
            payload = json.dumps({"fill_level": level}).encode("utf-8")
            request = urllib.request.Request(
                URL,
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            try:
                with urllib.request.urlopen(request, timeout=5) as response:
                    body = response.read().decode("utf-8")
                print(f"B-101 -> {level:>3}% | {body}")
            except urllib.error.URLError as exc:
                print(f"Backend unavailable. Start FastAPI first. ({exc})")
            time.sleep(2)
except KeyboardInterrupt:
    print("\nSimulator stopped.")
