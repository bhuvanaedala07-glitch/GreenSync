"""Optional helper: download a small general YOLOv8 model.

Run from backend after installing ultralytics:
    python download_yolo_model.py

Note: yolov8n.pt is a general object detector, not a waste-specific model.
For a proper waste classifier, replace it with your waste-trained weights.
"""
from ultralytics import YOLO

print("Downloading/loading yolov8n.pt...")
YOLO("yolov8n.pt")
print("Done. yolov8n.pt should now be available to main.py.")
