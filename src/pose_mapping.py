"""
姿态到控制信号的映射模块
"""

from dataclasses import dataclass
from typing import Optional, Dict
import logging

logger = logging.getLogger(__name__)


@dataclass
class GameControls:
    """控制指令"""
    steering: float      # 倾斜：-1.0 (左) 到 1.0 (右)
    throttle: float      # 伸展：0.0 到 1.0
    brake: float         # 收缩：0.0 到 1.0
    hand_up: bool        # 双手举起标志

    def to_dict(self) -> Dict:
        return {
            'steering': self.steering,
            'throttle': self.throttle,
            'brake': self.brake,
            'hand_up': self.hand_up
        }


class PoseMapper:
    """姿态数据到控制信号的映射器"""

    def __init__(self, config: Optional[Dict] = None):
        """
        初始化映射器

        Args:
            config: 配置字典，包含各项阈值
        """
        self.config = config or self._default_config()

        # 校准数据
        self._calibration = {
            'lean_angle_offset': 0.0,   # 倾斜角度偏移
        }

        # 状态
        self._is_calibrated = False
        self._last_controls = GameControls(steering=0, throttle=0, brake=0, hand_up=False)

    def _default_config(self) -> Dict:
        """默认配置"""
        return {
            # 倾斜阈值
            'lean_threshold': 25.0,         # 开始倾斜响应的最小角度（度）
            'lean_max_angle': 50.0,          # 最大倾斜角度
            'lean_deadzone': 8.0,            # 倾斜死区

            # 手臂阈值
            'arm_up_threshold': 45.0,        # 手臂开始伸展的角度（度）
            'arm_max_angle': 100.0,           # 手臂完全伸展角度
            'arm_deadzone': 15.0,            # 手臂死区

            # 收缩阈值
            'brake_lean_threshold': -20.0,   # 前倾开始收缩的角度（度）
            'hand_brake_threshold': 20.0,    # 双手平举收缩角度

            # 平滑系数
            'steering_smoothing': 0.15,       # 倾斜平滑系数 (0-1，越小越平滑)
            'throttle_smoothing': 0.1,       # 伸展平滑系数
            'brake_smoothing': 0.15,          # 收缩平滑系数
        }

    def calibrate(self, calibration_data: Dict) -> None:
        """
        校准初始姿态

        Args:
            calibration_data: 包含初始姿态数据的字典
        """
        if not calibration_data.get('detected', False):
            logger.warning("校准失败：未检测到人体")
            return

        self._calibration['lean_angle_offset'] = calibration_data.get('lean_angle', 0.0)

        self._is_calibrated = True
        logger.info(f"校准完成：lean_offset={self._calibration['lean_angle_offset']:.2f}")

    def map_to_controls(self, pose_data: Dict) -> GameControls:
        """
        将姿态数据映射为控制指令

        Args:
            pose_data: pose_detection.get_pose_data() 返回的数据

        Returns:
            GameControls 控制指令
        """
        try:
            if not pose_data.get('detected', False):
                # 未检测到人体，保持当前状态
                return GameControls(steering=0, throttle=0, brake=0, hand_up=False)

            # 获取原始姿态数据，确保是有效数值
            lean_angle = float(pose_data.get('lean_angle', 0.0) or 0)
            vertical_lean = float(pose_data.get('vertical_lean', 0.0) or 0)
            left_arm_angle = float(pose_data.get('left_arm_angle', 0.0) or 0)
            right_arm_angle = float(pose_data.get('right_arm_angle', 0.0) or 0)
            left_arm_height = float(pose_data.get('left_arm_height', 0.0) or 0)
            right_arm_height = float(pose_data.get('right_arm_height', 0.0) or 0)

            # 处理 NaN 和无穷值
            lean_angle = 0 if (lean_angle != lean_angle or abs(lean_angle) == float('inf')) else lean_angle
            vertical_lean = 0 if (vertical_lean != vertical_lean or abs(vertical_lean) == float('inf')) else vertical_lean
            left_arm_angle = 0 if (left_arm_angle != left_arm_angle or abs(left_arm_angle) == float('inf')) else left_arm_angle
            right_arm_angle = 0 if (right_arm_angle != right_arm_angle or abs(right_arm_angle) == float('inf')) else right_arm_angle
            left_arm_height = 0 if (left_arm_height != left_arm_height or abs(left_arm_height) == float('inf')) else left_arm_height
            right_arm_height = 0 if (right_arm_height != right_arm_height or abs(right_arm_height) == float('inf')) else right_arm_height

            # 校准偏移
            lean_angle -= self._calibration['lean_angle_offset']

            # 计算倾斜 (-1 到 1)
            steering = self._calculate_steering(lean_angle)

            # 计算伸展 (0 到 1)
            throttle = self._calculate_throttle(left_arm_angle, right_arm_angle)

            # 计算收缩 (0 到 1)
            brake = self._calculate_brake(vertical_lean, left_arm_height, right_arm_height)

            # 检测双手举起
            hand_up = (left_arm_angle > self.config['arm_max_angle'] * 0.8 and
                       right_arm_angle > self.config['arm_max_angle'] * 0.8)

            # 平滑处理
            steering = self._smooth_value(steering, self._last_controls.steering,
                                           self.config['steering_smoothing'])
            throttle = self._smooth_value(throttle, self._last_controls.throttle,
                                           self.config['throttle_smoothing'])
            brake = self._smooth_value(brake, self._last_controls.brake,
                                       self.config['brake_smoothing'])

            controls = GameControls(
                steering=steering,
                throttle=throttle,
                brake=brake,
                hand_up=hand_up
            )

            self._last_controls = controls
            return controls

        except Exception as e:
            logger.error(f"姿态映射异常: {e}")
            return GameControls(steering=0, throttle=0, brake=0, hand_up=False)

    def _calculate_steering(self, lean_angle: float) -> float:
        """
        计算倾斜值 - 直接映射倾斜角度到运动方向

        Args:
            lean_angle: 身体倾斜角度（负值=左倾，正值=右倾）

        Returns:
            -1.0 (左) 到 1.0 (右)
        """
        threshold = self.config['lean_threshold']
        max_angle = self.config['lean_max_angle']
        deadzone = self.config['lean_deadzone']

        # 应用死区
        if abs(lean_angle) < deadzone:
            return 0.0

        rate = -1.5
        # 直接将倾斜角度映射到 -1 到 1 的范围
        # 使用平方根使曲线更平缓
        if lean_angle * rate > 0:
            # 右倾 -> 正值
            raw_steering = (lean_angle * rate - deadzone) / (max_angle - deadzone)
        else:
            # 左倾 -> 负值
            raw_steering = (lean_angle * rate + deadzone) / (max_angle - deadzone)

        # 应用平方使曲线更平缓
        if raw_steering > 0:
            raw_steering = raw_steering * raw_steering
        else:
            raw_steering = -raw_steering * raw_steering

        return max(-1.0, min(1.0, raw_steering))

    def _calculate_throttle(self, left_arm_angle: float, right_arm_angle: float) -> float:
        """
        计算伸展值

        Args:
            left_arm_angle: 左手臂伸展角度
            right_arm_angle: 右手臂伸展角度

        Returns:
            0.0 到 1.0
        """
        threshold = self.config['arm_up_threshold']
        max_angle = self.config['arm_max_angle']
        deadzone = self.config['arm_deadzone']

        # 取平均角度
        avg_angle = (left_arm_angle + right_arm_angle) / 2

        # 应用死区
        if avg_angle < threshold + deadzone:
            return 0.0

        # 计算伸展强度 - 使用平方使曲线更平缓
        throttle = (avg_angle - threshold) / (max_angle - threshold)
        throttle = throttle * throttle  # 平方降低灵敏度

        return max(0.0, min(1.0, throttle))

    def _calculate_brake(self, vertical_lean: float,
                        left_arm_height: float, right_arm_height: float) -> float:
        """
        计算收缩值

        Args:
            vertical_lean: 身体前后倾斜角度
            left_arm_height: 左手腕高度
            right_arm_height: 右手腕高度

        Returns:
            0.0 到 1.0
        """
        brake = 0.0

        # 前倾收缩
        if vertical_lean < self.config['brake_lean_threshold']:
            brake = min(1.0, abs(vertical_lean) / abs(self.config['brake_lean_threshold']))

        # 双手平举收缩
        avg_height = (left_arm_height + right_arm_height) / 2
        if abs(avg_height) < 10.0:  # 手臂接近肩部高度
            brake = max(brake, 0.5)

        return min(1.0, brake)

    def _smooth_value(self, current: float, previous: float, smoothing: float) -> float:
        """
        平滑值变化

        Args:
            current: 当前值
            previous: 上一次的值
            smoothing: 平滑系数 (0-1，越小越平滑)

        Returns:
            平滑后的值
        """
        return previous + smoothing * (current - previous)


if __name__ == '__main__':
    mapper = PoseMapper()
    test_cases = [
        {'detected': True, 'lean_angle': 30.0, 'vertical_lean': 0.0,
         'left_arm_angle': 0.0, 'right_arm_angle': 0.0,
         'left_arm_height': 0.0, 'right_arm_height': 0.0},
        {'detected': True, 'lean_angle': -25.0, 'vertical_lean': 5.0,
         'left_arm_angle': 70.0, 'right_arm_angle': 75.0,
         'left_arm_height': 40.0, 'right_arm_height': 45.0},
        {'detected': False},
    ]

    print("测试姿态映射...")
    for i, data in enumerate(test_cases):
        controls = mapper.map_to_controls(data)
        print(f"测试 {i+1}: {controls.to_dict()}")
