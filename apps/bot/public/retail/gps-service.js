/**
 * Dịch vụ xử lý định vị GPS cho Mini App Retail Check-in.
 * Kết hợp Telegram LocationManager (Bot API 8.0+) và chuẩn HTML5 Geolocation.
 */

export class GpsService {
    constructor({ onStatusChange, onLocationUpdate } = {}) {
        this.latitude = null;
        this.longitude = null;
        this.accuracy = null;
        this.isLocating = false;
        this.onStatusChange = onStatusChange || (() => {});
        this.onLocationUpdate = onLocationUpdate || (() => {});
    }

    getCoordinates() {
        return {
            latitude: this.latitude,
            longitude: this.longitude,
            accuracy: this.accuracy
        };
    }

    requestLocation() {
        if (this.isLocating) return;
        this.isLocating = true;
        this.onStatusChange('loading');

        const handleSuccess = (coords) => {
            this.latitude = coords.latitude;
            this.longitude = coords.longitude;
            this.accuracy = coords.accuracy || null;
            this.isLocating = false;
            this.onStatusChange('success');
            this.onLocationUpdate(this.getCoordinates());
        };

        const handleError = (err) => {
            this.isLocating = false;
            console.warn('[GPS Geolocation Error]:', err);
            const msg = err && err.message ? err.message : 'Không thể lấy toạ độ vị trí';
            this.onStatusChange('error', msg);
        };

        // 1. Nếu Telegram WebApp hỗ trợ LocationManager (Bot API 8.0+)
        if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.LocationManager) {
            const lm = window.Telegram.WebApp.LocationManager;
            if (!lm.isInited) {
                try {
                    lm.init(() => {
                        if (lm.isLocationAvailable) {
                            lm.getLocation((locationData) => {
                                if (locationData && locationData.latitude != null) {
                                    handleSuccess({
                                        latitude: locationData.latitude,
                                        longitude: locationData.longitude,
                                        accuracy: locationData.horizontal_accuracy || null
                                    });
                                } else {
                                    this._fallbackHtml5Geo(handleSuccess, handleError);
                                }
                            });
                            return;
                        }
                        this._fallbackHtml5Geo(handleSuccess, handleError);
                    });
                    return;
                } catch (e) {
                    console.warn('Telegram LocationManager error, falling back to HTML5:', e);
                }
            } else if (lm.isLocationAvailable) {
                try {
                    lm.getLocation((locationData) => {
                        if (locationData && locationData.latitude != null) {
                            handleSuccess({
                                latitude: locationData.latitude,
                                longitude: locationData.longitude,
                                accuracy: locationData.horizontal_accuracy || null
                            });
                        } else {
                            this._fallbackHtml5Geo(handleSuccess, handleError);
                        }
                    });
                    return;
                } catch (e) {
                    console.warn('Telegram LocationManager error, falling back to HTML5:', e);
                }
            }
        }

        // 2. HTML5 Geolocation thông thường
        this._fallbackHtml5Geo(handleSuccess, handleError);
    }

    _fallbackHtml5Geo(onSuccess, onError) {
        if (!navigator.geolocation) {
            onError(new Error('Thiết bị hoặc trình duyệt không hỗ trợ GPS'));
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                onSuccess({
                    latitude: pos.coords.latitude,
                    longitude: pos.coords.longitude,
                    accuracy: pos.coords.accuracy
                });
            },
            (err) => {
                let msg = 'Chưa cấp quyền truy cập GPS';
                if (err.code === 1) msg = 'Quyền vị trí bị từ chối';
                else if (err.code === 2) msg = 'Không bắt được tín hiệu GPS';
                else if (err.code === 3) msg = 'Hết thời gian chờ GPS';
                onError(new Error(msg));
            },
            { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
        );
    }
}
