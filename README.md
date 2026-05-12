# 华服雅韵 - Traditional Chinese Clothing VR Experience

> 基于手势与姿态控制的沉浸式中国传统服饰体验系统

## 项目简介

华服雅韵是一个创新的Web应用，结合计算机视觉与人工智能技术，让用户通过身体手势和姿态来探索中国传统服饰汉服的文化内涵与穿戴体验。

**交互方式**：全程无需键盘鼠标，通过摄像头捕捉用户姿态进行自然交互。

## 页面与流程

| 页面 | 文件 | 功能 |
|------|------|------|
| 入口页 | `index.html` | 品牌展示、动画效果，点击进入全景橱窗 |
| 全景橱窗 | `showcase.html` | Three.js 3D全景旋转展示，手势左右滑动切换服装 |
| 服饰介绍 | `intro.html` | 服装详情介绍，手势向上滑动或按钮触发答题 |
| 答题环节 | `quiz.html` | 手臂举起切换选项，双手举起确认选择 |
| 虚拟试穿 | `tryon.html` | 左手/右手切换服装，双手举起触发拍照+AI生成 |

## 功能特性

- **手势滑动切换** - 单手左右滑动切换展示的服装
- **双手确认选择** - 双手向外展开触发确认
- **双手选择选项** - 左手选上一项、右手选下一项
- **防误触检测** - 手高于一定位置才会触发姿态检测
- **AI虚拟试穿** - SeeDream 5.0 生成试穿效果
- **3D全景展示** - Three.js 实现沉浸式服装浏览

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Vanilla JS + Three.js (3D渲染) |
| 通信 | WebSocket 实时传输 |
| 姿态检测 | MediaPipe Pose (33点人体关键点检测) |
| 后端框架 | FastAPI + Uvicorn |
| AI服务 | 火山引擎 ARK SeeDream-5.0 |
| 图像处理 | OpenCV |

## 目录结构

```
VRDesign-V3/
├── index.html          # 入口页面
├── intro.html          # 服饰介绍页
├── quiz.html           # 答题测试页
├── tryon.html          # 虚拟试穿页
├── showcase.html       # 全景橱窗3D展示
├── src/
│   ├── server.py           # 服务器入口
│   ├── pose_detection.py   # MediaPipe姿态检测
│   ├── pose_mapping.py     # 姿态→控制映射
│   └── seedream_service.py # AI试穿服务
├── static/
│   ├── css/
│   │   └── traditional.css  # 中国风样式系统
│   └── js/
│       ├── hand_tracker.js   # 摄像头与WebSocket通信
│       ├── showcase.js       # 全景橱窗3D逻辑
│       ├── intro.js          # 服饰介绍逻辑
│       ├── quiz.js           # 答题逻辑
│       └── tryon.js          # 虚拟试穿逻辑
├── data/
│   ├── zhou_male/female/    # 周制汉服
│   ├── tang_male/female/     # 唐制汉服
│   ├── song_male/female/     # 宋制汉服
│   └── ming_male/female/     # 明制汉服
├── requirements.txt
└── .env
```

## 快速开始

### 1. 安装依赖

```bash
pip install -r requirements.txt
```

### 2. 配置环境变量

创建 `.env` 文件：

```bash
ARK_API_KEY=your_api_key_here
```

### 3. 启动服务器

```bash
# HTTP 模式（开发用）
python -m src.server
# 或
uvicorn src.server:app --host 127.0.0.1 --port 8000

# HTTPS 模式（生产环境推荐）
uvicorn src.server:app --host 0.0.0.0 --port 8000 \
    --ssl-keyfile key.pem --ssl-certfile cert.pem
```

### 4. 访问应用

```bash
# HTTP
http://127.0.0.1:8000/

# HTTPS（推荐）
https://127.0.0.1:8000/
```

> 注意：首次访问 HTTPS 时，浏览器会提示证书不受信任，需手动允许。

## API 端点

| 端点 | 方法 | 功能 |
|------|------|------|
| `/health` | GET | 服务健康检查 |
| `/api/clothing` | GET | 获取所有服装列表 |
| `/api/clothing/{id}/questions` | GET | 获取指定服装的题目 |
| `/api/clothing/{id}/images` | GET | 获取服装样板图URL列表 |
| `/api/seedream` | POST | AI虚拟试穿生成 |
| `/ws/pose` | WebSocket | 实时姿态数据处理 |

## 手势交互对照表

### 全景橱窗 (showcase.html)
| 手势 | 动作 |
|------|------|
| 单手左右滑动 | 旋转切换服装 |
| 双手向外展开 | 确认选择 |

### 服饰介绍 (intro.html)
| 手势 | 动作 |
|------|------|
| 单手向上滑动 | 触发跳转答题 |
| 点击按钮 | 进入答题 |

### 答题环节 (quiz.html)
| 手势 | 动作 |
|------|------|
| 左手举起 | 切换上一选项 |
| 右手举起 | 切换下一选项 |
| 双手举起 | 确认选择 |

### 虚拟试穿 (tryon.html)
| 手势 | 动作 |
|------|------|
| 左手举起 | 切换上一套服装 |
| 右手举起 | 切换下一套服装 |
| 双手举起 | 触发拍照 |

## 服装数据结构

```
data/{朝代}_{性别}/
├── cloth/              # 服装样板图
│   ├── 1.webp
│   └── ...
└── questions.json      # 题目数据
```

questions.json 示例：
```json
{
  "clothing_id": "ming_male",
  "clothing_name": "明制汉服(男)",
  "dynasty": "明朝",
  "features": ["立领右衽", "宽口收袖", "浓沉雅正", "礼宴大节"],
  "questions": [...]
}
```

## 环境要求

- Python 3.9+
- OpenCV 4.8+
- MediaPipe 0.10+
- 摄像头权限
- 火山引擎 ARK API Key
