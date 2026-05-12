/**
 * 服饰介绍页面逻辑
 * 从 API 动态加载服装数据
 * 使用 pose detection 单手抬起触发进入答题
 */

let clothingList = [];
let currentClothing = null;
let handTracker;
let gestureDebounce = 0;

const ARM_RAISE_THRESHOLD = 0.02;  // 手腕高于肩膀的阈值
const ARM_RAISE_DEBOUNCE = 30;     // 防抖延迟

function init() {
    loadClothingList();
    initHandTracker();
    setupEventListeners();
}

async function loadClothingList() {
    try {
        const resp = await fetch('/api/clothing');
        if (!resp.ok) throw new Error('Failed to load clothing');
        clothingList = await resp.json();
        if (clothingList.length === 0) throw new Error('No clothing data');
        const savedId = sessionStorage.getItem('selectedClothingId');
        currentClothing = clothingList.find(c => c.id === savedId) || clothingList[0];
        renderClothingSelector();
        updateDisplay();
    } catch (e) {
        document.getElementById('clothing-title').textContent = '加载失败';
        console.error(e);
    }
}

function renderClothingSelector() {
    const selector = document.getElementById('clothing-selector');
    selector.innerHTML = '';
    clothingList.forEach(c => {
        const tab = document.createElement('div');
        tab.className = 'clothing-tab' + (c.id === currentClothing.id ? ' active' : '');
        tab.textContent = c.name;
        tab.addEventListener('click', () => selectClothing(c));
        selector.appendChild(tab);
    });
}

function selectClothing(c) {
    currentClothing = c;
    sessionStorage.setItem('selectedClothingId', c.id);
    document.querySelectorAll('.clothing-tab').forEach(tab => {
        tab.classList.toggle('active', tab.textContent === c.name);
    });
    updateDisplay();
}

function updateDisplay() {
    if (!currentClothing) return;
    document.getElementById('clothing-title').textContent = currentClothing.name;
    document.getElementById('clothing-dynasty').textContent = currentClothing.dynasty;
    document.getElementById('clothing-description').textContent = currentClothing.description || '';
    const features = currentClothing.features || [];
    const featureEls = ['feature-1', 'feature-2', 'feature-3', 'feature-4'];
    features.forEach((f, i) => {
        if (featureEls[i]) document.getElementById(featureEls[i]).textContent = f;
    });
}

function initHandTracker() {
    handTracker = new HandTracker();
    handTracker.onHandData = (data) => handlePoseData(data);
    handTracker.onStatusChange = (status) => {
        if (status === 'connected') {
            handTracker.initCamera().then(success => {
                if (success) {
                    document.getElementById('camera-video').srcObject = handTracker.getVideoElement().srcObject;
                    handTracker.startTracking();
                }
            });
        }
    };
    const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    handTracker.connect(`${wsProtocol}://${window.location.hostname}:8000/ws/pose`);
}

function handlePoseData(data) {
    // pose_data 包含: left_wrist_x/y, right_wrist_x/y, left_shoulder_y, right_shoulder_y
    const leftWristY = data.left_wrist_y;
    const rightWristY = data.right_wrist_y;
    const leftShoulderY = data.left_shoulder_y;
    const rightShoulderY = data.right_shoulder_y;

    if (leftWristY === null || rightWristY === null || leftShoulderY === null || rightShoulderY === null) {
        return;
    }

    if (gestureDebounce > 0) {
        gestureDebounce--;
        return;
    }

    // 检测单手抬起：左手或右手手腕高于对应肩膀
    const leftArmRaised = leftWristY < (leftShoulderY - ARM_RAISE_THRESHOLD);
    const rightArmRaised = rightWristY < (rightShoulderY - ARM_RAISE_THRESHOLD);

    // 单手抬起触发进入答题
    if (leftArmRaised || rightArmRaised) {
        gestureDebounce = ARM_RAISE_DEBOUNCE;
        showGestureIndicator('开始答题');
        setTimeout(() => {
            sessionStorage.setItem('selectedClothingId', currentClothing.id);
            const overlay = document.getElementById('transition-overlay');
            overlay.classList.add('active');
            setTimeout(() => { window.location.href = 'quiz.html'; }, 1500);
        }, 500);
    }
}

function showGestureIndicator(text) {
    const el = document.getElementById('gesture-indicator');
    el.textContent = text;
    el.classList.add('visible');
    setTimeout(() => el.classList.remove('visible'), 1000);
}

function setupEventListeners() {
    const btn = document.getElementById('start-quiz-btn');
    if (btn) btn.addEventListener('click', () => {
        sessionStorage.setItem('selectedClothingId', currentClothing.id);
        const overlay = document.getElementById('transition-overlay');
        overlay.classList.add('active');
        setTimeout(() => { window.location.href = 'quiz.html'; }, 1500);
    });
}

document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
