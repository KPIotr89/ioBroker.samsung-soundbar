'use strict';

const utils = require('@iobroker/adapter-core');
const { SoundbarApi } = require('./lib/api');
const { MqttBridge } = require('./lib/mqtt-bridge');
const {
    OBJECTS,
    BUTTONS,
    SOUND_MODES,
    INPUT_SOURCES,
    nameToNum,
    numToName,
} = require('./lib/objects');
const { classifyCodec } = require('./lib/codecs');
const wol = require('./lib/wol');

const STATE_KEYS = [
    'power',
    'volume',
    'mute',
    'input',
    'inputNum',
    'soundMode',
    'soundModeNum',
    'codec',
    'codecNum',
    'codecFamily',
    'atmos',
];
const VOLUME_WRITE_DELAY = 200; // coalesce bursts from a Loxone slider/encoder
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
        this.volumeTimer = null;
        this.pendingVolume = null;

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
        this.standbyInterval = Math.max(5, Number(this.config.pollIntervalStandby) || 30) * 1000;
        this.maxVolume = Math.min(100, Math.max(1, Number(this.config.maxVolume) || 100));
        if (this.maxVolume < 100) {
            this.log.info(`Volume is capped at ${this.maxVolume}`);
            await this.extendObjectAsync('device.volume', { common: { max: this.maxVolume } });
        }

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
        const base = this.lastState.power === false ? this.standbyInterval : this.pollInterval;
        this.pollTimer = this.setTimeout(() => this.poll(), delay === undefined ? base : delay);
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

    /** Mirror both enums as numbers - Loxone handles analog values far better. */
    static withNumericEnums(state) {
        const codec = classifyCodec(state.codec);
        return {
            ...state,
            inputNum: nameToNum(INPUT_SOURCES, state.input),
            soundModeNum: nameToNum(SOUND_MODES, state.soundMode),
            codecNum: codec.num,
            codecFamily: codec.family || '',
            atmos: codec.atmos,
        };
    }

    async publishState(raw) {
        const state = SamsungSoundbar.withNumericEnums(raw);
        for (const key of STATE_KEYS) {
            if (state[key] === undefined || Number.isNaN(state[key])) {
                continue;
            }
            await this.setStateChangedAsync(`device.${key}`, { val: state[key], ack: true });
        }
        if (this.expected) {
            const { key, value, raw } = this.expected;
            const wanted = raw.endsWith('Num')
                ? numToName(key === 'input' ? INPUT_SOURCES : SOUND_MODES, value)
                : value;
            if (wanted && state[key] !== wanted) {
                this.log.warn(
                    `Soundbar acknowledged ${key}=${wanted} but reports ${state[key]} - value not available for the current source`,
                );
            }
            this.expected = null;
        }
        if (state.codecNum === 10 && this.lastState.codec !== state.codec) {
            this.log.info(`Codec "${state.codec}" matches no known family - please report it`);
        }

        const stamp = Math.round(Date.now() / 1000);
        await this.setStateAsync('info.lastUpdate', { val: stamp, ack: true });

        this.lastState = { ...this.lastState, ...state };
        if (this.mqtt) {
            this.mqtt.publishSnapshot({ ...state, lastUpdate: stamp });
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

    /**
     * Switch on. When the soundbar is in standby it closes port 1516, so the
     * only way in is a Wake-on-LAN packet.
     */
    async powerOn(on) {
        try {
            await this.api.setPower(on);
        } catch (e) {
            const unreachable = e.code === 'NET' || e.code === 'HTTP' || e.code === 'TOKEN';
            if (!on || !unreachable || !this.config.wolEnabled) {
                throw e;
            }
            if (!wol.isValidMac(this.config.wolMac)) {
                throw new Error('soundbar unreachable and no valid MAC for Wake-on-LAN configured');
            }
            await wol.wake(this.config.wolMac, { address: this.config.wolBroadcast || undefined });
            this.log.info(`Soundbar unreachable - Wake-on-LAN packet sent to ${this.config.wolMac}`);
        }
    }

    /**
     * Coalesce volume writes: a Loxone slider or encoder produces a burst of
     * values and the soundbar drops requests that arrive in parallel.
     */
    queueVolume(level) {
        const wanted = Math.round(Number(level));
        if (!Number.isFinite(wanted)) {
            throw new Error(`volume "${level}" is not a number`);
        }
        const clamped = Math.min(this.maxVolume, Math.max(0, wanted));
        if (clamped !== wanted) {
            this.log.info(`Volume ${wanted} clamped to ${clamped}`);
        }
        this.pendingVolume = clamped;

        if (this.volumeTimer) {
            return;
        }
        this.volumeTimer = this.setTimeout(async () => {
            this.volumeTimer = null;
            const value = this.pendingVolume;
            this.pendingVolume = null;
            try {
                await this.api.setVolume(value);
                this.scheduleRefresh();
            } catch (e) {
                this.log.warn(`Setting volume to ${value} failed: ${e.message}`);
                this.scheduleRefresh();
            }
        }, VOLUME_WRITE_DELAY);
    }

    async applyCommand(key, value) {
        if (!this.api) {
            throw new Error('adapter not ready');
        }
        switch (key) {
            case 'power':
                await this.powerOn(value);
                break;
            case 'volume':
                this.queueVolume(value);
                break;
            case 'volumeStep': {
                const delta = Number(value);
                if (!Number.isFinite(delta) || !delta) {
                    throw new Error(`volumeStep "${value}" is not a non-zero number`);
                }
                const current = this.pendingVolume !== null ? this.pendingVolume : this.lastState.volume;
                if (typeof current !== 'number') {
                    throw new Error('current volume unknown yet');
                }
                this.queueVolume(current + delta);
                break;
            }
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
            case 'inputNum': {
                const name = numToName(INPUT_SOURCES, value);
                if (!name) {
                    throw new Error(`inputNum ${value} is out of range 0-${INPUT_SOURCES.length - 1}`);
                }
                await this.api.setInput(name);
                break;
            }
            case 'soundMode':
                await this.api.setSoundMode(value);
                break;
            case 'soundModeNum': {
                const name = numToName(SOUND_MODES, value);
                if (!name) {
                    throw new Error(`soundModeNum ${value} is out of range 0-${SOUND_MODES.length - 1}`);
                }
                await this.api.setSoundMode(name);
                break;
            }
            case 'remoteKey':
                await this.api.sendKey(value);
                break;
            default:
                throw new Error(`unknown command "${key}"`);
        }
        this.log.debug(`command ${key}=${value} accepted`);
        // Some values are acknowledged but silently ignored (a sound mode that
        // does not exist for the current source). Verify on the next read.
        if ([ 'input', 'inputNum', 'soundMode', 'soundModeNum' ].includes(key)) {
            this.expected = { key: key.replace('Num', ''), value, raw: key };
        }
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
            if (local === 'control.volumeStep') {
                await this.applyCommand('volumeStep', state.val);
                await this.setStateAsync(local, { val: state.val, ack: true });
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
            if (this.volumeTimer) {
                this.clearTimeout(this.volumeTimer);
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
