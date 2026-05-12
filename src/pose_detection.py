"""
人体姿态检测模块 - 使用 MediaPipe Pose (Tasks API)
"""

import cv2
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
from mediapipe.tasks.python.core.base_options import BaseOptions
import numpy as np
import os
import sys
from typing import Optional, Tuple, List, Dict
from dataclasses import dataclass


@dataclass
class Point:
    """2D/3D 点坐标"""
    x: float
    y: float
    z: float = 0.0
    visibility: float = 0.0


# 获取项目根目录 (src 的父目录)
def _get_project_root():
    # 获取 src 目录的父目录
    current_file = os.path.abspath(__file__)
    src_dir = os.path.dirname(current_file)
    project_root = os.path.dirname(src_dir)
    return project_root


PROJECT_ROOT = _get_project_root()
ORIGINAL_MODEL_PATH = os.path.join(PROJECT_ROOT, 'assets', 'model', 'pose_landmarker.task')

# Windows中文路径问题：复制模型到临时目录
import tempfile
import shutil as _shutil

MODEL_PATH = ORIGINAL_MODEL_PATH  # 默认值
if sys.platform == 'win32':
    # 检查原始路径是否有效
    if os.path.exists(ORIGINAL_MODEL_PATH):
        # 复制到临时目录以避免中文路径问题
        temp_dir = tempfile.gettempdir()
        temp_model_path = os.path.join(temp_dir, 'pose_landmarker.task')
        if not os.path.exists(temp_model_path):
            _shutil.copy2(ORIGINAL_MODEL_PATH, temp_model_path)
            print(f"Copied model to temp: {temp_model_path}")
        MODEL_PATH = temp_model_path


class PoseDetector:
    """MediaPipe Pose 姿态检测器 (使用Tasks API)"""

    def __init__(
        self,
        static_image_mode: bool = False,
        model_complexity: int = 1,
        smooth_landmarks: bool = True,
        enable_segmentation: bool = False,
        min_detection_confidence: float = 0.5,
        min_tracking_confidence: float = 0.5,
        use_gpu: bool = False
    ):
        """
        初始化姿态检测器

        Args:
            static_image_mode: 是否为静态图像模式
            model_complexity: 模型复杂度 (0, 1, 2)，越高越精确但越慢
            smooth_landmarks: 是否平滑 landmarks
            enable_segmentation: 是否启用人像分割
            min_detection_confidence: 最小检测置信度
            min_tracking_confidence: 最小跟踪置信度
            use_gpu: 是否使用 GPU 加速 (Linux NVIDIA)
        """
        # 配置模型
        if use_gpu and sys.platform != 'win32':
            base_options = python.BaseOptions(
                model_asset_path=MODEL_PATH,
                delegate=BaseOptions.Delegate.GPU
            )
        else:
            base_options = python.BaseOptions(model_asset_path=MODEL_PATH)
        options = vision.PoseLandmarkerOptions(
            base_options=base_options,
            running_mode=vision.RunningMode.VIDEO if not static_image_mode else vision.RunningMode.IMAGE,
            num_poses=1,
            min_pose_detection_confidence=min_detection_confidence,
            min_pose_presence_confidence=min_tracking_confidence,
            min_tracking_confidence=min_tracking_confidence if not static_image_mode else 0.5,
            output_segmentation_masks=enable_segmentation
        )

        self.detector = vision.PoseLandmarker.create_from_options(options)
        self._running_mode = vision.RunningMode.VIDEO

        # 存储上次检测到的关键点用于平滑
        self._prev_landmarks = None
        self._timestamp = 0

    def detect_pose(self, frame: np.ndarray) -> Tuple[bool, List[Dict]]:
        """
        检测画面中的人体姿态

        Args:
            frame: BGR 格式的图像帧

        Returns:
            (是否检测到人体, landmarks列表)
        """
        # 转换 BGR -> RGB
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)

        # 检测姿态
        if self._running_mode == vision.RunningMode.VIDEO:
            result = self.detector.detect_for_video(mp_image, self._timestamp)
            self._timestamp += 33  # 约30fps
        else:
            result = self.detector.detect(mp_image)

        if not result.pose_landmarks or len(result.pose_landmarks) == 0:
            return False, []

        # 提取 landmarks (第一个人的数据)
        landmarks = []
        for landmark in result.pose_landmarks[0]:
            landmarks.append({
                'x': landmark.x,
                'y': landmark.y,
                'z': landmark.z,
                'visibility': landmark.visibility if hasattr(landmark, 'visibility') else 1.0
            })

        return True, landmarks

    def get_landmark_position(self, landmarks: List[Dict], landmark_idx: int) -> Optional[Point]:
        """获取指定索引的 landmark 位置"""
        if landmark_idx < 0 or landmark_idx >= len(landmarks):
            return None
        lm = landmarks[landmark_idx]
        return Point(x=lm['x'], y=lm['y'], z=lm['z'], visibility=lm['visibility'])

    def calculate_angle(
        self,
        point1: Tuple[float, float],
        point2: Tuple[float, float],
        point3: Tuple[float, float]
    ) -> float:
        """
        计算三点形成的角度

        Args:
            point1, point2, point3: 三个点的 (x, y) 坐标
            point2 是角度的顶点

        Returns:
            角度值（度数）
        """
        # 向量从 point2 指向 point1 和 point3
        v1 = np.array([point1[0] - point2[0], point1[1] - point2[1]])
        v2 = np.array([point3[0] - point2[0], point3[1] - point2[1]])

        # 计算角度
        cos_angle = np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2) + 1e-6)
        cos_angle = np.clip(cos_angle, -1.0, 1.0)
        angle = np.arccos(cos_angle)

        return np.degrees(angle)

    def get_body_lean_angle(self, landmarks: List[Dict]) -> float:
        """
        获取身体左右倾斜角度

        Returns:
            正值表示右倾，负值表示左倾
        """
        # 使用肩膀和髋部的中心点来判断身体倾斜
        left_shoulder = self.get_landmark_position(landmarks, 11)
        right_shoulder = self.get_landmark_position(landmarks, 12)
        left_hip = self.get_landmark_position(landmarks, 23)
        right_hip = self.get_landmark_position(landmarks, 24)

        if not all([left_shoulder, right_shoulder, left_hip, right_hip]):
            return 0.0

        # 计算肩膀中心点和髋部中心点
        shoulder_center = Point(
            x=(left_shoulder.x + right_shoulder.x) / 2,
            y=(left_shoulder.y + right_shoulder.y) / 2
        )
        hip_center = Point(
            x=(left_hip.x + right_hip.x) / 2,
            y=(left_hip.y + right_hip.y) / 2
        )

        # 计算倾斜角度（基于 x 坐标差异）
        # 注意：图像中 x 增大表示向右
        dx = shoulder_center.x - hip_center.x
        dy = shoulder_center.y - hip_center.y

        # 转换为相对于垂直方向的角度
        angle = np.degrees(np.arctan2(dx, -dy))

        return angle

    def get_vertical_lean_angle(self, landmarks: List[Dict]) -> float:
        """
        获取身体前后倾斜角度

        Returns:
            正值表示前倾，负值表示后仰
        """
        left_shoulder = self.get_landmark_position(landmarks, 11)
        right_shoulder = self.get_landmark_position(landmarks, 12)
        left_hip = self.get_landmark_position(landmarks, 23)
        right_hip = self.get_landmark_position(landmarks, 24)

        if not all([left_shoulder, right_shoulder, left_hip, right_hip]):
            return 0.0

        # 肩膀和髋部中心点
        shoulder_center_y = (left_shoulder.y + right_shoulder.y) / 2
        hip_center_y = (left_hip.y + right_hip.y) / 2

        # 计算前后倾斜（y 值增大表示身体前倾，因为图像 y 轴向下）
        dy = shoulder_center_y - hip_center_y

        return dy * 100  # 放大系数

    def get_arm_angle(self, landmarks: List[Dict], side: str = 'left') -> float:
        """
        获取手臂抬起角度

        Args:
            side: 'left' 或 'right'

        Returns:
            手臂抬起角度（相对于水平面）
        """
        if side == 'left':
            shoulder = self.get_landmark_position(landmarks, 11)
            elbow = self.get_landmark_position(landmarks, 13)
            wrist = self.get_landmark_position(landmarks, 15)
        else:
            shoulder = self.get_landmark_position(landmarks, 12)
            elbow = self.get_landmark_position(landmarks, 14)
            wrist = self.get_landmark_position(landmarks, 16)

        if not all([shoulder, elbow, wrist]):
            return 0.0

        # 计算手臂角度（肩膀到手腕的向量与水平面的夹角）
        dx = wrist.x - shoulder.x
        dy = wrist.y - shoulder.y

        angle = np.degrees(np.arctan2(-dy, dx))  # -dy 因为图像 y 轴向下

        return max(0, angle)  # 只返回正值（抬起角度）

    def get_arm_angle_signed(self, landmarks: List[Dict], side: str = 'left') -> float:
        """
        获取手臂倾斜角度（带符号，仅用肘和腕）

        Args:
            side: 'left' 或 'right'

        Returns:
            手臂倾斜角度（带符号）
            左臂：正值=手肘连线向右倾斜，负值=向左倾斜
            右臂：负值=手肘连线向左倾斜，正值=向右倾斜
        """
        if side == 'left':
            elbow = self.get_landmark_position(landmarks, 13)
            wrist = self.get_landmark_position(landmarks, 15)
        else:
            elbow = self.get_landmark_position(landmarks, 14)
            wrist = self.get_landmark_position(landmarks, 16)

        if not all([elbow, wrist]):
            return 0.0

        # 仅用肘和腕计算倾角
        dx = wrist.x - elbow.x
        dy = wrist.y - elbow.y
        angle = np.degrees(np.arctan2(-dy, dx))

        return angle

    def get_arm_height_ratio(self, landmarks: List[Dict], side: str = 'left') -> float:
        """
        获取手腕相对于肩膀的高度比例

        Returns:
            正值表示手腕高于肩膀，负值表示低于
        """
        if side == 'left':
            shoulder = self.get_landmark_position(landmarks, 11)
            wrist = self.get_landmark_position(landmarks, 15)
        else:
            shoulder = self.get_landmark_position(landmarks, 12)
            wrist = self.get_landmark_position(landmarks, 16)

        if not all([shoulder, wrist]):
            return 0.0

        return (shoulder.y - wrist.y) * 100  # y 越小越高

    def get_pose_data(self, frame: np.ndarray) -> Dict:
        """
        获取完整的姿态数据，用于游戏控制

        Returns:
            包含所有关键姿态信息的字典
        """
        detected, landmarks = self.detect_pose(frame)

        if not detected:
            return {
                'detected': False,
                'lean_angle': 0.0,
                'vertical_lean': 0.0,
                'left_arm_angle': 0.0,
                'right_arm_angle': 0.0,
                'left_arm_height': 0.0,
                'right_arm_height': 0.0
            }

        return {
            'detected': True,
            'lean_angle': self.get_body_lean_angle(landmarks),
            'vertical_lean': self.get_vertical_lean_angle(landmarks),
            'left_arm_angle': self.get_arm_angle(landmarks, 'left'),
            'right_arm_angle': self.get_arm_angle(landmarks, 'right'),
            'left_arm_tilt': self.get_arm_angle_signed(landmarks, 'left'),
            'right_arm_tilt': self.get_arm_angle_signed(landmarks, 'right'),
            'left_arm_height': self.get_arm_height_ratio(landmarks, 'left'),
            'right_arm_height': self.get_arm_height_ratio(landmarks, 'right'),
            'landmarks': landmarks
        }

    def draw_pose(self, frame: np.ndarray, landmarks: List[Dict]) -> np.ndarray:
        """
        在画面上绘制姿态关键点

        Args:
            frame: 原始 BGR 帧
            landmarks: 姿态关键点列表

        Returns:
            绘制了关键点的图像
        """
        if not landmarks:
            return frame

        # 创建 MediaPipe Image
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)

        # 创建空白分割掩码
        h, w = frame.shape[:2]
        segmentation_masks = [None]

        # 绘制 landmarks (手动绘制以避免API问题)
        for i, landmark in enumerate(landmarks):
            x = int(landmark['x'] * w)
            y = int(landmark['y'] * h)
            cv2.circle(frame, (x, y), 5, (0, 255, 0), -1)

        # 绘制连接
        connections = [
            (11, 12), (11, 13), (13, 15), (12, 14), (14, 16),
            (11, 23), (12, 24), (23, 24), (23, 25), (25, 27),
            (24, 26), (26, 28)
        ]

        for start_idx, end_idx in connections:
            if start_idx < len(landmarks) and end_idx < len(landmarks):
                start = landmarks[start_idx]
                end = landmarks[end_idx]
                if start['visibility'] > 0.5 and end['visibility'] > 0.5:
                    x1, y1 = int(start['x'] * w), int(start['y'] * h)
                    x2, y2 = int(end['x'] * w), int(end['y'] * h)
                    cv2.line(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)

        return frame

    def release(self):
        """释放资源"""
        if self.detector:
            self.detector.close()
            self.detector = None


def test_camera():
    """测试摄像头和姿态检测"""
    detector = PoseDetector(model_complexity=1)

    cap = cv2.VideoCapture(0)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

    print("按 'q' 键退出测试...")

    while cap.isOpened():
        success, frame = cap.read()
        if not success:
            print("无法读取摄像头画面")
            break

        pose_data = detector.get_pose_data(frame)

        if pose_data['detected']:
            # 在画面上显示姿态数据
            info = f"Lean: {pose_data['lean_angle']:.1f}° | Arms: L{pose_data['left_arm_angle']:.0f}° R{pose_data['right_arm_angle']:.0f}°"
            cv2.putText(frame, info, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)

            # 绘制骨架
            frame = detector.draw_pose(frame, pose_data.get('landmarks', []))

        # 显示画面
        cv2.imshow('Pose Detection Test', frame)

        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

    cap.release()
    detector.release()
    cv2.destroyAllWindows()


if __name__ == '__main__':
    test_camera()
