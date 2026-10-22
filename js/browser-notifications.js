// Browser permissions and delivery preferences belong to this device, not the account on the server.
export class BrowserNotificationChannel {
    constructor(env = globalThis) {
        this.env = env;
        this.live = new Set();
        this.timer = null;
        this.busy = false;
        this.stopped = true;
    }

    supported() {
        return this.env.isSecureContext && typeof this.env.Notification === 'function';
    }

    read() {
        try { return JSON.parse(this.env.localStorage.getItem(this.key) || 'null'); }
        catch { return null; }
    }

    write(state) {
        try { this.env.localStorage.setItem(this.key, JSON.stringify(state)); return true; }
        catch { return false; }
    }

    enabled() {
        return this.supported() && this.env.Notification.permission === 'granted' && this.read()?.enabled === true;
    }

    async configure(enabled) {
        if (!this.user || !this.supported()) return false;
        if (!enabled) {
            this.write({ ...this.read(), enabled: false });
            this.close();
            return false;
        }
        // Must run directly inside the settings click handler, without an earlier await.
        let permission;
        try { permission = await this.env.Notification.requestPermission(); }
        catch { return false; }
        if (permission !== 'granted') return false;
        // Establish a fresh baseline before enabling, including after a long disabled period.
        try {
            const items = await this.load();
            if (!items || this.stopped) return false;
            return this.write({ enabled: true, seen: items.map(item => item.id).slice(-500), since: this.watermark(items) });
        } catch { return false; }
    }

    watermark(items) {
        return Math.max(0, ...items.map(item => Date.parse(item.date)).filter(Number.isFinite));
    }

    start({ user, load, onBatch, onOpen, title }) {
        this.stop();
        if (!user?.id) return;
        Object.assign(this, { user, load, onBatch, onOpen, title });
        this.key = `ticket.browser-notifications.${user.id}`;
        this.stopped = false;
        this.delay = 30000;
        this.storageHandler = event => {
            if (event.key === this.key && !this.enabled()) this.close();
        };
        this.env.addEventListener('storage', this.storageHandler);
        this.pageHandler = () => this.stop();
        this.env.addEventListener('pagehide', this.pageHandler, { once: true });
        void this.poll();
    }

    async deliver(items) {
        const work = async () => {
            if (this.stopped) return;
            const state = this.read();
            const seen = new Set(state?.seen || []);
            const fresh = items.filter(item => state && item.recipientUserId === this.user.id && !item.read &&
                !seen.has(item.id) && Number.isFinite(Date.parse(item.date)) && Date.parse(item.date) >= (state.since || 0));
            // Commit before showing so concurrent tabs/reloads cannot replay the batch.
            const next = { enabled: state?.enabled === true, since: Math.max(state?.since || 0, this.watermark(items)),
                seen: [...new Set([...seen, ...items.map(item => item.id)])].slice(-500) };
            if (!this.write(next) || !this.enabled()) return;
            for (const item of fresh) {
                try {
                    const notification = new this.env.Notification(this.title(), {
                        body: [item.ticketNumber, item.message].filter(Boolean).join(' · '),
                        icon: '/picture/favicon.png', tag: `${this.user.id}:${item.id}`
                    });
                    this.live.add(notification);
                    notification.onclose = () => this.live.delete(notification);
                    notification.onclick = () => {
                        notification.close();
                        if (!this.stopped && this.enabled()) {
                            this.env.focus();
                            Promise.resolve(this.onOpen(item)).catch(() => {});
                        }
                    };
                } catch {
                    // Some browsers expose the API but do not support desktop delivery.
                    this.write({ ...next, enabled: false });
                    break;
                }
            }
        };
        if (this.env.navigator?.locks) {
            await this.env.navigator.locks.request(this.key, { ifAvailable: true }, lock => lock ? work() : undefined);
        } else await work();
    }

    async poll() {
        if (this.busy || this.stopped) return;
        this.busy = true;
        try {
            const items = await this.load();
            if (!items) throw new Error('notification_fetch_failed');
            if (!this.stopped) {
                this.onBatch(items);
                await this.deliver(items);
            }
            this.delay = 30000;
        } catch { this.delay = Math.min((this.delay || 30000) * 2, 300000); }
        finally {
            this.busy = false;
            if (!this.stopped) this.timer = this.env.setTimeout(() => { void this.poll(); }, this.delay);
        }
    }

    close() {
        for (const notification of this.live) notification.close();
        this.live.clear();
    }

    stop() {
        this.stopped = true;
        this.env.clearTimeout(this.timer);
        if (this.storageHandler) this.env.removeEventListener('storage', this.storageHandler);
        if (this.pageHandler) this.env.removeEventListener('pagehide', this.pageHandler);
        this.close();
    }
}

export const BrowserNotifications = new BrowserNotificationChannel();
