'use strict';

const https = require('https');

const DEFAULT_PORT = 1516;
const TOKEN_MIN_INTERVAL = 4000; // soundbar rate-limits createAccessToken
const REQUEST_GAP = 120; // ms between consecutive requests

/** Error raised by the soundbar client. code: TOKEN | RPC | HTTP | NET | REJECTED */
class SoundbarError extends Error {
    constructor(message, code, details) {
        super(message);
        this.name = 'SoundbarError';
        this.code = code || 'RPC';
        this.details = details;
    }
}

/**
 * Client for the local Samsung soundbar IP-control API.
 * Transport: HTTPS (self-signed cert) + JSON-RPC 2.0 on TCP 1516.
 * Verified on HW-Q990F (identifier 22_AV_HW-Q990F), firmware 2025/2026.
 */
class SoundbarApi {
    constructor(options = {}) {
        this.host = options.host;
        this.port = options.port || DEFAULT_PORT;
        this.timeout = options.timeout || 8000;
        this.log = options.log || { debug() {}, warn() {}, error() {} };

        this.token = null;
        this._lastTokenAt = 0;
        this._lastRequestAt = 0;
        this._chain = Promise.resolve();
        this._destroyed = false;

        this._agent = new https.Agent({
            keepAlive: true,
            maxSockets: 1,
            rejectUnauthorized: false,
        });
    }

    destroy() {
        this._destroyed = true;
        this._agent.destroy();
    }

    // --------------------------------------------------------------- transport

    _httpPost(body) {
        return new Promise((resolve, reject) => {
            const data = Buffer.from(body, 'utf8');
            const req = https.request(
                {
                    host: this.host,
                    port: this.port,
                    path: '/',
                    method: 'POST',
                    agent: this._agent,
                    rejectUnauthorized: false,
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'application/json',
                        'Content-Length': data.length,
                    },
                },
                res => {
                    const chunks = [];
                    res.on('data', c => chunks.push(c));
                    res.on('end', () =>
                        resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }),
                    );
                },
            );
            req.setTimeout(this.timeout, () => req.destroy(new Error('timeout')));
            req.on('error', err => reject(new SoundbarError(err.message, 'NET', err.code)));
            req.write(data);
            req.end();
        });
    }

    /** Serialise every request and keep a minimum gap - the soundbar drops parallel calls. */
    _enqueue(fn) {
        const run = async () => {
            const wait = REQUEST_GAP - (Date.now() - this._lastRequestAt);
            if (wait > 0) {
                await new Promise(r => setTimeout(r, wait));
            }
            try {
                return await fn();
            } finally {
                this._lastRequestAt = Date.now();
            }
        };
        this._chain = this._chain.then(run, run);
        return this._chain;
    }

    async _rpc(method, params) {
        const payload = { jsonrpc: '2.0', method, id: 1 };
        if (params && Object.keys(params).length) {
            payload.params = params;
        }
        const raw = JSON.stringify(payload);
        this.log.debug(`-> ${raw.replace(/"AccessToken":"[^"]+"/, '"AccessToken":"***"')}`);

        const res = await this._enqueue(() => this._httpPost(raw));
        this.log.debug(`<- [${res.status}] ${res.body}`);

        // Empty body + HTTP 400 is how the soundbar rejects a stale/missing token.
        if (res.status === 400) {
            throw new SoundbarError('token rejected by soundbar', 'TOKEN');
        }
        if (res.status !== 200) {
            throw new SoundbarError(`unexpected HTTP status ${res.status}`, 'HTTP', res.status);
        }
        if (!res.body) {
            throw new SoundbarError('empty response (rate limit?)', 'HTTP');
        }

        let data;
        try {
            data = JSON.parse(res.body);
        } catch (e) {
            throw new SoundbarError(`invalid JSON: ${res.body.slice(0, 120)}`, 'HTTP');
        }
        if (data.error) {
            throw new SoundbarError(data.error.message || 'rpc error', 'RPC', data.error.code);
        }
        // Unknown method names come back as a bare parse error object.
        if (data.code && data.message && !data.result) {
            throw new SoundbarError(data.message, 'RPC', data.code);
        }
        return data.result || {};
    }

    // ------------------------------------------------------------------ tokens

    async ensureToken(force) {
        if (this.token && !force) {
            return this.token;
        }
        const wait = TOKEN_MIN_INTERVAL - (Date.now() - this._lastTokenAt);
        if (wait > 0) {
            await new Promise(r => setTimeout(r, wait));
        }
        this._lastTokenAt = Date.now();
        const result = await this._rpc('createAccessToken', {});
        if (!result.AccessToken) {
            throw new SoundbarError('soundbar returned no AccessToken', 'TOKEN');
        }
        this.token = result.AccessToken;
        this.log.debug('new access token acquired');
        return this.token;
    }

    async call(method, params = {}) {
        if (method === 'createAccessToken') {
            return this._rpc(method, params);
        }
        await this.ensureToken(false);
        try {
            return await this._rpc(method, { ...params, AccessToken: this.token });
        } catch (e) {
            if (e.code !== 'TOKEN') {
                throw e;
            }
            this.log.debug('token expired - renewing');
            await this.ensureToken(true);
            return this._rpc(method, { ...params, AccessToken: this.token });
        }
    }

    /** Commands answer {success:true|false}; false means the device refused the value. */
    async _command(method, params, what) {
        const res = await this.call(method, params);
        if (res.success === false) {
            throw new SoundbarError(`soundbar refused ${what}`, 'REJECTED');
        }
        return res;
    }

    // ------------------------------------------------------------- read/write

    async getPower() {
        return (await this.call('powerControl')).power === 'powerOn';
    }

    async setPower(on) {
        return this._command('powerControl', { power: on ? 'powerOn' : 'powerOff' }, `power=${on}`);
    }

    async getVolume() {
        return parseInt((await this.call('getVolume')).volume, 10);
    }

    async setVolume(level) {
        const value = Math.round(Number(level));
        if (!Number.isFinite(value) || value < 0 || value > 100) {
            throw new SoundbarError('volume out of range 0-100', 'REJECTED');
        }
        // volumeControl expects a JSON number, a string is refused with -32602.
        return this._command('volumeControl', { volume: value }, `volume=${value}`);
    }

    async getMute() {
        return Boolean((await this.call('getMute')).mute);
    }

    async setMute(muted) {
        return this._command('muteControl', { mute: Boolean(muted) }, `mute=${muted}`);
    }

    async getInput() {
        return (await this.call('inputSelectControl')).inputSource;
    }

    async setInput(source) {
        return this._command('inputSelectControl', { inputSource: String(source) }, `input=${source}`);
    }

    async getSoundMode() {
        return (await this.call('soundModeControl')).soundMode;
    }

    async setSoundMode(mode) {
        return this._command('soundModeControl', { soundMode: String(mode) }, `soundMode=${mode}`);
    }

    async getCodec() {
        return (await this.call('getCodec')).codec || '';
    }

    async getIdentifier() {
        return (await this.call('getIdentifier')).identifier || '';
    }

    async sendKey(key) {
        return this._command('remoteKeyControl', { remoteKey: String(key) }, `key=${key}`);
    }

    /** Single consolidated read used by the polling loop. */
    async readAll() {
        const power = await this.getPower();
        const state = { power };
        state.volume = await this.getVolume();
        state.mute = await this.getMute();
        state.input = await this.getInput();
        state.soundMode = await this.getSoundMode();
        state.codec = await this.getCodec();
        return state;
    }
}

module.exports = { SoundbarApi, SoundbarError, DEFAULT_PORT };
