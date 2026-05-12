/**
 * 虚拟试穿页面逻辑
 * 最终修复版：只有【双手同时举】才拍照
 * 单手 → 只切服装，绝不拍照
 */

let currentClothing = null;
let clothImages = [];
let selectedImageIndex = 0;
let capturedImg = null;
let camStream = null;
let handTracker = null;
let countdownTimer = null;
let countdownValue = 0;
let currentState = 'idle';
let lastArmRaised = false;

// Three.js loading background
let loadingScene, loadingCamera, loadingRenderer;
let loadingGroup;
let loadingBgCanvas;
let loadingBgCtx;
let clothingTextures = [];
let textureIndex = 0;

const ARM_RAISE_THRESHOLD = 0.02;
const COUNTDOWN_SECONDS = 5;

let lastSwitchTime = 0;
const SWITCH_COOLDOWN = 800;

function init() {
    if (sessionStorage.getItem('quizPassed') !== 'true') {
        window.location.href = 'index.html';
        return;
    }
    const clothingId = sessionStorage.getItem('selectedClothingId');
    if (!clothingId) {
        window.location.href = 'index.html';
        return;
    }
    loadClothingData(clothingId);
    initCamera();
    initHandTracker();
    setupEvents();
}

async function loadClothingData(clothingId) {
    try {
        const [clothingResp, imagesResp] = await Promise.all([
            fetch(`/api/clothing/${clothingId}/questions`),
            fetch(`/api/clothing/${clothingId}/images`)
        ]);
        if (!clothingResp.ok || !imagesResp.ok) throw new Error('Failed to load');
        const clothingData = await clothingResp.json();
        clothImages = await imagesResp.json();
        currentClothing = clothingData;
        renderClothSelector();
        document.getElementById('clothing-name').textContent = clothingData.clothing_name;
        document.getElementById('clothing-dynasty').textContent = clothingData.dynasty;
    } catch (e) {
        console.error('Failed to load clothing data:', e);
    }
}

function renderClothSelector() {
    const selector = document.getElementById('cloth-selector');
    selector.innerHTML = '';
    if (clothImages.length === 0) {
        selector.innerHTML = '<div style="color: var(--color-text-muted);">暂无可用样板图</div>';
        return;
    }
    clothImages.forEach((imgUrl, i) => {
        const div = document.createElement('div');
        div.className = 'cloth-item' + (i === selectedImageIndex ? ' selected' : '');
        div.innerHTML = `<img src="${imgUrl}" alt="样板${i + 1}">`;
        div.addEventListener('click', () => selectClothImage(i));
        selector.appendChild(div);
    });
}

function selectClothImage(index) {
    selectedImageIndex = index;
    document.querySelectorAll('.cloth-item').forEach((el, i) => {
        el.classList.toggle('selected', i === index);
    });
}

async function initCamera() {
    try {
        camStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' } });
        document.getElementById('camera-video').srcObject = camStream;
        document.getElementById('camera-status').textContent = '举双手拍照 | 单手切服装';
    } catch (e) {
        document.getElementById('camera-status').textContent = '摄像头启动失败';
    }
}

function initHandTracker() {
    handTracker = new HandTracker();
    handTracker.onHandData = (data) => { handlePoseData(data); };
    handTracker.onStatusChange = (status) => {
        if (status === 'connected') {
            handTracker.initCamera().then(success => {
                if (success) handTracker.startTracking();
            });
        }
    };
    const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    handTracker.connect(`${wsProtocol}://${window.location.hostname}:8000/ws/pose`);
}

function setupEvents() {
    document.getElementById('regenerate-btn').addEventListener('click', () => capturedImg && generate());
    document.getElementById('file-input').addEventListener('change', handleFileUpload);
}

function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.getElementById('capture-canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            capturedImg = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
            generate();
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
}

function handlePoseData(data) {
    if (currentState !== 'idle') {
        lastArmRaised = false;
        return;
    }

    const leftY = data.left_wrist_y;
    const rightY = data.right_wrist_y;
    const leftShoulderY = data.left_shoulder_y;
    const rightShoulderY = data.right_shoulder_y;

    const leftUp = leftY != null && leftShoulderY != null && leftY < leftShoulderY - ARM_RAISE_THRESHOLD;
    const rightUp = rightY != null && rightShoulderY != null && rightY < rightShoulderY - ARM_RAISE_THRESHOLD;
    const bothUp = leftUp && rightUp;

    const now = Date.now();

    // 左手 = 上一套
    if (leftUp && !rightUp && now - lastSwitchTime > SWITCH_COOLDOWN) {
        lastSwitchTime = now;
        selectedImageIndex = (selectedImageIndex - 1 + clothImages.length) % clothImages.length;
        selectClothImage(selectedImageIndex);
        document.getElementById('camera-status').textContent = "上一套";
    }

    // 右手 = 下一套
    else if (rightUp && !leftUp && now - lastSwitchTime > SWITCH_COOLDOWN) {
        lastSwitchTime = now;
        selectedImageIndex = (selectedImageIndex + 1) % clothImages.length;
        selectClothImage(selectedImageIndex);
        document.getElementById('camera-status').textContent = "下一套";
    }

    // ==============================================
    // 🔥 强制锁定：只有【双手都举】才拍照
    // ==============================================
    if (bothUp && !lastArmRaised) {
        startCountdown();
    }

    lastArmRaised = bothUp;

    // 只在 非倒计时 时显示 --
    // 状态转为中文
    let stateText = '';
    switch(currentState) {
        case 'idle': stateText = '待机'; break;
        case 'counting': stateText = '倒计时中'; break;
        case 'capturing': stateText = '拍照中'; break;
        case 'generating': stateText = '生成中'; break;
        default: stateText = '处理中';
    }

    document.getElementById('dbg-countdown').textContent = currentState === 'counting' ? countdownValue : '--';
    document.getElementById('dbg-state').textContent = stateText;
}

function startCountdown() {
    currentState = 'counting';
    countdownValue = COUNTDOWN_SECONDS;
    const overlay = document.getElementById('countdown-overlay');
    const numberEl = document.getElementById('countdown-number');
    document.getElementById('gesture-hint').classList.remove('visible');
    overlay.style.display = 'flex';
    numberEl.textContent = countdownValue;

    countdownTimer = setInterval(() => {
        countdownValue--;
        numberEl.textContent = countdownValue;
        // 🔥 在这里直接更新 debug 面板！
        document.getElementById('dbg-countdown').textContent = countdownValue;

        if (countdownValue <= 0) {
            clearInterval(countdownTimer);
            captureAndGenerate();
        }
    }, 1000);
}

function captureAndGenerate() {
    currentState = 'capturing';
document.getElementById('dbg-state').textContent = '拍照中';
    document.getElementById('countdown-overlay').style.display = 'none';

    const video = document.getElementById('camera-video');
    const canvas = document.getElementById('capture-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    ctx.save();
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    ctx.restore();

    capturedImg = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
    generate();
}

async function generate() {
    currentState = 'generating';

    document.getElementById('dbg-state').textContent = '生成中';
    const loading = document.getElementById('loading-indicator');
    const placeholder = document.getElementById('result-placeholder');
    const resultImg = document.getElementById('result-image');
    const regenBtn = document.getElementById('regenerate-btn');
    const loadingText = document.getElementById('loading-text');
    const loadingTimer = document.getElementById('loading-timer');
    const loadingStep = document.getElementById('loading-step');

    loading.style.display = 'flex';
    placeholder.style.display = 'none';
    resultImg.style.display = 'none';
    regenBtn.disabled = true;

    // 启动3D背景动画
    // 等待DOM渲染完成后再初始化
    requestAnimationFrame(() => {
        initLoadingBackground();
        animateLoadingBackground();
    });

    // 动态进度文案和倒计时
    const TOTAL_SECONDS = 45;
    let remainingSeconds = TOTAL_SECONDS;
    let progressIndex = 0;

    const progressSteps = [
        { maxTime: 10, text: '妙手裁云 · 分析穿搭细节', timer: '预计剩余 {s} 秒' },
        { maxTime: 20, text: '锦衣织梦 · 匹配服装风格', timer: '预计剩余 {s} 秒' },
        { maxTime: 35, text: '霓裳羽衣 · 生成效果图中', timer: '预计剩余 {s} 秒' },
        { maxTime: 45, text: '华服天成 · 精细化渲染', timer: '即将完成...' }
    ];

    loadingText.textContent = '正在生成...';
    loadingStep.textContent = progressSteps[0].text;
    loadingTimer.textContent = `预计剩余 ${remainingSeconds} 秒`;

    const progressTimer = setInterval(() => {
        remainingSeconds--;
        if (remainingSeconds <= 0) {
            loadingTimer.textContent = '即将完成...';
        } else {
            loadingTimer.textContent = `预计剩余 ${remainingSeconds} 秒`;
        }

        // 更新进度阶段
        for (let i = progressSteps.length - 1; i >= 0; i--) {
            if (remainingSeconds <= progressSteps[i].maxTime) {
                if (progressIndex !== i) {
                    progressIndex = i;
                    loadingStep.textContent = progressSteps[i].text;
                }
                break;
            }
        }
    }, 1000);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);

    try {
        const clothingIdMap = {
            zhou_male: 1,
            zhou_female: 2,
            tang_male: 3,
            tang_female: 4,
            song_male: 5,
            song_female: 6,
            ming_male: 7,
            ming_female: 8
        };
        const clothingId = clothingIdMap[currentClothing?.clothing_id] || 1;

        const resp = await fetch('/api/seedream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_image: capturedImg,
                clothing_id: clothingId,
                cloth_image_index: selectedImageIndex
            }),
            signal: controller.signal
        });

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.detail || 'API failed');
        }

        const data = await resp.json();
        if (!data.success) throw new Error(data.error || 'Generation failed');

        resultImg.src = data.image;
        resultImg.style.display = 'block';
    } catch (e) {
        placeholder.innerHTML = `<div style="color: #e74c3c;">生成失败<br><small style="color: #aaa;">${e.name === 'AbortError' ? '超时' : e.message}</small></div>`;
        placeholder.style.display = 'flex';
    } finally {
        clearTimeout(timeoutId);
        clearInterval(progressTimer);
        stopLoadingBackground();
        loading.style.display = 'none';
        regenBtn.disabled = false;
        currentState = 'idle';
        document.getElementById('dbg-state').textContent = '待机';
        lastArmRaised = false;
        if (!capturedImg) placeholder.style.display = 'flex';
    }
}

// ==========================================
// 加载背景3D动画 - 全景橱窗风格
// ==========================================

function initLoadingBackground() {
    const canvas = document.getElementById('loading-bg-canvas');
    if (!canvas) {
        console.error('loading-bg-canvas not found');
        return;
    }

    const container = document.getElementById('loading-indicator');
    if (!container) {
        console.error('loading-indicator not found');
        return;
    }

    const resultContainer = document.getElementById('tryon-result');
    if (!resultContainer) {
        console.error('tryon-result not found');
        return;
    }

    // Get dimensions from result-container (the visible area)
    const w = resultContainer.offsetWidth || 600;
    const h = resultContainer.offsetHeight || 400;

    canvas.width = w;
    canvas.height = h;

    // Create scene
    loadingScene = new THREE.Scene();

    // Create camera - looking at center
    loadingCamera = new THREE.PerspectiveCamera(60, w / h, 0.1, 1000);

    // Create renderer
    loadingRenderer = new THREE.WebGLRenderer({
        canvas: canvas,
        alpha: true,
        antialias: true
    });
    loadingRenderer.setSize(w, h);
    loadingRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Create sphere geometry for panorama (inside-out for panorama view)
    const geometry = new THREE.SphereGeometry(100, 64, 64);
    geometry.scale(-1, 1, 1); // Flip inside out

    // Create material with golden gradient texture
    const defaultTex = createDefaultTexture();
    const material = new THREE.MeshBasicMaterial({
        map: defaultTex,
        side: THREE.FrontSide
    });

    const mesh = new THREE.Mesh(geometry, material);
    loadingScene.add(mesh);

    textureIndex = 0;
    currentRotation = 0;
}

function createDefaultTexture() {
    // Create a canvas-based texture
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    // Dark background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, 1024, 512);

    // Add some visual interest - concentric rings like a radar/sonar
    const centerX = 512;
    const centerY = 256;

    for (let r = 50; r < 400; r += 30) {
        const alpha = 0.15 - (r / 4000);
        ctx.strokeStyle = `rgba(212, 168, 75, ${Math.max(0.02, alpha)})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(centerX, centerY, r, 0, Math.PI * 2);
        ctx.stroke();
    }

    // Center glow
    const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, 200);
    gradient.addColorStop(0, 'rgba(212, 168, 75, 0.2)');
    gradient.addColorStop(1, 'transparent');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1024, 512);

    // Golden border lines
    ctx.strokeStyle = 'rgba(212, 168, 75, 0.3)';
    ctx.lineWidth = 2;

    // Horizontal line
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(1024, centerY);
    ctx.stroke();

    // Vertical line
    ctx.beginPath();
    ctx.moveTo(centerX, 0);
    ctx.lineTo(centerX, 512);
    ctx.stroke();

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    return texture;
}

let loadingAnimationId = null;
let currentRotation = 0;

function animateLoadingBackground() {
    if (!loadingRenderer || !loadingScene || !loadingCamera) {
        console.error('Renderer or scene not initialized');
        return;
    }

    loadingAnimationId = requestAnimationFrame(animateLoadingBackground);

    // Slow continuous rotation
    currentRotation += 0.003;
    loadingScene.rotation.y = currentRotation;

    loadingRenderer.render(loadingScene, loadingCamera);
}

function stopLoadingBackground() {
    if (loadingAnimationId) {
        cancelAnimationFrame(loadingAnimationId);
        loadingAnimationId = null;
    }
    if (loadingRenderer) {
        loadingRenderer.dispose();
        loadingRenderer = null;
    }
    if (loadingScene) {
        loadingScene.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (child.material.map) child.material.map.dispose();
                child.material.dispose();
            }
        });
        loadingScene = null;
    }
    loadingGroup = null;
    clothingTextures = [];
    currentRotation = 0;
}

document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();