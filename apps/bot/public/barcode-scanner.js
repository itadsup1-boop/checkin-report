(function () {
    'use strict';

    const NATIVE_FORMATS = ['ean_13', 'ean_8', 'code_128', 'upc_a', 'upc_e'];
    const QUAGGA_READERS = ['ean_reader', 'ean_8_reader', 'code_128_reader', 'upc_reader', 'upc_e_reader'];
    const NATIVE_FALLBACK_MS = 2500;

    let sessionId = 0;
    let stream = null;
    let activeTrack = null;
    let animationFrame = null;
    let fallbackTimer = null;
    let quaggaActive = false;
    let quaggaHandler = null;
    let stage = null;
    let statusElement = null;
    let torchButton = null;
    let callbacks = {};
    let recentResult = null;
    let acceptingResult = false;

    function setStatus(message) {
        if (statusElement) statusElement.textContent = message;
        if (typeof callbacks.onStatus === 'function') callbacks.onStatus(message);
    }

    function createStage(target) {
        const oldStage = target.querySelector('.barcode-scanner-stage');
        if (oldStage) oldStage.remove();

        stage = document.createElement('div');
        stage.className = 'barcode-scanner-stage';
        stage.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#000;';

        const laser = document.createElement('div');
        laser.className = 'laser-line';
        stage.appendChild(laser);

        statusElement = document.createElement('div');
        statusElement.className = 'barcode-scanner-status';
        statusElement.style.cssText = 'position:absolute;left:8px;right:8px;bottom:10px;z-index:20;color:#fff;font-size:11px;font-weight:600;text-align:center;text-shadow:0 1px 4px #000;';
        stage.appendChild(statusElement);

        torchButton = document.createElement('button');
        torchButton.type = 'button';
        torchButton.textContent = '🔦 Bật đèn';
        torchButton.style.cssText = 'display:none;position:absolute;top:10px;right:10px;z-index:30;border:0;border-radius:16px;padding:7px 10px;background:rgba(15,23,42,.8);color:#fff;font-size:11px;font-weight:600;';
        torchButton.addEventListener('click', async () => {
            try {
                const enabled = await toggleTorch();
                torchButton.textContent = enabled ? '🔦 Tắt đèn' : '🔦 Bật đèn';
            } catch (error) {
                console.warn('[Scanner] Không thể đổi trạng thái đèn pin:', error);
            }
        });
        stage.appendChild(torchButton);

        target.prepend(stage);
    }

    function stopStream() {
        if (stream) stream.getTracks().forEach((track) => track.stop());
        stream = null;
        activeTrack = null;
    }

    function stopQuagga() {
        if (!quaggaActive || !window.Quagga) return;
        try {
            if (quaggaHandler) window.Quagga.offDetected(quaggaHandler);
            window.Quagga.stop();
        } catch (error) {
            console.warn('[Scanner] Không thể dừng Quagga:', error);
        }
        quaggaActive = false;
        quaggaHandler = null;
    }

    async function stop() {
        sessionId += 1;
        if (fallbackTimer) clearTimeout(fallbackTimer);
        fallbackTimer = null;
        if (animationFrame) cancelAnimationFrame(animationFrame);
        animationFrame = null;
        stopQuagga();
        stopStream();
        if (stage) stage.remove();
        stage = null;
        statusElement = null;
        torchButton = null;
        callbacks = {};
        recentResult = null;
    }

    function hasValidChecksum(code, format) {
        if (!/^\d+$/.test(code)) return true;
        const expectedLengths = {
            ean_13: [13], ean_8: [8], upc_a: [12],
            ean: [8, 13], upc: [12]
        };
        const lengths = expectedLengths[format];
        if (!lengths || !lengths.includes(code.length)) return true;

        const digits = code.split('').map(Number);
        const checkDigit = digits.pop();
        let sum = 0;
        for (let i = digits.length - 1, position = 1; i >= 0; i -= 1, position += 1) {
            sum += digits[i] * (position % 2 === 1 ? 3 : 1);
        }
        return (10 - (sum % 10)) % 10 === checkDigit;
    }

    function provideFeedback() {
        try {
            navigator.vibrate?.(80);
            window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) return;
            const context = new AudioContext();
            const oscillator = context.createOscillator();
            const gain = context.createGain();
            oscillator.frequency.value = 880;
            gain.gain.setValueAtTime(0.08, context.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.12);
            oscillator.connect(gain).connect(context.destination);
            oscillator.start();
            oscillator.stop(context.currentTime + 0.12);
            oscillator.onended = () => context.close();
        } catch (_) {
            // Âm báo là phản hồi phụ; không làm hỏng kết quả quét.
        }
    }

    async function accept(code, format, source) {
        const normalized = String(code || '').trim();
        if (!normalized || acceptingResult || !hasValidChecksum(normalized, format)) return;
        acceptingResult = true;
        const onDetected = callbacks.onDetected;
        provideFeedback();
        setStatus(`Đã nhận diện: ${normalized}`);
        await stop();
        if (typeof onDetected === 'function') onDetected(normalized, { format, source });
        acceptingResult = false;
    }

    async function applyCameraCapabilities(track) {
        if (!track?.getCapabilities || !track?.applyConstraints) return;
        const capabilities = track.getCapabilities();
        const advanced = {};
        if (Array.isArray(capabilities.focusMode) && capabilities.focusMode.includes('continuous')) {
            advanced.focusMode = 'continuous';
        }
        if (capabilities.zoom && capabilities.zoom.min <= 1.25 && capabilities.zoom.max >= 1.25) {
            advanced.zoom = 1.25;
        }
        if (Object.keys(advanced).length) {
            try { await track.applyConstraints({ advanced: [advanced] }); } catch (_) { /* optional */ }
        }
        if (torchButton && capabilities.torch) torchButton.style.display = 'block';
    }

    async function startNative(currentSession) {
        const supported = typeof window.BarcodeDetector.getSupportedFormats === 'function'
            ? await window.BarcodeDetector.getSupportedFormats()
            : NATIVE_FORMATS;
        const formats = NATIVE_FORMATS.filter((format) => supported.includes(format));
        if (!formats.length) throw new Error('NO_NATIVE_FORMATS');

        stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
                facingMode: { ideal: 'environment' },
                width: { ideal: 960 },
                height: { ideal: 540 }
            }
        });
        if (currentSession !== sessionId) return stopStream();

        activeTrack = stream.getVideoTracks()[0] || null;
        await applyCameraCapabilities(activeTrack);

        const video = document.createElement('video');
        video.autoplay = true;
        video.muted = true;
        video.playsInline = true;
        video.setAttribute('webkit-playsinline', 'true');
        video.srcObject = stream;
        stage.prepend(video);
        await video.play();

        const detector = new window.BarcodeDetector({ formats });
        setStatus('Đang lấy nét mã vạch…');

        let detecting = false;
        let lastDetectionAt = 0;
        const detectFrame = async (timestamp) => {
            if (currentSession !== sessionId || !stream) return;
            if (!detecting && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && timestamp - lastDetectionAt >= 100) {
                detecting = true;
                lastDetectionAt = timestamp;
                try {
                    const results = await detector.detect(video);
                    const result = results.find((item) => item.rawValue);
                    if (result) {
                        accept(result.rawValue, result.format, 'native');
                        return;
                    }
                } catch (error) {
                    console.warn('[Scanner] Native detector error:', error);
                } finally {
                    detecting = false;
                }
            }
            animationFrame = requestAnimationFrame(detectFrame);
        };
        animationFrame = requestAnimationFrame(detectFrame);

        fallbackTimer = setTimeout(() => {
            if (currentSession !== sessionId) return;
            if (animationFrame) cancelAnimationFrame(animationFrame);
            animationFrame = null;
            stopStream();
            startQuagga(currentSession).catch(handleError);
        }, NATIVE_FALLBACK_MS);
    }

    function startQuagga(currentSession) {
        return new Promise((resolve, reject) => {
            if (!window.Quagga) return reject(new Error('Thư viện Quagga2 chưa được tải.'));
            if (currentSession !== sessionId) return resolve();

            stage.querySelectorAll('video, canvas').forEach((element) => element.remove());
            setStatus('Đang khởi động bộ quét tương thích…');

            window.Quagga.init({
                inputStream: {
                    name: 'Live',
                    type: 'LiveStream',
                    target: stage,
                    constraints: {
                        facingMode: { ideal: 'environment' },
                        width: { ideal: 960 },
                        height: { ideal: 540 }
                    },
                    area: { top: '15%', right: '3%', left: '3%', bottom: '15%' }
                },
                locate: true,
                frequency: 12,
                locator: { patchSize: 'medium', halfSample: true },
                decoder: { readers: QUAGGA_READERS }
            }, (error) => {
                if (error) return reject(error);
                if (currentSession !== sessionId) return resolve();

                quaggaHandler = (result) => {
                    const code = result?.codeResult?.code?.trim();
                    if (!code) return;
                    const format = result.codeResult.format || '';
                    const now = Date.now();
                    if (recentResult && recentResult.code === code && now - recentResult.at <= 1200) {
                        recentResult = null;
                        accept(code, format, 'quagga');
                    } else {
                        recentResult = { code, at: now };
                        setStatus(`Đang xác nhận mã: ${code}`);
                    }
                };
                window.Quagga.onDetected(quaggaHandler);
                window.Quagga.start();
                quaggaActive = true;
                activeTrack = window.Quagga.CameraAccess?.getActiveTrack?.() || null;
                applyCameraCapabilities(activeTrack);
                setStatus('Đưa mã vạch vào giữa khung hình');
                resolve();
            });
        });
    }

    function handleError(error) {
        console.error('[Scanner] Lỗi khởi động:', error);
        setStatus('Không thể mở bộ quét mã vạch');
        if (typeof callbacks.onError === 'function') callbacks.onError(error);
    }

    async function start(options) {
        await stop();
        if (!options?.target) throw new Error('Scanner target is required.');
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Thiết bị không hỗ trợ truy cập camera.');

        callbacks = options;
        acceptingResult = false;
        const currentSession = sessionId;
        createStage(options.target);
        setStatus('Đang mở camera…');

        try {
            if ('BarcodeDetector' in window) await startNative(currentSession);
            else await startQuagga(currentSession);
        } catch (error) {
            stopStream();
            if ('BarcodeDetector' in window && error?.name !== 'NotAllowedError') {
                try {
                    await startQuagga(currentSession);
                    return;
                } catch (fallbackError) {
                    handleError(fallbackError);
                    return;
                }
            }
            handleError(error);
        }
    }

    async function toggleTorch() {
        if (!activeTrack?.getCapabilities || !activeTrack?.applyConstraints) return false;
        const capabilities = activeTrack.getCapabilities();
        if (!capabilities.torch) return false;
        const current = activeTrack.getSettings?.().torch === true;
        await activeTrack.applyConstraints({ advanced: [{ torch: !current }] });
        return !current;
    }

    function isTorchSupported() {
        return Boolean(activeTrack?.getCapabilities?.().torch);
    }

    window.BarcodeScanner = { start, stop, toggleTorch, isTorchSupported };
    window.addEventListener('pagehide', () => { stop(); });
})();
