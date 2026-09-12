'use strict';

const mqtt = require('mqtt');

const COMMAND_KEYS = ['power', 'volume', 'mute', 'input', 'soundMode', 'remoteKey'];
const BOOL_FORMATS = {
    'true/false': [ 'true', 'false' ],
    '1/0': [ '1', '0' ],
    'ON/OFF': [ 'ON', 'OFF' ],
};

function parseBool(payload) {
    const v = String(payload).trim().toLowerCase();
    if ([ 'true', '1', 'on', 'yes', 'poweron' ].includes(v)) {
        return true;
    }
    if ([ 'false', '0', 'off', 'no', 'poweroff' ].includes(v)) {
        return false;
    }
    if (v === 'toggle') {
        return 'toggle';
    }
    return null;
}

/**
 * Native MQTT bridge: mirrors the soundbar state to flat topics and accepts
 * commands on <base>/<key>/set. Designed to be consumed directly by the
 * Loxone MQTT Gateway (flat topics, plain scalar payloads).
 */
class MqttBridge {
    constructor(options) {
        this.config = options.config;
        this.log = options.log;
        this.onCommand = options.onCommand;

        this.base = String(this.config.mqttBaseTopic || 'samsung/soundbar').replace(/\/+$/, '');
        this.qos = Number(this.config.mqttQos) || 0;
        this.retain = this.config.mqttRetain !== false;
        this.publishJson = Boolean(this.config.mqttPublishJson);
        const fmt = BOOL_FORMATS[this.config.mqttBoolFormat] || BOOL_FORMATS['true/false'];
        this.boolTrue = fmt[0];
        this.boolFalse = fmt[1];

        this.client = null;
        this.connected = false;
        this._last = {};
    }

    get availabilityTopic() {
        return `${this.base}/connected`;
    }

    start() {
        const url = String(this.config.mqttUrl || '').trim();
        if (!url) {
            throw new Error('MQTT broker URL is empty');
        }

        const options = {
            clientId: this.config.mqttClientId || `iobroker-samsung-soundbar-${Math.random().toString(16).slice(2, 8)}`,
            clean: true,
            reconnectPeriod: 10000,
            connectTimeout: 10000,
            will: {
                topic: this.availabilityTopic,
                payload: this.boolFalse,
                qos: this.qos,
                retain: this.retain,
            },
        };
        if (this.config.mqttUser) {
            options.username = this.config.mqttUser;
            options.password = this.config.mqttPassword || '';
        }

        this.client = mqtt.connect(url, options);

        this.client.on('connect', () => {
            this.connected = true;
            this.log.info(`MQTT connected to ${url} (base topic "${this.base}")`);
            const filters = [ `${this.base}/+/set`, `${this.base}/set` ];
            this.client.subscribe(filters, { qos: this.qos }, err => {
                if (err) {
                    this.log.error(`MQTT subscribe failed: ${err.message}`);
                } else {
                    this.log.debug(`MQTT subscribed: ${filters.join(', ')}`);
                }
            });
            this._raw(this.availabilityTopic, this.boolTrue);
            this._last = {}; // force a full republish after every reconnect
        });

        this.client.on('reconnect', () => this.log.debug('MQTT reconnecting'));
        this.client.on('close', () => {
            if (this.connected) {
                this.log.info('MQTT disconnected');
            }
            this.connected = false;
        });
        this.client.on('error', err => this.log.error(`MQTT error: ${err.message}`));
        this.client.on('message', (topic, payload) => this._onMessage(topic, payload.toString()));
    }

    _onMessage(topic, payload) {
        const rest = topic.slice(this.base.length + 1);
        this.log.debug(`MQTT in: ${topic} = ${payload}`);

        if (rest === 'set') {
            let obj;
            try {
                obj = JSON.parse(payload);
            } catch (e) {
                this.log.warn(`MQTT: payload on ${topic} is not JSON`);
                return;
            }
            for (const key of Object.keys(obj)) {
                this._dispatch(key, obj[key]);
            }
            return;
        }

        const key = rest.replace(/\/set$/, '');
        this._dispatch(key, payload);
    }

    _dispatch(key, rawValue) {
        if (!COMMAND_KEYS.includes(key)) {
            this.log.warn(`MQTT: unknown command key "${key}"`);
            return;
        }

        let value = rawValue;
        if (key === 'power' || key === 'mute') {
            value = typeof rawValue === 'boolean' ? rawValue : parseBool(rawValue);
            if (value === null) {
                this.log.warn(`MQTT: cannot parse boolean "${rawValue}" for ${key}`);
                return;
            }
        } else if (key === 'volume') {
            value = Number(rawValue);
            if (!Number.isFinite(value)) {
                this.log.warn(`MQTT: cannot parse number "${rawValue}" for volume`);
                return;
            }
        } else {
            value = String(rawValue).trim();
        }

        Promise.resolve(this.onCommand(key, value)).catch(e =>
            this.log.warn(`MQTT command ${key}=${value} failed: ${e.message}`),
        );
    }

    _raw(topic, payload) {
        if (!this.client || !this.connected) {
            return;
        }
        this.client.publish(topic, String(payload), { qos: this.qos, retain: this.retain });
    }

    _format(value) {
        if (typeof value === 'boolean') {
            return value ? this.boolTrue : this.boolFalse;
        }
        return value === null || value === undefined ? '' : String(value);
    }

    /** Publish a single value, skipping unchanged ones. */
    publish(key, value, force) {
        if (!this.connected) {
            return;
        }
        if (!force && this._last[key] === value) {
            return;
        }
        this._last[key] = value;
        this._raw(`${this.base}/${key}`, this._format(value));
    }

    /** Publish a whole state snapshot (plus the JSON topic when enabled). */
    publishSnapshot(state, force) {
        if (!this.connected) {
            return;
        }
        for (const key of Object.keys(state)) {
            this.publish(key, state[key], force);
        }
        if (this.publishJson) {
            const json = JSON.stringify(state);
            if (force || this._last.__json !== json) {
                this._last.__json = json;
                this._raw(`${this.base}/state`, json);
            }
        }
    }

    stop() {
        if (!this.client) {
            return Promise.resolve();
        }
        const client = this.client;
        this.client = null;
        return new Promise(resolve => {
            try {
                if (this.connected) {
                    client.publish(
                        this.availabilityTopic,
                        this.boolFalse,
                        { qos: this.qos, retain: this.retain },
                        () => client.end(false, {}, resolve),
                    );
                } else {
                    client.end(true, {}, resolve);
                }
            } catch (e) {
                resolve();
            }
            this.connected = false;
        });
    }
}

module.exports = { MqttBridge, COMMAND_KEYS, parseBool };
