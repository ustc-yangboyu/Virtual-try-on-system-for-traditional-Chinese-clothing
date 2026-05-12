/**
 * 全景橱窗场景 - 贴图式3D效果
 * 从 API 动态加载服装数据
 */

const RADIUS = 6;
const ROTATION_SPEED = 0.003;

let clothingList = [];
let ITEM_COUNT = 0;
let scene, camera, renderer;
let showcaseGroup;
let currentIndex = 0;
let targetRotation = 0;
let currentRotation = 0;
let handTracker;
let gestureDebounce = 0;
let velocity = 0;
let leftWristXHistory = [];
let rightWristXHistory = [];
const WRIST_HISTORY_LEN = 10;
const SWIPE_THRESHOLD = 0.15;
const SWIPE_TIME_WINDOW = 600;
const MIN_SWIPE_POINTS = 3;
const SWIPE_DEBOUNCE = 10;
const ARM_RAISE_THRESHOLD = 0.02;
const ARM_SPREAD_THRESHOLD = 0.20;
let isSwiping = false;
let swipeDirection = 0;
let bothHandsRaised = false;
let skeletonCtx = null;
let skeletonCanvas = null;

const POSE_CONNECTIONS = [
    [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
    [11, 23], [12, 24], [23, 24]
];

async function init() {
    await loadClothingData();
    initThreeJS();
    initHandTracker();
    initSkeletonCanvas();
    setupEventListeners();
    hideLoading();
    animate();
}

async function loadClothingData() {
    try {
        const resp = await fetch('/api/clothing');
        if (!resp.ok) throw new Error('Failed to load');
        clothingList = await resp.json();
        // Load first cloth image for each item
        await Promise.all(clothingList.map(async (item) => {
            try {
                const imgResp = await fetch(`/api/clothing/${item.id}/images`);
                if (imgResp.ok) {
                    const images = await imgResp.json();
                    item.clothImages = images;
                    item.primaryImage = images.length > 0 ? images[0] : null;
                }
            } catch (e) {
                item.clothImages = [];
                item.primaryImage = null;
            }
        }));
        ITEM_COUNT = clothingList.length;
        if (ITEM_COUNT === 0) throw new Error('No clothing data');
    } catch (e) {
        console.error('Failed to load clothing:', e);
        clothingList = [];
        ITEM_COUNT = 0;
    }
}

function initSkeletonCanvas() {
    skeletonCanvas = document.getElementById('skeleton-canvas');
    if (!skeletonCanvas) return;
    skeletonCtx = skeletonCanvas.getContext('2d');
    const video = document.getElementById('camera-video');
    if (video && video.videoWidth) {
        skeletonCanvas.width = video.videoWidth;
        skeletonCanvas.height = video.videoHeight;
    }
}

function drawSkeleton(landmarks) {
    if (!skeletonCtx || !skeletonCanvas || !landmarks || landmarks.length === 0) {
        if (skeletonCtx && skeletonCanvas) skeletonCtx.clearRect(0, 0, skeletonCanvas.width, skeletonCanvas.height);
        return;
    }
    skeletonCtx.clearRect(0, 0, skeletonCanvas.width, skeletonCanvas.height);
    const w = skeletonCanvas.width;
    const h = skeletonCanvas.height;
    skeletonCtx.strokeStyle = '#00FF00';
    skeletonCtx.lineWidth = 2;
    for (const [i, j] of POSE_CONNECTIONS) {
        if (i < landmarks.length && j < landmarks.length) {
            skeletonCtx.beginPath();
            skeletonCtx.moveTo(landmarks[i].x * w, landmarks[i].y * h);
            skeletonCtx.lineTo(landmarks[j].x * w, landmarks[j].y * h);
            skeletonCtx.stroke();
        }
    }
    skeletonCtx.fillStyle = '#FF0000';
    [11, 12, 13, 14, 15, 16].forEach(i => {
        if (i < landmarks.length) {
            skeletonCtx.beginPath();
            skeletonCtx.arc(landmarks[i].x * w, landmarks[i].y * h, 5, 0, Math.PI * 2);
            skeletonCtx.fill();
        }
    });
}

function initThreeJS() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0a);

    camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 1.6, 0);
    camera.lookAt(0, 1.6, -1);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    document.getElementById('showcase-canvas').appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.3));

    const spotLight = new THREE.SpotLight(0xffd700, 1.2);
    spotLight.position.set(0, 8, 0);
    spotLight.angle = Math.PI / 4;
    spotLight.penumbra = 0.5;
    scene.add(spotLight);

    scene.add(new THREE.PointLight(0xC41E3A, 0.8).translateX(-8).translateY(3).translateZ(4));
    scene.add(new THREE.PointLight(0x0066CC, 0.6).translateX(8).translateY(3).translateZ(4));

    createFloor();
    createShowcase();
}

function createFloor() {
    const floor = new THREE.Mesh(
        new THREE.CircleGeometry(20, 64),
        new THREE.MeshStandardMaterial({ color: 0x0d0d0d, metalness: 0.9, roughness: 0.3 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.01;
    scene.add(floor);

    const ring = new THREE.Mesh(
        new THREE.RingGeometry(5.8, 6, 64),
        new THREE.MeshBasicMaterial({ color: 0xDAA520, transparent: true, opacity: 0.3, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.01;
    scene.add(ring);
}

function createShowcase() {
    showcaseGroup = new THREE.Group();

    clothingList.forEach((item, index) => {
        // Place items so index 0 is at angle π (front, -Z), index 3 at angle 0 (behind, +Z)
        const angle = ((index - ITEM_COUNT / 2 + ITEM_COUNT) % ITEM_COUNT) * (Math.PI * 2 / ITEM_COUNT);
        const frame = createPhotoFrame(item, index);
        frame.position.set(Math.sin(angle) * RADIUS, 1.5, Math.cos(angle) * RADIUS);
        frame.lookAt(0, 1.5, 0);
        showcaseGroup.add(frame);
    });

    scene.add(showcaseGroup);
    updateClothingInfo();
}

function createPhotoFrame(item, index) {
    const group = new THREE.Group();
    const fw = 2.4, fh = 3.2, fd = 0.15, bw = 0.12;

    const outer = new THREE.Mesh(
        new THREE.BoxGeometry(fw, fh, fd),
        new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.95, roughness: 0.1 })
    );
    group.add(outer);

    const inner = new THREE.Mesh(
        new THREE.PlaneGeometry(fw - bw * 2, fh - bw * 2),
        new THREE.MeshStandardMaterial({ color: 0x1a1a1a })
    );
    inner.position.z = fd / 2 + 0.001;
    group.add(inner);

    const texture = createClothingTexture(item);
    const image = new THREE.Mesh(
        new THREE.PlaneGeometry(fw - bw * 2 - 0.1, fh - bw * 2 - 0.1),
        new THREE.MeshBasicMaterial({ map: texture })
    );
    image.position.z = fd / 2 + 0.005;
    group.add(image);

    // Load actual cloth image - scale to fit in image area with margins
    if (item.primaryImage) {
        const loader = new THREE.TextureLoader();
        loader.load(item.primaryImage, (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.minFilter = THREE.LinearFilter;
            tex.magFilter = THREE.LinearFilter;
            // Image area in texture: y=50 to y=330 (out of 680), x=56 to x=456 (out of 512)
            // Maintain aspect ratio: image area is 400x280 = 1.43 ratio
            const imgAreaW = fw - bw * 2 - 0.1;
            const imgAreaH = fh - bw * 2 - 0.1;
            // Use 85% of available width, height based on texture aspect ratio
            const imgW = imgAreaW * 0.85;
            const imgH = imgAreaW * 280 / 400; // maintain 400:280 aspect
            const overlay = new THREE.Mesh(
                new THREE.PlaneGeometry(imgW, imgH),
                new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.92 })
            );
            // Place in upper portion of frame where image area is
            overlay.position.y = (fh - bw * 2) / 2 - 0.8;
            overlay.position.z = fd / 2 + 0.02;
            group.add(overlay);
        }, undefined, (err) => {
            console.warn('Failed to load cloth image:', err);
        });
    }

    const topDecor = new THREE.Mesh(
        new THREE.BoxGeometry(fw + 0.2, 0.3, 0.1),
        new THREE.MeshStandardMaterial({ color: 0xDAA520, metalness: 0.9, roughness: 0.2, emissive: 0x332200 })
    );
    topDecor.position.y = fh / 2 + 0.15;
    group.add(topDecor);

    return group;
}

function createClothingTexture(item) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 680;
    const ctx = canvas.getContext('2d');

    const colorPalette = [
        0xC41E3A, 0xDAA520, 0x2E8B57, 0x1C1C1C, 0x000080,
        0x8B4513, 0xFF6347, 0x4682B4, 0x9ACD32, 0x4B0082,
        0xFF4500, 0x00CED1, 0xFFD700, 0x8A2BE2, 0x00FA9A
    ];
    const color = colorPalette[item.color_index % 15] || 0x888888;
    const r = (color >> 16) & 0xFF;
    const g = (color >> 8) & 0xFF;
    const b = color & 0xFF;

    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, `rgb(${Math.max(0, r-40)}, ${Math.max(0, g-40)}, ${Math.max(0, b-40)})`);
    gradient.addColorStop(0.5, `rgb(${r}, ${g}, ${b})`);
    gradient.addColorStop(1, `rgb(${Math.min(255, r+30)}, ${Math.min(255, g+30)}, ${Math.min(255, b+30)})`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = 'rgba(218, 165, 32, 0.4)';
    ctx.lineWidth = 2;
    for (let i = -canvas.height; i < canvas.width + canvas.height; i += 40) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + canvas.height, canvas.height);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(i, canvas.height);
        ctx.lineTo(i + canvas.height, 0);
        ctx.stroke();
    }

    const imgAreaY = 50;
    const imgAreaH = 280;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(56, imgAreaY, 400, imgAreaH);
    ctx.strokeStyle = '#DAA520';
    ctx.lineWidth = 2;
    ctx.strokeRect(56, imgAreaY, 400, imgAreaH);

    ctx.fillStyle = 'rgba(218, 165, 32, 0.5)';
    ctx.font = '48px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('👘', canvas.width / 2, imgAreaY + imgAreaH / 2 - 30);
    ctx.font = '20px sans-serif';
    ctx.fillText('服装图片', canvas.width / 2, imgAreaY + imgAreaH / 2 + 30);

    const infoY = imgAreaY + imgAreaH + 30;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(40, infoY, canvas.width - 80, canvas.height - infoY - 40);
    ctx.strokeStyle = '#DAA520';
    ctx.lineWidth = 3;
    ctx.strokeRect(40, infoY, canvas.width - 80, canvas.height - infoY - 40);

    ctx.fillStyle = '#DAA520';
    ctx.font = 'bold 56px serif';
    ctx.textAlign = 'center';
    ctx.fillText(item.name, canvas.width / 2, infoY + 60);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = '32px serif';
    ctx.fillText(item.dynasty || '', canvas.width / 2, infoY + 120);

    ctx.fillStyle = '#CCCCCC';
    ctx.font = '24px sans-serif';
    const features = item.features || [];
    const displayFeatures = features.length > 0 ? features : ['传统服饰', '文化精髓'];
    displayFeatures.slice(0, 2).forEach((line, i) => ctx.fillText(line, canvas.width / 2, infoY + 170 + i * 36));

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
}

function initHandTracker() {
    handTracker = new HandTracker();
    handTracker.onHandData = (data) => handleHandData(data);
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

function updateDebugPanel(data) {
    const dbg = id => document.getElementById(id);
    const setVal = (id, val) => {
        const el = dbg(id);
        if (el) el.textContent = val;
    };
    setVal('dbg-rotation', currentRotation.toFixed(2));
    setVal('dbg-current-index', currentIndex);
    setVal('dbg-left-x', data.left_wrist_x != null ? data.left_wrist_x.toFixed(3) : '--');
    setVal('dbg-right-x', data.right_wrist_x != null ? data.right_wrist_x.toFixed(3) : '--');
    setVal('dbg-left-y', data.left_wrist_y != null ? data.left_wrist_y.toFixed(3) : '--');
    setVal('dbg-right-y', data.right_wrist_y != null ? data.right_wrist_y.toFixed(3) : '--');
    const poseData = data.pose || {};
    const landmarks = poseData.landmarks || [];
    const leftShoulder = data.left_shoulder_x != null
        ? { x: data.left_shoulder_x, y: data.left_shoulder_y }
        : (landmarks[11] || null);
    const rightShoulder = data.right_shoulder_x != null
        ? { x: data.right_shoulder_x, y: data.right_shoulder_y }
        : (landmarks[12] || null);
    const leftArmRaised = data.left_wrist_y != null && leftShoulder && data.left_wrist_y < (leftShoulder.y - ARM_RAISE_THRESHOLD);
    const rightArmRaised = data.right_wrist_y != null && rightShoulder && data.right_wrist_y < (rightShoulder.y - ARM_RAISE_THRESHOLD);
    setVal('dbg-left-raised', leftArmRaised ? '↑' : '✕');
    setVal('dbg-right-raised', rightArmRaised ? '↑' : '✕');
    setVal('dbg-swipe-dir', swipeDirection > 0 ? '→' : swipeDirection < 0 ? '←' : '--');
    setVal('dbg-velocity', velocity.toFixed(4));
}

function handleHandData(data) {
    updateDebugPanel(data);
    const poseData = data.pose || {};
    drawSkeleton(poseData.landmarks || []);

    const leftX = data.left_wrist_x;
    const leftY = data.left_wrist_y;
    const rightX = data.right_wrist_x;
    const rightY = data.right_wrist_y;
    const landmarks = poseData.landmarks || [];
    const leftShoulder = data.left_shoulder_x != null
        ? { x: data.left_shoulder_x, y: data.left_shoulder_y }
        : (landmarks[11] || null);
    const rightShoulder = data.right_shoulder_x != null
        ? { x: data.right_shoulder_x, y: data.right_shoulder_y }
        : (landmarks[12] || null);

    const now = Date.now();
    if (leftX != null) leftWristXHistory.push({ x: leftX, y: leftY, time: now });
    if (rightX != null) rightWristXHistory.push({ x: rightX, y: rightY, time: now });
    leftWristXHistory = leftWristXHistory.filter(p => now - p.time <= SWIPE_TIME_WINDOW);
    rightWristXHistory = rightWristXHistory.filter(p => now - p.time <= SWIPE_TIME_WINDOW);

    if (gestureDebounce > 0) { gestureDebounce--; return; }

    const leftArmSpread = leftX != null && leftShoulder && leftX > (leftShoulder.x + ARM_SPREAD_THRESHOLD);
    const rightArmSpread = rightX != null && rightShoulder && rightX < (rightShoulder.x - ARM_SPREAD_THRESHOLD);

    if (leftArmSpread && rightArmSpread) {
        enterClothingDetail();
        return;
    }

    const leftArmRaised = leftY != null && leftShoulder && leftY < (leftShoulder.y - ARM_RAISE_THRESHOLD);
    const rightArmRaised = rightY != null && rightShoulder && rightY < (rightShoulder.y - ARM_RAISE_THRESHOLD);
    bothHandsRaised = leftArmRaised && rightArmRaised;

    if (!leftArmRaised && !rightArmRaised) {
        isSwiping = false;
        swipeDirection = 0;
        velocity *= 0.15;
        leftWristXHistory = [];
        rightWristXHistory = [];
        return;
    }

    let leftDeltaX = leftWristXHistory.length >= 2 ? leftWristXHistory[leftWristXHistory.length - 1].x - leftWristXHistory[0].x : 0;
    let rightDeltaX = rightWristXHistory.length >= 2 ? rightWristXHistory[rightWristXHistory.length - 1].x - rightWristXHistory[0].x : 0;

    let dominantDelta = 0;
    if (leftArmRaised && Math.abs(leftDeltaX) > Math.abs(rightDeltaX)) dominantDelta = leftDeltaX;
    else if (rightArmRaised && Math.abs(rightDeltaX) >= Math.abs(leftDeltaX)) dominantDelta = rightDeltaX;

    const absDelta = Math.abs(dominantDelta);
    if (absDelta < SWIPE_THRESHOLD) { if (isSwiping) velocity *= 0.8; return; }

    swipeDirection = dominantDelta > 0 ? -1 : 1;
    const speedMultiplier = Math.min(4, Math.max(1, absDelta / SWIPE_THRESHOLD));
    velocity = swipeDirection * ROTATION_SPEED * speedMultiplier;

    if (!isSwiping) {
        isSwiping = true;
        gestureDebounce = SWIPE_DEBOUNCE;
    }
}

function enterClothingDetail() {
    const item = clothingList[currentIndex];
    if (item) {
        sessionStorage.setItem('selectedClothingId', item.id);
    }
    const overlay = document.getElementById('transition-overlay');
    if (overlay) overlay.classList.add('active');
    setTimeout(() => { window.location.href = 'intro.html'; }, 1500);
}

function setupEventListeners() {
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    document.getElementById('prev-btn')?.addEventListener('click', () => {
        targetRotation += (Math.PI * 2) / Math.max(ITEM_COUNT, 1);
        updateClothingInfo();
    });
    document.getElementById('next-btn')?.addEventListener('click', () => {
        targetRotation -= (Math.PI * 2) / Math.max(ITEM_COUNT, 1);
        updateClothingInfo();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') { targetRotation += ROTATION_SPEED * 50; updateClothingInfo(); }
        else if (e.key === 'ArrowRight') { targetRotation -= ROTATION_SPEED * 50; updateClothingInfo(); }
        else if (e.key === 'Enter') enterClothingDetail();
    });
}

function updateCameraPosition() {
    velocity *= isSwiping ? 0.97 : 0.15;
    if (!bothHandsRaised) targetRotation += velocity;
    currentRotation += (targetRotation - currentRotation) * 0.08;
    if (showcaseGroup) showcaseGroup.rotation.y = -currentRotation;

    // Camera rotates as currentRotation increases (viewer rotating left = currentRotation++)
    // At currentRotation, camera faces direction currentRotation from -Z
    // Item at index i has world angle (i / ITEM_COUNT) * 2π
    // Item is front-most when camera angle matches item angle: currentRotation = (i / ITEM_COUNT) * 2π
    // So: i = (currentRotation / 2π) * ITEM_COUNT
    let itemIndex = 0;
    if (ITEM_COUNT > 0) {
        const rawIndex = (currentRotation / (Math.PI * 2)) * ITEM_COUNT;
        itemIndex = Math.floor((((rawIndex + 0.5) % ITEM_COUNT) + ITEM_COUNT) % ITEM_COUNT);
    }

    if (itemIndex !== currentIndex) {
        currentIndex = itemIndex;
        updateClothingInfo();
    }
}

function updateClothingInfo() {
    const item = clothingList[currentIndex];
    if (!item) return;
    const nameEl = document.getElementById('clothing-name');
    const dynastyEl = document.getElementById('clothing-dynasty');
    const descEl = document.getElementById('clothing-desc');
    if (nameEl) nameEl.textContent = item.name;
    if (dynastyEl) dynastyEl.textContent = item.dynasty || '';
    if (descEl) descEl.textContent = item.description || '';
    createItemDots();
}

function createItemDots() {
    const container = document.getElementById('item-dots');
    if (!container || ITEM_COUNT === 0) return;
    container.innerHTML = '';
    clothingList.forEach((_, index) => {
        const dot = document.createElement('div');
        dot.className = 'item-dot' + (index === currentIndex ? ' active' : '');
        dot.addEventListener('click', () => {
            const diff = index - currentIndex;
            targetRotation -= diff * (Math.PI * 2) / ITEM_COUNT;
            currentIndex = index;
            updateClothingInfo();
        });
        container.appendChild(dot);
    });
}

function hideLoading() {
    const loading = document.getElementById('loading-3d');
    if (loading) { loading.style.opacity = '0'; loading.style.transition = 'opacity 0.5s ease'; setTimeout(() => loading.remove(), 500); }
}

function animate() {
    requestAnimationFrame(animate);
    updateCameraPosition();
    if (renderer && scene && camera) renderer.render(scene, camera);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
