"""
FastAPI VR传统服饰体验服务器
"""

import asyncio
import base64
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from typing import Optional

from dotenv import load_dotenv
load_dotenv()

import cv2
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from .pose_detection import PoseDetector
from .pose_mapping import PoseMapper
from .seedream_service import SeeDreamService

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(PROJECT_ROOT, "data")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

pose_detector: Optional[PoseDetector] = None
pose_mapper: Optional[PoseMapper] = None
seedream_service: Optional[SeeDreamService] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global pose_detector, pose_mapper, seedream_service
    pose_detector = PoseDetector(static_image_mode=False, model_complexity=1, smooth_landmarks=True, use_gpu=True)
    pose_mapper = PoseMapper()
    try:
        seedream_service = SeeDreamService()
    except ValueError:
        seedream_service = None
    logger.info("Initialized")
    yield
    if pose_detector: pose_detector.release()
    logger.info("Shutdown complete")


app = FastAPI(title="华服雅韵", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.mount("/static", StaticFiles(directory="static"), name="static")
app.mount("/assets", StaticFiles(directory="assets"), name="assets")
app.mount("/data", StaticFiles(directory=DATA_DIR), name="data")


@app.get("/")
async def root():
    return FileResponse("index.html")


@app.get("/health")
async def health():
    return {"status": "healthy", "pose": pose_detector is not None}


@app.get("/{page}")
async def serve_page(page: str):
    valid_pages = ["intro.html", "quiz.html", "tryon.html", "showcase.html"]
    if page in valid_pages:
        return FileResponse(page)
    raise HTTPException(status_code=404, detail="Not Found")


@app.post("/api/seedream")
async def seedream_api(request: dict):
    if not seedream_service:
        raise HTTPException(status_code=503, detail="Service unavailable")
    user_image = request.get("user_image")
    clothing_id = request.get("clothing_id", 1)
    cloth_image_index = request.get("cloth_image_index", 0)
    names = {
        1: "zhou_male",
        2: "zhou_female",
        3: "tang_male",
        4: "tang_female",
        5: "song_male",
        6: "song_female",
        7: "ming_male",
        8: "ming_female"
    }
    cloth_id = names.get(clothing_id, "zhou_male")

    # 根据索引加载服装样板图
    cloth_dir = os.path.join(DATA_DIR, cloth_id, "cloth")
    cloth_image_b64 = None
    if os.path.exists(cloth_dir):
        image_files = sorted([f for f in os.listdir(cloth_dir) if f.lower().endswith(('.jpg', '.jpeg', '.png', '.webp'))])
        if image_files and cloth_image_index < len(image_files):
            cloth_path = os.path.join(cloth_dir, image_files[cloth_image_index])
            with open(cloth_path, "rb") as f:
                cloth_image_b64 = base64.b64encode(f.read()).decode("utf-8")
        elif image_files:
            # 如果索引超出范围，使用第一张
            cloth_path = os.path.join(cloth_dir, image_files[0])
            with open(cloth_path, "rb") as f:
                cloth_image_b64 = base64.b64encode(f.read()).decode("utf-8")

    if not cloth_image_b64:
        raise HTTPException(status_code=400, detail="Cloth image not found")

    result = seedream_service.generate_tryon(user_image, cloth_image_b64)
    if result.success:
        return {"success": True, "image": result.image}
    raise HTTPException(status_code=500, detail=result.error)


@app.get("/api/clothing")
async def get_clothing_list():
    """返回所有服装类型列表"""
    clothing_list = []
    if not os.path.exists(DATA_DIR):
        return clothing_list
    for idx, clothing_id in enumerate(sorted(os.listdir(DATA_DIR))):
        clothing_path = os.path.join(DATA_DIR, clothing_id)
        if not os.path.isdir(clothing_path):
            continue
        questions_path = os.path.join(clothing_path, "questions.json")
        if os.path.exists(questions_path):
            with open(questions_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                clothing_list.append({
                    "id": data.get("clothing_id"),
                    "name": data.get("clothing_name"),
                    "name_en": data.get("clothing_name_en"),
                    "dynasty": data.get("dynasty"),
                    "prompt": data.get("prompt"),
                    "description": data.get("description", ""),
                    "features": data.get("features", []),
                    "color_index": idx % 15
                })
    return clothing_list


@app.get("/api/clothing/{clothing_id}/questions")
async def get_questions(clothing_id: str):
    """返回指定服装的题目"""
    questions_path = os.path.join(DATA_DIR, clothing_id, "questions.json")
    if not os.path.exists(questions_path):
        raise HTTPException(status_code=404, detail="Questions not found")
    with open(questions_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data


@app.get("/api/clothing/{clothing_id}/images")
async def get_cloth_images(clothing_id: str):
    """返回服装样板图URL列表"""
    cloth_dir = os.path.join(DATA_DIR, clothing_id, "cloth")
    if not os.path.exists(cloth_dir):
        return []
    images = []
    for filename in sorted(os.listdir(cloth_dir)):
        if filename.lower().endswith(('.jpg', '.jpeg', '.png', '.webp')):
            images.append(f"/data/{clothing_id}/cloth/{filename}")
    return images


@app.websocket("/ws/pose")
async def ws_pose(websocket: WebSocket):
    await websocket.accept()
    logger.info("WS connected")
    frame_count = 0
    last_time = time.time()
    fps = 0
    frame_idx = 0

    try:
        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_text(), timeout=5.0)
            except asyncio.TimeoutError:
                continue

            msg = json.loads(data)
            msg_type = msg.get("type")

            if msg_type == "frame":
                frame_idx += 1

                frame = cv2.imdecode(np.frombuffer(base64.b64decode(msg.get("data", "")), np.uint8), cv2.IMREAD_COLOR)
                if frame is None:
                    logger.warning("Failed to decode frame")
                    continue

                frame_count += 1
                if time.time() - last_time >= 2:
                    fps = frame_count // 2
                    frame_count = 0
                    last_time = time.time()

                pose_data = pose_detector.get_pose_data(frame) if pose_detector else {"detected": False}
                ctrl = pose_mapper.map_to_controls(pose_data).to_dict() if pose_mapper else {"steering": 0, "throttle": 0}

                # 从 pose landmarks 提取手腕和肩膀位置供前端手势检测使用
                # MediaPipe Pose: wrist_left=15, wrist_right=16, shoulder_left=11, shoulder_right=12
                landmarks = pose_data.get("landmarks", []) if pose_data.get("detected") else []
                left_wrist_x = landmarks[15]["x"] if len(landmarks) > 15 else None
                left_wrist_y = landmarks[15]["y"] if len(landmarks) > 15 else None
                right_wrist_x = landmarks[16]["x"] if len(landmarks) > 16 else None
                right_wrist_y = landmarks[16]["y"] if len(landmarks) > 16 else None
                left_shoulder_x = landmarks[11]["x"] if len(landmarks) > 11 else None
                left_shoulder_y = landmarks[11]["y"] if len(landmarks) > 11 else None
                right_shoulder_x = landmarks[12]["x"] if len(landmarks) > 12 else None
                right_shoulder_y = landmarks[12]["y"] if len(landmarks) > 12 else None

                await websocket.send_json({"type": "pose_data", "data": {
                    **ctrl, "fps": fps, "pose": pose_data,
                    "left_wrist_x": left_wrist_x, "right_wrist_x": right_wrist_x,
                    "left_wrist_y": left_wrist_y, "right_wrist_y": right_wrist_y,
                    "left_shoulder_x": left_shoulder_x, "left_shoulder_y": left_shoulder_y,
                    "right_shoulder_x": right_shoulder_x, "right_shoulder_y": right_shoulder_y
                }})

            elif msg_type == "ping":
                await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        logger.info("WS disconnected")
    except Exception as e:
        logger.error(f"WS error: {e}")


if __name__ == "__main__":
    import uvicorn
    ssl_certfile = "cert.pem" if os.path.exists("cert.pem") else None
    ssl_keyfile = "key.pem" if os.path.exists("key.pem") else None
    uvicorn.run(app, host="0.0.0.0", port=8000, ssl_certfile=ssl_certfile, ssl_keyfile=ssl_keyfile)