# GreenSync Live-Ready Hackathon Package

This package converts the original GreenSync React prototype into a local live-demo system.

## 1. Project structure

```text
greensync-live-ready/
├── backend/
│   ├── main.py
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── package.json
│   ├── src/
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── index.css
│   │   └── vite-env.d.ts
│   ├── index.html
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── tsconfig.json
│   └── .env.example
├── iot/
│   ├── iot_sensor_bridge.py
│   └── .env.example
└── README.md
```

## 2. Backend — Windows PowerShell

Open PowerShell inside `backend`:

```powershell
python -m venv venv
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Do NOT use plain `uvicorn` until it is installed in the active venv. `python -m uvicorn ...` makes sure the active Python environment is used.

Test:

- http://localhost:8000/api/health
- http://localhost:8000/docs

## 3. Frontend

Open a second PowerShell in `frontend`:

```powershell
npm install
npm run dev
```

Then open the Vite URL shown in the terminal, normally:

- http://localhost:5173

The frontend defaults to `http://localhost:8000`. To change it, create `.env` from `.env.example` and set `VITE_API_BASE_URL`.

## 4. What is live

### AI waste detection
Upload an image or enable the browser webcam. Frames are sent to `POST /api/waste/detect`. FastAPI uses YOLOv8 when a weights file is present, otherwise a fast OpenCV fallback returns a clearly labelled lower-confidence result.

### Citizen reports
The report form calls the priority API and then `POST /api/sanitation/report`. The backend broadcasts the created issue to connected authority/worker dashboards through `ws://localhost:8000/ws/events`.

### Worker task loop
Assignment/status actions call `PATCH /api/tasks/{task_id}`. The task update is broadcast through `/ws/events`, and the Authority KPIs recalculate from the shared state.

### Smart bins
React listens to `ws://localhost:8000/ws/bins`. The HTTP endpoint `POST /api/bins/{bin_id}/telemetry` is also available for testing without hardware.

## 5. Test a bin without Arduino

Keep the React Smart Bins page open and use the FastAPI docs:

1. Open http://localhost:8000/docs
2. Expand `POST /api/bins/{bin_id}/telemetry`
3. Set `bin_id` to `B-101`
4. Send:

```json
{
  "fill_level": 35
}
```

The Smart Bin UI should change without a page refresh.

## 6. IoT bridge

Install:

```powershell
python -m pip install pyserial websocket-client
```

Set the correct COM port in `iot_sensor_bridge.py` and run:

```powershell
python iot_sensor_bridge.py
```

The Arduino/ESP32 can send serial messages like:

```text
B-101,72
```

The bridge forwards them to `/ws/bins`.

## 7. YOLO model note

`ultralytics` is installed by the backend requirements, but a general `yolov8n.pt` weights file is separate from the Python package. If it is not present, GreenSync intentionally falls back to OpenCV so the demo does not crash. For a real waste-classification demo, use a model trained on waste categories and point `YOLO_WEIGHTS` to that model.

## 8. Recommended demo flow

1. Open GreenSync in Citizen mode and submit an overflowing-bin report.
2. Open the Authority portal and show the new issue appearing without refresh.
3. Assign the issue to a worker.
4. Switch to Worker mode, start the task, then mark it resolved.
5. Show the Authority KPI changing.
6. Open Smart Bins and change a bin's fill level through the API docs, or use the physical IoT bridge.
7. Open AI Waste Check and use the webcam or upload a waste image.

This keeps the demo focused on one end-to-end operational loop rather than disconnected screens.

## 9. Easiest Windows start

Backend: double-click `backend\start_backend.bat`. This avoids the PowerShell execution-policy activation problem entirely because it calls the venv's Python executable directly.

Frontend: double-click `frontend\start_frontend.bat` after Node.js/npm is installed.

## 10. Simulate the bin stream before using hardware

With the backend running, open a second terminal in `iot` and run:

```powershell
python simulate_bin.py
```

Watch the Smart Bins page. B-101 should move through Normal, Attention, and Critical fill levels without a browser refresh.

## One-command Windows setup

For Windows, open PowerShell in this `GreenSync-Live-Ready` folder and run:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\RUN_GREENSYNC.ps1
```

The script checks Python, installs Node.js LTS with `winget` when Node/npm are missing, creates the backend virtual environment, installs backend packages, installs frontend packages, and opens the FastAPI and Vite servers in separate PowerShell windows.

Optional YOLO model download:

```powershell
.\RUN_GREENSYNC.ps1 -DownloadYOLO
```

To verify the backend after it starts:

```powershell
.\VERIFY_GREENSYNC.ps1
```


## Final polish included

- Vite is configured to ignore the Python `venv`/PyTorch files that previously caused the Windows file-watcher crash.
- The authority header shows live WebSocket/API connection state.
- The Authority portal has a `Reset Demo` button so the full presentation flow can be replayed quickly.
- Smart Bins clearly show streaming telemetry and the included simulator can replace Arduino for the demo.
- AI results display whether the response came from YOLOv8, OpenCV fallback, or a demo preset.
- Analytics and Intelligence screens are labelled as demo/prototype data so the presentation does not overclaim live analytics.

## Recommended 5-minute presentation flow

1. Start backend and frontend.
2. Open Authority Command Center and keep it visible.
3. Citizen Portal → submit an overflowing-bin report.
4. Return to Authority → Action Center → assign worker.
5. Worker Portal → Start Task → Mark Resolved.
6. Return to Authority → show KPI changes.
7. Open Smart Bins and run `iot\simulate_bin.py`; point out the fill percentage changing live.
8. Open AI Waste Check → Upload Image or Use Live Webcam.
9. Use `Reset Demo` before another full run.

For the hackathon presentation, describe the IoT part as a **sensor simulator** because no physical Arduino is connected in this version. The same `/ws/bins` interface can later accept an ESP32/Arduino bridge.

## One-click-ish laptop demo

Because this demo does not use Arduino hardware, the easiest flow is:

- Start the backend and frontend with `RUN_GREENSYNC.ps1`.
- Open the website at `http://localhost:5173`.
- From `iot`, run `start_simulator.bat` to continuously stream B-101 telemetry.
- Use the Authority header's `Reset Demo` button before repeating the presentation.

See `DEMO_CHEATSHEET.md` for the exact presentation sequence and judge answers.
