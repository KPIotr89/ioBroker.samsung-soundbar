'use strict';

const utils = require('@iobroker/adapter-core');
const { SoundbarApi } = require('./lib/api');
const { MqttBridge } = require('./lib/mqtt-bridge');
const { OBJECTS, BUTTONS } = require('./lib/objects');

const STATE_KEYS = [ 'power', 'volume', 'mute', 'input', 'soundMode', 'codec' ];
const MAX_BACKOFF = 60000;

class SamsungSoundbar extends utils.Adapter {
    constructor(options) {
        super({ ...options, name: 'samsung-soundbar' });

        this.api = null;
        this.mqtt = null;
        this.pollTimer = null;
        this.refreshTimer = null;
        this.backoff = 0;
        this.lastState = {};
        this.unloaded = false;

        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    // ------------------------------------------------------------------ setup

    async onReady() {
        // Objects first: the adapter may stop right after this and ioBroker still
        // expects the info channel to exist.
        await this.createObjects();
        await this.setStateAsync('info.connection', { val: false, ack: true });
        await this.setStateAsync('info.mqttConnection', { val: false, ack: true });

        const host = (this.config.host || '').trim();
        if (!host) {
            this.log.error('No soundbar IP address configured - stopping.');
            return;
        }

        this.pollInterval = Math.max(2, Number(this.config.pollInterval) || 5) * 1000;

        this.api = new SoundbarApi({
            host,
            port: Number(this.config.port) || 1516,
            timeout: (Number(this.config.timeout) || 8) * 1000,
            log: this.log,
        });

        if (this.config.mqttEnabled) {
            this.startMqtt();
        }

        this.subscribeStates('device.*');
        this.subscribeStates('control.*');

        this.log.info(`Connecting to Samsung soundbar at ${host}:${this.config.port || 1516}`);
        this.poll();
    }

    async createObjects() {
        for (const obj of OBJECTS) {
            await this.setObjectNotExistsAsync(obj._id, {
                type: obj.type,
                common: obj.common,
                native: obj.native || {},
            });
        }
    }

    startMqtt() {
        try {
            this.mqtt = new MqttBridge({
                config: this.config,
                log: this.log,
                onCommand: (key, value) => this.applyCommand(key, value),
            });
            this.mqtt.start();
            this.mqttWatch = this.setInterval(() => {
                this.setState('info.mqttConnection', { val: !!(this.mqtt && this.mqtt.connected), ack: true });
            }, 10000);
        } catch (e) {
            this.log.error(`MQTT bridge could not be started: ${e.message}`);
            this.mqtt = null;
        }
    }

    // ---------------------------------------------------------------- polling

    schedulePoll(delay) {
        if (this.unloaded) {
            return;
        }
        if (this.pollTimer) {
            this.clearTimeout(this.pollTimer);
        }
        this.pollTimer = this.setTimeout(() => this.poll(), delay === undefined ? this.pollInterval : delay);
    }

    async poll() {
        if (this.unloaded || !this.api) {
            return;
        }
        try {
            if (!this.identifier) {
                this.identifier = await this.api.getIdentifier();
                await this.setStateAsync('info.identifier', { val: this.identifier, ack: true });
                this.log.info(`Soundbar identified as ${this.identifier}`);
            }

            const state = await this.api.readAll();
            await this.publishState(state);

            if (this.backoff) {
                this.log.info('Soundbar reachable again');
            }
            this.backoff = 0;
            await this.setStateChangedAsync('info.connection', { val: true, ack: true });
            this.schedulePoll();
        } catch (e) {
            await this.handlePollError(e);
        }
    }

    async handlePollError(e) {
        await this.setStateChangedAsync('info.connection', { val: false, ack: true });

        // In standby the soundbar closes the control port; that is not an error.
        const offline = e.code === 'NET' || e.code === 'HTTP';
        if (offline) {
            await this.setStateChangedAsync('device.power', { val: false, ack: true });
            if (this.mqtt) {
                this.mqtt.publish('power', false);
            }
        }

        this.backoff = this.backoff ? Math.min(this.backoff * 2, MAX_BACKOFF) : this.pollInterval * 2;
        const level = this.backoff >= MAX_BACKOFF ? 'debug' : 'warn';
        this.log[level](`Poll failed (${e.code || 'ERR'}): ${e.message} - retry in ${Math.round(this.backoff / 1000)} s`);
        this.api.token = null;
        this.schedulePoll(this.backoff);
    }

    async publishState(state) {
        for (const key of STATE_KEYS) {
            if (state[key] === undefined || Number.isNaN(state[key])) {
                continue;
            }
            await this.setStateChangedAsync(`device.${key}`, { val: state[key], ack: true });
        }
        this.lastState = { ...this.lastState, ...state };
        if (this.mqtt) {
            this.mqtt.publishSnapshot(state);
        }
    }

    /** Re-read shortly after a command so states and MQTT reflect reality. */
    scheduleRefresh() {
        if (this.refreshTimer) {
            this.clearTimeout(this.refreshTimer);
        }
        this.refreshTimer = this.setTimeout(() => this.poll(), 700);
    }

    // --------------------------------------------------------------- commands

    async applyCommand(key, value) {
        if (!this.api) {
            throw new Error('adapter not ready');
        }
        switch (key) {
            case 'power':
                await this.api.setPower(value);
                break;
            case 'volume':
                await this.api.setVolume(value);
                break;
            case 'mute':
                if (value === 'toggle') {
                    await this.api.sendKey('MUTE');
                } else {
                    await this.api.setMute(value);
                }
                break;
            case 'input':
                await this.api.setInput(value);
                break;
            case 'soundMode':
                await this.api.setSoundMode(value);
                break;
            case 'remoteKey':
                await this.api.sendKey(value);
                break;
            default:
                throw new Error(`unknown command "${key}"`);
        }
        this.log.debug(`command ${key}=${value} accepted`);
        this.scheduleRefresh();
    }

    async onStateChange(id, state) {
        if (!state || state.ack) {
            return;
        }
        const local = id.slice(this.namespace.length + 1);

        try {
            if (BUTTONS[local]) {
                await this.applyCommand('remoteKey', BUTTONS[local]);
                return;
            }
            if (local === 'control.remoteKey') {
                await this.applyCommand('remoteKey', state.val);
                await this.setStateAsync(local, { val: state.val, ack: true });
                return;
            }
            if (local.startsWith('device.')) {
                const key = local.slice('device.'.length);
                if (key === 'codec') {
                    return;
                }
                await this.applyCommand(key, state.val);
                await this.setStateAsync(local, { val: state.val, ack: true });
            }
        } catch (e) {
            this.log.warn(`Command from ${local} failed: ${e.message}`);
            // Roll the state back to what the device actually reports.
            this.scheduleRefresh();
        }
    }

    // ----------------------------------------------------------------- unload

    async onUnload(callback) {
        this.unloaded = true;
        try {
            if (this.pollTimer) {
                this.clearTimeout(this.pollTimer);
            }
            if (this.refreshTimer) {
                this.clearTimeout(this.refreshTimer);
            }
            if (this.mqttWatch) {
                this.clearInterval(this.mqttWatch);
            }
            if (this.mqtt) {
                await this.mqtt.stop();
            }
            if (this.api) {
                this.api.destroy();
            }
            await this.setStateAsync('info.connection', { val: false, ack: true });
            await this.setStateAsync('info.mqttConnection', { val: false, ack: true });
        } catch (e) {
            // nothing sensible left to do during shutdown
        }
        callback();
    }
}

if (require.main !== module) {
    module.exports = options => new SamsungSoundbar(options);
} else {
    new SamsungSoundbar();
}
