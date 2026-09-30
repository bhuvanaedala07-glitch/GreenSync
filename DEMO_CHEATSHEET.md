# GreenSync — Final Hackathon Demo Cheat Sheet

## Before the demo

Keep these running:

```powershell
# Backend
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000

# Frontend
npm run dev

# Smart Bin simulator (no Arduino required)
python simulate_bin.py
```

Open `http://127.0.0.1:5173` in Chrome.

## 5-minute story

**1 — Citizen:** Submit an `Overflowing Bin` report for `Central Market`.

**2 — Authority:** Show the report appearing in the live Action Center without refresh. Point to its priority score.

**3 — Dispatch:** Click `Assign Worker`.

**4 — Worker:** Switch to Worker Portal → `Start Task` → `Mark Resolved`.

**5 — Authority:** Return to Command Center and show Active Issues / Resolved Today changing.

**6 — Smart Bins:** Open Smart Bins. The simulator changes B-101 every two seconds. Point out `Normal → Attention → Critical`.

**7 — AI:** Open AI Waste Check → Upload a waste image → show object, category, confidence, recommended bin, environmental impact. Then show `Use Live Webcam`.

## Strong 20-second explanation

"GreenSync closes the sanitation loop. A citizen report is prioritized by a transparent scoring engine, the authority dispatches a worker, the worker updates the task, and the dashboard reflects the result in real time. In parallel, smart-bin telemetry and AI waste classification provide the data needed for earlier intervention and better segregation."

## If a judge asks about hardware

Say:

> "The current demo uses a laptop-based sensor simulator so the real-time pipeline can be demonstrated reliably. The frontend and backend already expose the same WebSocket interface that an ESP32/Arduino bridge can use later."

## If a judge asks about AI

Say:

> "The inference service is isolated behind `/api/waste/detect`. It can use YOLO weights when available and falls back to OpenCV for a resilient demo. A production deployment would point that service to a waste-specific trained model."

## Reset before another run

In Authority mode, click **Reset Demo** in the top header.
