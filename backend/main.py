"""
GreenSync live-demo backend
Run:
    uvicorn main:app --reload --host 0.0.0.0 --port 8000

This backend intentionally keeps state in memory for hackathon/demo speed.
It can be replaced with SQLite/PostgreSQL later without changing the API shape.
"""

from __future__ import annotations

import asyncio
import base64
import io
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware


APP_TITLE = "GreenSync Smart Waste & Sanitation API"
YOLO_WEIGHTS = Path(os.getenv("YOLO_WEIGHTS", "yolov8n.pt"))
USE_YOLO = os.getenv("USE_YOLO", "1").lower() in {"1", "true", "yes"}

app = FastAPI(title=APP_TITLE, version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Local hackathon demo. Restrict this in production.
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def friendly_time(iso_time: str) -> str:
    try:
        dt = datetime.fromisoformat(iso_time.replace("Z", "+00:00"))
        mins = max(0, int((datetime.now(timezone.utc) - dt).total_seconds() // 60))
        if mins == 0:
            return "just now"
        if mins == 1:
            return "1 min ago"
        if mins < 60:
            return f"{mins} mins ago"
        hours = mins // 60
        return f"{hours} hour{'s' if hours != 1 else ''} ago"
    except Exception:
        return "unknown"


# ---------------------------------------------------------------------------
# In-memory demo state
# ---------------------------------------------------------------------------

BINS: dict[str, dict[str, Any]] = {
    "B-101": {"id": "B-101", "location": "Central Market", "type": "Mixed", "fillLevel": 92, "status": "Critical", "lastUpdated": "10 mins ago", "lat": 20, "lng": 30},
    "B-102": {"id": "B-102", "location": "Central Market", "type": "Recyclable", "fillLevel": 45, "status": "Normal", "lastUpdated": "15 mins ago", "lat": 22, "lng": 35},
    "B-201": {"id": "B-201", "location": "Bus Stand", "type": "Mixed", "fillLevel": 85, "status": "Critical", "lastUpdated": "5 mins ago", "lat": 70, "lng": 20},
    "B-202": {"id": "B-202", "location": "Bus Stand", "type": "Wet", "fillLevel": 60, "status": "Attention", "lastUpdated": "20 mins ago", "lat": 75, "lng": 25},
    "B-301": {"id": "B-301", "location": "Railway Station", "type": "Mixed", "fillLevel": 98, "status": "Critical", "lastUpdated": "2 mins ago", "lat": 80, "lng": 80},
    "B-401": {"id": "B-401", "location": "College Road", "type": "Recyclable", "fillLevel": 30, "status": "Normal", "lastUpdated": "1 hour ago", "lat": 40, "lng": 70},
    "B-501": {"id": "B-501", "location": "Food Street", "type": "Wet", "fillLevel": 75, "status": "Attention", "lastUpdated": "30 mins ago", "lat": 50, "lng": 50},
    "B-502": {"id": "B-502", "location": "Food Street", "type": "Dry", "fillLevel": 40, "status": "Normal", "lastUpdated": "45 mins ago", "lat": 55, "lng": 55},
    "B-601": {"id": "B-601", "location": "Municipal Park", "type": "Mixed", "fillLevel": 10, "status": "Normal", "lastUpdated": "2 hours ago", "lat": 10, "lng": 80},
    "B-701": {"id": "B-701", "location": "Main Road", "type": "Dry", "fillLevel": 65, "status": "Attention", "lastUpdated": "25 mins ago", "lat": 60, "lng": 40},
}

_seed_now = now_iso()
ISSUES: dict[str, dict[str, Any]] = {
    "GS-1001": {"id": "GS-1001", "location": "Central Market", "type": "Overflowing Bin", "description": "", "severity": "High", "status": "Pending", "reportedAt": _seed_now, "score": 84, "locationType": "Market", "fillLevel": 90, "reportCount": 2},
    "GS-1002": {"id": "GS-1002", "location": "Bus Stand", "type": "Garbage Dump", "description": "", "severity": "Critical", "status": "Assigned", "reportedAt": _seed_now, "score": 89, "assignedTo": "Team Alpha", "locationType": "Road", "fillLevel": 85, "reportCount": 3},
    "GS-1003": {"id": "GS-1003", "location": "Food Street", "type": "Mixed Waste", "description": "", "severity": "High", "status": "In Progress", "reportedAt": _seed_now, "score": 73, "assignedTo": "Team Beta", "locationType": "Market", "fillLevel": 70, "reportCount": 2},
    "GS-1004": {"id": "GS-1004", "location": "Railway Station", "type": "Unclean Public Area", "description": "", "severity": "Critical", "status": "Pending", "reportedAt": _seed_now, "score": 94, "locationType": "Road", "fillLevel": 98, "reportCount": 4},
}

event_clients: set[WebSocket] = set()
bin_clients: set[WebSocket] = set()

SEVERITY_WEIGHTS = {
    "Critical": 100,
    "High": 80,
    "Medium": 60,
    "Low": 30,
}

LOCATION_WEIGHTS = {
    "Hospital": 100,
    "School": 90,
    "Market": 85,
    "Residential": 70,
    "Road": 60,
    "Park": 50,
    "Public": 65,
}

# Optional YOLO model. It is loaded once and only when the weights are present.
# If no weights file is available, the service uses OpenCV heuristics instead.
_yolo_model = None


def get_yolo_model():
    global _yolo_model
    if _yolo_model is not None:
        return _yolo_model
    if not USE_YOLO or not YOLO_WEIGHTS.exists():
        return None
    try:
        from ultralytics import YOLO  # Optional dependency at runtime
        _yolo_model = YOLO(str(YOLO_WEIGHTS))
        return _yolo_model
    except Exception:
        return None


async def broadcast_json(clients: set[WebSocket], payload: dict[str, Any]) -> None:
    if not clients:
        return

    dead: list[WebSocket] = []
    message = __import__("json").dumps(payload)

    for client in list(clients):
        try:
            await client.send_text(message)
        except Exception:
            dead.append(client)

    for client in dead:
        clients.discard(client)


# ---------------------------------------------------------------------------
# Waste AI
# ---------------------------------------------------------------------------

YOLO_WASTE_CLASSES = {
    "bottle": ("Plastic Water Bottle", "Recyclable", 0.0, "Dry Waste / Recycling Bin", "Can be recycled and diverted from general landfill."),
    "cup": ("Plastic Cup", "Recyclable", 0.0, "Dry Waste / Recycling Bin", "Can be recycled where local facilities accept this plastic type."),
    "can": ("Metal Can", "Metal / Recyclable", 0.0, "Dry Waste / Recycling Bin", "Metal can be recovered and recycled."),
    "banana": ("Food Waste", "Organic / Wet", 0.0, "Wet Waste / Compost Bin", "Suitable for composting or organic-waste processing."),
    "apple": ("Food Waste", "Organic / Wet", 0.0, "Wet Waste / Compost Bin", "Suitable for composting or organic-waste processing."),
    "orange": ("Food Waste", "Organic / Wet", 0.0, "Wet Waste / Compost Bin", "Suitable for composting or organic-waste processing."),
}


def classify_with_yolo(image_bgr: np.ndarray) -> dict[str, Any] | None:
    model = get_yolo_model()
    if model is None:
        return None

    try:
        result = model.predict(source=image_bgr, verbose=False, conf=0.25)[0]
        if result.boxes is None or len(result.boxes) == 0:
            return None

        idx = int(result.boxes.conf.argmax().item())
        cls_id = int(result.boxes.cls[idx].item())
        label = str(result.names[cls_id]).lower()
        confidence = float(result.boxes.conf[idx].item())

        if label in YOLO_WASTE_CLASSES:
            obj, cat, _, bin_name, impact = YOLO_WASTE_CLASSES[label]
            return {
                "detected_object": obj,
                "category": cat,
                "confidence": round(confidence, 3),
                "recommended_bin": bin_name,
                "impact": impact,
                "engine": "YOLOv8"
            }

        # A generic COCO class can still be surfaced to the UI.
        return {
            "detected_object": label.title(),
            "category": "Needs Manual Segregation",
            "confidence": round(confidence, 3),
            "recommended_bin": "Mixed / Check Local Rules",
            "impact": "The AI detected an object but does not have a safe waste-bin mapping for this class.",
            "engine": "YOLOv8"
        }
    except Exception:
        return None


def classify_with_opencv(image_bgr: np.ndarray) -> dict[str, Any]:
    """
    Fast no-model fallback. This is intentionally a heuristic, not a replacement
    for a trained waste dataset model.
    """
    h, w = image_bgr.shape[:2]
    if h == 0 or w == 0:
        raise ValueError("Invalid image dimensions")

    # Shape/edge features
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 60, 140)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    large_contours = [c for c in contours if cv2.contourArea(c) > (h * w * 0.02)]

    # HSV color occupancy
    hsv = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2HSV)
    green_mask = cv2.inRange(hsv, np.array([35, 35, 30]), np.array([95, 255, 255]))
    green_ratio = float(np.count_nonzero(green_mask)) / float(h * w)

    brightness = float(np.mean(gray))
    saturation = float(np.mean(hsv[:, :, 1]))

    # Filename hints are not available here, so the fallback relies on image features.
    # Lower confidence reflects the heuristic nature.
    if green_ratio > 0.20:
        return {
            "detected_object": "Organic / Plant-like Waste",
            "category": "Organic / Wet",
            "confidence": 0.72,
            "recommended_bin": "Wet Waste / Compost Bin",
            "impact": "Organic waste can be composted and kept out of general landfill.",
            "engine": "OpenCV fallback"
        }

    if len(large_contours) >= 3 and saturation < 85 and brightness < 170:
        return {
            "detected_object": "Metal-like Container",
            "category": "Metal / Recyclable",
            "confidence": 0.68,
            "recommended_bin": "Dry Waste / Recycling Bin",
            "impact": "Metal can be recovered and recycled.",
            "engine": "OpenCV fallback"
        }

    if len(large_contours) >= 2:
        return {
            "detected_object": "Plastic-like Container",
            "category": "Recyclable",
            "confidence": 0.70,
            "recommended_bin": "Dry Waste / Recycling Bin",
            "impact": "Recoverable plastic can be diverted from general landfill.",
            "engine": "OpenCV fallback"
        }

    return {
        "detected_object": "Unclassified Waste Item",
        "category": "Needs Manual Segregation",
        "confidence": 0.55,
        "recommended_bin": "Mixed Waste Bin",
        "impact": "Use the local segregation guide for safe disposal.",
        "engine": "OpenCV fallback"
    }


@app.get("/")
async def root():
    return {"name": APP_TITLE, "status": "online"}


@app.post("/api/demo/reset")
async def demo_reset():
    global BINS, ISSUES
    BINS = {
        "B-101": {"id": "B-101", "location": "Central Market", "type": "Mixed", "fillLevel": 92, "status": "Critical", "lastUpdated": "10 mins ago", "lat": 20, "lng": 30},
        "B-102": {"id": "B-102", "location": "Central Market", "type": "Recyclable", "fillLevel": 45, "status": "Normal", "lastUpdated": "15 mins ago", "lat": 22, "lng": 35},
        "B-201": {"id": "B-201", "location": "Bus Stand", "type": "Mixed", "fillLevel": 85, "status": "Critical", "lastUpdated": "5 mins ago", "lat": 70, "lng": 20},
        "B-202": {"id": "B-202", "location": "Bus Stand", "type": "Wet", "fillLevel": 60, "status": "Attention", "lastUpdated": "20 mins ago", "lat": 75, "lng": 25},
        "B-301": {"id": "B-301", "location": "Railway Station", "type": "Mixed", "fillLevel": 98, "status": "Critical", "lastUpdated": "2 mins ago", "lat": 80, "lng": 80},
        "B-401": {"id": "B-401", "location": "College Road", "type": "Recyclable", "fillLevel": 30, "status": "Normal", "lastUpdated": "1 hour ago", "lat": 40, "lng": 70},
        "B-501": {"id": "B-501", "location": "Food Street", "type": "Wet", "fillLevel": 75, "status": "Attention", "lastUpdated": "30 mins ago", "lat": 50, "lng": 50},
        "B-502": {"id": "B-502", "location": "Food Street", "type": "Dry", "fillLevel": 40, "status": "Normal", "lastUpdated": "45 mins ago", "lat": 55, "lng": 55},
        "B-601": {"id": "B-601", "location": "Municipal Park", "type": "Mixed", "fillLevel": 10, "status": "Normal", "lastUpdated": "2 hours ago", "lat": 10, "lng": 80},
        "B-701": {"id": "B-701", "location": "Main Road", "type": "Dry", "fillLevel": 65, "status": "Attention", "lastUpdated": "25 mins ago", "lat": 60, "lng": 40},
    }
    _reset_now = now_iso()
    ISSUES = {
        "GS-1001": {"id": "GS-1001", "location": "Central Market", "type": "Overflowing Bin", "description": "", "severity": "High", "status": "Pending", "reportedAt": _reset_now, "score": 84, "locationType": "Market", "fillLevel": 90, "reportCount": 2},
        "GS-1002": {"id": "GS-1002", "location": "Bus Stand", "type": "Garbage Dump", "description": "", "severity": "Critical", "status": "Assigned", "reportedAt": _reset_now, "score": 89, "assignedTo": "Team Alpha", "locationType": "Road", "fillLevel": 85, "reportCount": 3},
        "GS-1003": {"id": "GS-1003", "location": "Food Street", "type": "Mixed Waste", "description": "", "severity": "High", "status": "In Progress", "reportedAt": _reset_now, "score": 73, "assignedTo": "Team Beta", "locationType": "Market", "fillLevel": 70, "reportCount": 2},
        "GS-1004": {"id": "GS-1004", "location": "Railway Station", "type": "Unclean Public Area", "description": "", "severity": "Critical", "status": "Pending", "reportedAt": _reset_now, "score": 94, "locationType": "Road", "fillLevel": 98, "reportCount": 4},
    }
    await broadcast_json(event_clients, {"type": "demo.reset"})
    return {"ok": True, "bins": list(BINS.values()), "issues": list(ISSUES.values())}


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "timestamp": now_iso(),
        "yolo_weights_available": YOLO_WEIGHTS.exists(),
        "websocket_events_clients": len(event_clients),
        "websocket_bin_clients": len(bin_clients),
    }


@app.post("/api/waste/detect")
async def detect_waste(file: UploadFile = File(...)):
    if file.content_type not in {"image/jpeg", "image/png", "image/webp", "image/jpg"}:
        raise HTTPException(status_code=400, detail="Please upload JPEG, PNG, or WebP image.")

    raw = await file.read()
    if len(raw) > 8 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Image is too large. Max size is 8 MB.")

    image = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(status_code=400, detail="Could not decode the uploaded image.")

    yolo_result = await asyncio.to_thread(classify_with_yolo, image)
    result = yolo_result or await asyncio.to_thread(classify_with_opencv, image)
    return result


# ---------------------------------------------------------------------------
# Priority engine
# ---------------------------------------------------------------------------

def calculate_priority(
    fill_level: float,
    severity: str,
    location_type: str,
    time_elapsed_mins: float,
    report_count: int,
) -> dict[str, Any]:
    fill = float(max(0, min(100, fill_level)))
    severity_weight = SEVERITY_WEIGHTS.get(str(severity).title(), 50)
    location_weight = LOCATION_WEIGHTS.get(str(location_type).title(), 65)
    time_weight = max(0.0, min(100.0, float(time_elapsed_mins) / 120.0 * 100))
    report_frequency = max(0.0, min(100.0, float(report_count) * 20.0))

    score = (
        (fill * 0.30)
        + (severity_weight * 0.25)
        + (location_weight * 0.20)
        + (time_weight * 0.15)
        + (report_frequency * 0.10)
    )
    score = round(max(0, min(100, score)))

    if score >= 80:
        priority_status = "Critical"
    elif score >= 60:
        priority_status = "High"
    elif score >= 40:
        priority_status = "Medium"
    else:
        priority_status = "Low"

    return {
        "score": score,
        "priority_status": priority_status,
        "severity": priority_status,
        "components": {
            "fill_level": round(fill, 1),
            "severity_weight": severity_weight,
            "location_weight": location_weight,
            "time_weight": round(time_weight, 1),
            "report_frequency": round(report_frequency, 1),
        }
    }


@app.post("/api/priority/calculate")
async def priority_calculate(payload: dict[str, Any]):
    required = ["fill_level", "severity", "location_type", "time_elapsed_mins", "report_count"]
    missing = [key for key in required if key not in payload]
    if missing:
        raise HTTPException(status_code=422, detail=f"Missing fields: {', '.join(missing)}")

    try:
        return calculate_priority(
            payload["fill_level"],
            payload["severity"],
            payload["location_type"],
            payload["time_elapsed_mins"],
            payload["report_count"],
        )
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="Priority values must be numeric where applicable.")


# ---------------------------------------------------------------------------
# Citizen reports + task lifecycle
# ---------------------------------------------------------------------------

def next_issue_id() -> str:
    numeric_ids = []
    for key in ISSUES:
        match = re.search(r"(\d+)$", key)
        if match:
            numeric_ids.append(int(match.group(1)))
    return f"GS-{max(numeric_ids, default=1000) + 1}"


@app.get("/api/sanitation/issues")
async def list_issues():
    return sorted(ISSUES.values(), key=lambda x: x.get("reportedAt", ""), reverse=True)


@app.post("/api/sanitation/report")
async def create_report(payload: dict[str, Any]):
    location = str(payload.get("location", "")).strip()
    issue_type = str(payload.get("type", "Unspecified Issue")).strip()

    if not location:
        raise HTTPException(status_code=422, detail="Location is required.")

    severity = str(payload.get("severity", "Medium"))
    score = payload.get("score")
    if score is None:
        priority = calculate_priority(
            payload.get("fillLevel", 75),
            severity,
            payload.get("locationType", "Public"),
            payload.get("timeElapsedMins", 5),
            payload.get("reportCount", 1),
        )
        score = priority["score"]
        severity = priority["priority_status"]

    issue_id = next_issue_id()
    issue = {
        "id": issue_id,
        "location": location,
        "type": issue_type,
        "description": str(payload.get("description", "")),
        "severity": severity,
        "status": "Pending",
        "reportedAt": now_iso(),
        "score": int(score),
        "locationType": payload.get("locationType", "Public"),
        "fillLevel": float(payload.get("fillLevel", 75)),
        "reportCount": int(payload.get("reportCount", 1)),
    }

    ISSUES[issue_id] = issue
    await broadcast_json(event_clients, {"type": "issue.created", "issue": issue})
    return issue


@app.patch("/api/tasks/{task_id}")
async def update_task(task_id: str, payload: dict[str, Any]):
    issue = ISSUES.get(task_id)
    if issue is None:
        raise HTTPException(status_code=404, detail="Task/report not found.")

    allowed_statuses = {"Pending", "Assigned", "In Progress", "Resolved"}
    if "status" in payload:
        status = str(payload["status"])
        if status not in allowed_statuses:
            raise HTTPException(status_code=422, detail=f"Invalid status. Use one of: {sorted(allowed_statuses)}")
        issue["status"] = status

        if status == "Resolved":
            issue["resolvedAt"] = now_iso()
        elif "resolvedAt" in issue:
            issue.pop("resolvedAt", None)

    if payload.get("assignedTo"):
        issue["assignedTo"] = str(payload["assignedTo"])

    ISSUES[task_id] = issue
    await broadcast_json(event_clients, {"type": "task.updated", "task": issue})
    return issue


# ---------------------------------------------------------------------------
# Smart bin telemetry
# ---------------------------------------------------------------------------

def normalize_fill_level(value: Any) -> float:
    level = float(value)
    return round(max(0.0, min(100.0, level)), 1)


def upsert_bin(bin_id: str, fill_level: float, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    level = normalize_fill_level(fill_level)
    status = "Critical" if level > 80 else "Attention" if level > 50 else "Normal"

    if bin_id in BINS:
        BINS[bin_id]["fillLevel"] = level
        BINS[bin_id]["status"] = status
        BINS[bin_id]["lastUpdated"] = "just now"
        if extra:
            BINS[bin_id].update(extra)
    else:
        BINS[bin_id] = {
            "id": bin_id,
            "location": extra.get("location", "Unknown location") if extra else "Unknown location",
            "type": extra.get("type", "Mixed") if extra else "Mixed",
            "fillLevel": level,
            "status": status,
            "lastUpdated": "just now",
            "lat": extra.get("lat", 50) if extra else 50,
            "lng": extra.get("lng", 50) if extra else 50,
        }

    return BINS[bin_id]


@app.get("/api/bins")
async def list_bins():
    return list(BINS.values())


@app.post("/api/bins/{bin_id}/telemetry")
async def http_bin_telemetry(bin_id: str, payload: dict[str, Any]):
    if "fill_level" not in payload and "fillLevel" not in payload:
        raise HTTPException(status_code=422, detail="fill_level is required.")

    level = payload.get("fill_level", payload.get("fillLevel"))
    bin_data = upsert_bin(bin_id, level)
    await broadcast_json(bin_clients, {"type": "bin.telemetry", "bin": bin_data})
    await broadcast_json(event_clients, {"type": "bin.telemetry", "bin": bin_data})
    return bin_data


async def handle_bin_socket(socket: WebSocket):
    await socket.accept()
    bin_clients.add(socket)

    try:
        await socket.send_json({
            "type": "bin.connection",
            "message": "Connected to GreenSync bin telemetry stream.",
            "timestamp": now_iso(),
        })

        while True:
            message = await socket.receive_json()

            # Telemetry accepted from Arduino/ESP32 bridge or a browser simulator.
            if message.get("type") in {None, "telemetry", "bin.telemetry"} and (
                "fill_level" in message or "fillLevel" in message
            ):
                bin_id = str(message.get("bin_id", message.get("id", "B-101")))
                level = message.get("fill_level", message.get("fillLevel"))
                extra = {
                    key: message[key]
                    for key in ("location", "type", "lat", "lng")
                    if key in message
                }
                bin_data = upsert_bin(bin_id, level, extra)
                payload = {"type": "bin.telemetry", "bin": bin_data}
                await broadcast_json(bin_clients, payload)
                await broadcast_json(event_clients, payload)
            else:
                await socket.send_json({
                    "type": "error",
                    "message": "Send telemetry like {'bin_id':'B-101','fill_level':72}"
                })
    except WebSocketDisconnect:
        pass
    finally:
        bin_clients.discard(socket)


@app.websocket("/ws/bins")
async def websocket_bins(websocket: WebSocket):
    await handle_bin_socket(websocket)


# ---------------------------------------------------------------------------
# General event stream: citizen reports + worker task status
# ---------------------------------------------------------------------------

@app.websocket("/ws/events")
async def websocket_events(websocket: WebSocket):
    await websocket.accept()
    event_clients.add(websocket)

    try:
        await websocket.send_json({
            "type": "events.connection",
            "message": "Connected to GreenSync event stream.",
            "timestamp": now_iso(),
        })

        while True:
            # Keep the connection open. Clients do not need to send anything.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        event_clients.discard(websocket)
