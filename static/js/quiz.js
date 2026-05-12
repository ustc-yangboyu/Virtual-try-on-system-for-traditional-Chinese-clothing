/**
 * 答题页面逻辑 - 选择题版本
 * 手势：左手切换上一个 / 右手切换下一个 / 双手确认
 */

let currentClothingId = null;
let questionsData = null;
let currentQuestionIndex = 0;
let correctAnswers = 0;
let currentOptionIndex = 0;
let isProcessing = false;
let poseTracker = null;
let skeletonCtx = null;
let skeletonCanvas = null;
let confirmStartTime = null;
let confirmFired = false;
let lastSingleGesture = null;
let gestureStableFrames = 0;
let hasTriggeredThisGesture = false;
const GESTURE_STABLE_REQUIRED = 3;

const ARM_RAISE_THRESHOLD = 45;
const GESTURE_DEBOUNCE = 20;
const CONFIRM_HOLD_TIME = 200;

let gestureDebounce = 0;

const POSE_CONNECTIONS = [
    [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
    [11, 23], [12, 24], [23, 24]
];

function init() {
    currentClothingId = sessionStorage.getItem('selectedClothingId');
    if (!currentClothingId) {
        window.location.href = 'index.html';
        return;
    }
    loadQuestions();
}

async function loadQuestions() {
    try {
        const resp = await fetch(`/api/clothing/${currentClothingId}/questions`);
        if (!resp.ok) throw new Error('Failed to load questions');
        questionsData = await resp.json();
        createProgressDots();
        loadQuestion();
        initPoseTracker();
        startDebounceTimer();
        initSkeletonCanvas();
    } catch (e) {
        document.getElementById('question-text').textContent = '加载题目失败';
        console.error(e);
    }
}

function initSkeletonCanvas() {
    skeletonCanvas = document.getElementById('skeleton-canvas');
    if (skeletonCanvas) {
        skeletonCtx = skeletonCanvas.getContext('2d');
        const video = document.getElementById('camera-video');
        if (video) {
            skeletonCanvas.width = video.videoWidth || 640;
            skeletonCanvas.height = video.videoHeight || 480;
        }
    }
}

function drawSkeleton(landmarks) {
    if (!skeletonCtx || !skeletonCanvas || !landmarks || landmarks.length === 0) {
        if (skeletonCtx && skeletonCanvas) {
            skeletonCtx.clearRect(0, 0, skeletonCanvas.width, skeletonCanvas.height);
        }
        return;
    }
    skeletonCtx.clearRect(0, 0, skeletonCanvas.width, skeletonCanvas.height);
    const w = skeletonCanvas.width;
    const h = skeletonCanvas.height;
    skeletonCtx.strokeStyle = '#00FF00';
    skeletonCtx.lineWidth = 2;
    for (const [i, j] of POSE_CONNECTIONS) {
        if (i < landmarks.length && j < landmarks.length) {
            const p1 = landmarks[i];
            const p2 = landmarks[j];
            skeletonCtx.beginPath();
            skeletonCtx.moveTo(p1.x * w, p1.y * h);
            skeletonCtx.lineTo(p2.x * w, p2.y * h);
            skeletonCtx.stroke();
        }
    }
    skeletonCtx.fillStyle = '#FF0000';
    const keyPoints = [11, 12, 13, 14, 15, 16];
    for (const i of keyPoints) {
        if (i < landmarks.length) {
            const p = landmarks[i];
            skeletonCtx.beginPath();
            skeletonCtx.arc(p.x * w, p.y * h, 5, 0, Math.PI * 2);
            skeletonCtx.fill();
        }
    }
}

function startDebounceTimer() {
    setInterval(() => {
        if (gestureDebounce > 0) gestureDebounce--;
    }, 33);
}

function createProgressDots() {
    const progressEl = document.getElementById('quiz-progress');
    progressEl.innerHTML = '';
    if (!questionsData || !questionsData.questions) return;
    questionsData.questions.forEach((_, i) => {
        const dot = document.createElement('div');
        dot.className = 'quiz-dot';
        dot.id = `quiz-dot-${i}`;
        progressEl.appendChild(dot);
    });
    updateActiveDot();
}

function updateActiveDot() {
    document.querySelectorAll('.quiz-dot').forEach((dot, i) => {
        dot.classList.remove('active', 'correct', 'wrong');
        if (i === currentQuestionIndex) dot.classList.add('active');
        else if (i < currentQuestionIndex) dot.classList.add('correct');
    });
}

function loadQuestion() {
    if (!questionsData || !questionsData.questions) return;
    if (currentQuestionIndex >= questionsData.questions.length) {
        showResult();
        return;
    }
    const q = questionsData.questions[currentQuestionIndex];
    document.getElementById('question-text').textContent = q.question;
    renderOptions(q.options);
    currentOptionIndex = 0;
    confirmFired = false;
    lastSingleGesture = null;
    gestureStableFrames = 0;
    hasTriggeredThisGesture = false;
    updateOptionHighlight();
    updateActiveDot();
}

function renderOptions(options) {
    const container = document.getElementById('options-container');
    container.innerHTML = '';
    const letters = ['A', 'B', 'C', 'D'];
    options.forEach((opt, i) => {
        const div = document.createElement('div');
        div.className = 'option-item';
        div.id = `option-${i}`;
        div.innerHTML = `<span class="option-letter">${letters[i]}</span><span>${opt}</span>`;
        div.addEventListener('click', () => confirmAnswer(i));
        container.appendChild(div);
    });
}

function updateOptionHighlight() {
    const letters = ['A', 'B', 'C', 'D'];
    document.querySelectorAll('.option-item').forEach((el, i) => {
        el.classList.toggle('selected', i === currentOptionIndex);
    });
    document.getElementById('current-option').textContent = letters[currentOptionIndex];
}

function initPoseTracker() {
    poseTracker = new HandTracker();
    poseTracker.onHandData = (data) => handlePoseData(data);
    poseTracker.onStatusChange = (status) => {
        if (status === 'connected') {
            poseTracker.initCamera().then(success => {
                if (success) {
                    document.getElementById('camera-video').srcObject = poseTracker.getVideoElement().srcObject;
                    poseTracker.startTracking();
                }
            });
        }
    };
    const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    poseTracker.connect(`${wsProtocol}://${window.location.hostname}:8000/ws/pose`);
}

function handlePoseData(data) {
    const poseData = data.pose || {};
    if (!poseData || !poseData.detected) {
        drawSkeleton(null);
        return;
    }
    drawSkeleton(poseData.landmarks);
    if (isProcessing || gestureDebounce > 0) return;

    const now = Date.now();
    const leftArmAngle = poseData.left_arm_angle || 0;
    const rightArmAngle = poseData.right_arm_angle || 0;
    const leftRaised = leftArmAngle > ARM_RAISE_THRESHOLD;
    const rightRaised = rightArmAngle > ARM_RAISE_THRESHOLD;
    const bothRaised = leftRaised && rightRaised;

    document.getElementById('left-arm-angle').textContent = leftArmAngle.toFixed(1) + '°';
    document.getElementById('right-arm-angle').textContent = rightArmAngle.toFixed(1) + '°';
    document.getElementById('left-arm-angle').className = 'gesture-status-value ' + (leftRaised ? 'correct' : 'unknown');
    document.getElementById('right-arm-angle').className = 'gesture-status-value ' + (rightRaised ? 'correct' : 'unknown');

    document.getElementById('hint-left').classList.toggle('active', leftRaised && !rightRaised);
    document.getElementById('hint-right').classList.toggle('active', rightRaised && !leftRaised);
    document.getElementById('hint-both').classList.toggle('active', bothRaised);

    if (bothRaised) {
        if (!confirmStartTime) {
            confirmStartTime = now;
            confirmFired = false;
            document.getElementById('confirm-indicator').classList.add('visible');
        } else if (!confirmFired && now - confirmStartTime >= CONFIRM_HOLD_TIME) {
            confirmAnswer(currentOptionIndex);
            confirmFired = true;
        }
    } else {
        confirmStartTime = null;
        confirmFired = false;
        document.getElementById('confirm-indicator').classList.remove('visible');

        const currentGesture = leftRaised && !rightRaised ? 'left' : rightRaised && !leftRaised ? 'right' : null;

        if (currentGesture) {
            if (currentGesture === lastSingleGesture) {
                gestureStableFrames++;
            } else {
                gestureStableFrames = 1;
                lastSingleGesture = currentGesture;
            }
            if (gestureStableFrames >= GESTURE_STABLE_REQUIRED && gestureDebounce === 0 && !hasTriggeredThisGesture) {
                if (currentGesture === 'left') {
                    currentOptionIndex = (currentOptionIndex - 1 + 4) % 4;
                    updateOptionHighlight();
                    gestureDebounce = GESTURE_DEBOUNCE;
                    hasTriggeredThisGesture = true;
                } else if (currentGesture === 'right') {
                    currentOptionIndex = (currentOptionIndex + 1) % 4;
                    updateOptionHighlight();
                    gestureDebounce = GESTURE_DEBOUNCE;
                    hasTriggeredThisGesture = true;
                }
            }
        } else {
            lastSingleGesture = null;
            gestureStableFrames = 0;
            hasTriggeredThisGesture = false;
        }
    }
}

function confirmAnswer(optionIndex) {
    if (isProcessing) return;
    isProcessing = true;
    const q = questionsData.questions[currentQuestionIndex];
    const isCorrect = optionIndex === q.correct;
    const optionEl = document.getElementById(`option-${optionIndex}`);
    const correctEl = document.getElementById(`option-${q.correct}`);

    if (isCorrect) {
        correctAnswers++;
        optionEl.classList.add('correct');
        showFeedback('正确!', 'feedback-correct');
    } else {
        optionEl.classList.add('wrong');
        correctEl.classList.add('correct');
        showFeedback('错误', 'feedback-wrong');
        setTimeout(() => { resetQuiz(); }, 2000);
        return;
    }
    setTimeout(() => {
        currentQuestionIndex++;
        loadQuestion();
        isProcessing = false;
    }, 1500);
}

function showFeedback(text, className) {
    const el = document.getElementById('feedback-indicator');
    el.textContent = text;
    el.className = `gesture-indicator visible ${className}`;
    setTimeout(() => el.classList.remove('visible'), 1200);
}

function showResult() {
    if (correctAnswers === questionsData.questions.length) {
        document.getElementById('result-title').textContent = '全部答对!';
        document.getElementById('result-message').textContent = '正在进入试穿环节...';
        sessionStorage.setItem('quizPassed', 'true');
    } else {
        document.getElementById('result-title').textContent = '答错了';
        document.getElementById('result-message').textContent = '请重新开始...';
        sessionStorage.setItem('quizPassed', 'false');
    }
    const overlay = document.getElementById('result-overlay');
    overlay.style.display = 'flex';
    setTimeout(() => overlay.classList.add('active'), 100);
    setTimeout(() => {
        window.location.href = sessionStorage.getItem('quizPassed') === 'true' ? 'tryon.html' : 'index.html';
    }, 2500);
}

function resetQuiz() {
    currentQuestionIndex = 0;
    correctAnswers = 0;
    isProcessing = false;
    currentOptionIndex = 0;
    createProgressDots();
    loadQuestion();
}

document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
