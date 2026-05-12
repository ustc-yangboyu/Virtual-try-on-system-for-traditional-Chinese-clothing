/**
 * 手掌追踪前端模块
 * 负责连接后端WebSocket并处理手势数据
 */

class HandTracker {
    constructor() {
        this.ws = null;
        this.camera = null;
        this.canvas = null;
        this.ctx = null;
        this.video = null;
        this.isConnected = false;
        this.isTracking = false;
        this.url = '';
        this.frameInterval = 250;
        this.lastSendTime = 0;
        this.onHandData = null;
        this.onHandGesture = null;
        this.onStatusChange = null;
        this.onError = null;
        this._tracking = false;
    }

    connect(url) {
        if (this.isConnected) return;
        this.url = url;
        this.updateStatus('connecting');

        try {
            this.ws = new WebSocket(url);
            this.ws.onopen = () => {
                console.log('Hand tracker WebSocket connected');
                this.isConnected = true;
                this.updateStatus('connected');
            };
            this.ws.onmessage = (event) => {
                this.handleMessage(event.data);
            };
            this.ws.onclose = () => {
                console.log('Hand tracker WebSocket disconnected');
                this.isConnected = false;
                this._tracking = false;
                this.updateStatus('disconnected');
            };
            this.ws.onerror = (error) => {
                console.error('Hand tracker WebSocket error:', error);
                this.updateStatus('error');
                if (this.onError) this.onError(error);
            };
        } catch (error) {
            console.error('Failed to create WebSocket:', error);
            this.updateStatus('error');
        }
    }

    disconnect() {
        this._tracking = false;
        if (this.ws) {
            this.stopCamera();
            this.ws.close();
            this.ws = null;
        }
        this.isConnected = false;
    }

    async initCamera() {
        try {
            this.camera = await navigator.mediaDevices.getUserMedia({
                video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }
            });
            this.video = document.createElement('video');
            this.video.srcObject = this.camera;
            this.video.playsInline = true;
            this.video.autoplay = true;
            this.video.muted = true;
            await new Promise((resolve, reject) => {
                this.video.onloadedmetadata = () => {
                    this.video.play().then(() => resolve()).catch(reject);
                };
                this.video.onerror = (e) => reject(e);
            });
            this.canvas = document.createElement('canvas');
            this.canvas.width = this.video.videoWidth || 640;
            this.canvas.height = this.video.videoHeight || 480;
            this.ctx = this.canvas.getContext('2d');
            console.log('Hand tracker camera initialized:', this.canvas.width, 'x', this.canvas.height);
            return true;
        } catch (error) {
            console.error('Failed to initialize camera:', error);
            this.updateStatus('camera_error');
            if (this.onError) this.onError(error);
            return false;
        }
    }

    stopCamera() {
        this._tracking = false;
        if (this.camera) {
            this.camera.getTracks().forEach(track => track.stop());
            this.camera = null;
        }
        if (this.video) {
            this.video.srcObject = null;
            this.video = null;
        }
    }

    startTracking() {
        if (!this.isConnected || !this.camera || !this.video) {
            console.warn('Cannot start tracking: not connected or no camera');
            return;
        }
        this._tracking = true;
        this.lastSendTime = 0;
        this.sendLoop();
    }

    stopTracking() {
        this._tracking = false;
    }

    sendLoop() {
        if (!this._tracking || !this.isConnected) return;
        const now = Date.now();
        if (now - this.lastSendTime >= this.frameInterval) {
            this.sendFrameIfReady();
            this.lastSendTime = now;
        }
        requestAnimationFrame(() => this.sendLoop());
    }

    sendFrameIfReady() {
        if (!this.isConnected || !this.camera || !this.video) return;
        if (this.video.paused || this.video.ended || this.video.readyState < 2) return;
        if (this.ws.readyState !== WebSocket.OPEN) return;
        try {
            this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
            const dataUrl = this.canvas.toDataURL('image/jpeg', 0.5);
            const base64Data = dataUrl.split(',')[1];
            this.ws.send(JSON.stringify({ type: 'frame', data: base64Data }));
        } catch (error) {
            console.error('Error sending frame:', error);
        }
    }

    handleMessage(data) {
        try {
            const message = JSON.parse(data);
            if (message.type === 'pose_data' && message.data) {
                // pose_data contains: pose, hand, head, fps, left_wrist_x, right_wrist_x
                // Pass full data for pages to use hand wrist positions
                if (this.onHandData) {
                    this.onHandData(message.data);
                }
                if (this.onHandGesture && message.data.hand) {
                    this.onHandGesture(message.data.hand);
                }
            }
        } catch (error) {
            console.error('Error parsing message:', error);
        }
    }

    updateStatus(status) {
        if (this.onStatusChange) {
            this.onStatusChange(status);
        }
    }

    getVideoElement() {
        return this.video;
    }
}

window.HandTracker = HandTracker;