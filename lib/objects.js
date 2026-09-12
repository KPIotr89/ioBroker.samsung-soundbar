'use strict';

// Values confirmed on HW-Q990F (2025). soundModeControl accepts exactly these;
// anything else is answered with {"success":false}.
const SOUND_MODES = [ 'STANDARD', 'SURROUND', 'GAME', 'MUSIC', 'DTS_VIRTUAL_X', 'ADAPTIVE', 'NIGHT' ];

// Input names as reported/accepted by inputSelectControl. E_ARC is what an
// HDMI-eARC connected TV reports; the rest follow Samsung's naming.
const INPUT_SOURCES = [ 'E_ARC', 'ARC', 'HDMI1', 'HDMI2', 'D_IN', 'BT', 'WIFI', 'USB' ];

const REMOTE_KEYS = [ 'VOL_UP', 'VOL_DOWN', 'MUTE', 'WOOFER_PLUS', 'WOOFER_MINUS' ];

function listToStates(list) {
    const states = {};
    for (const item of list) {
        states[item] = item;
    }
    return states;
}

const OBJECTS = [
    {
        _id: 'device',
        type: 'channel',
        common: { name: 'Soundbar state' },
        native: {},
    },
    {
        _id: 'device.power',
        type: 'state',
        common: { name: 'Power', type: 'boolean', role: 'switch.power', read: true, write: true, def: false },
        native: {},
    },
    {
        _id: 'device.volume',
        type: 'state',
        common: {
            name: 'Volume',
            type: 'number',
            role: 'level.volume',
            read: true,
            write: true,
            min: 0,
            max: 100,
            def: 0,
        },
        native: {},
    },
    {
        _id: 'device.mute',
        type: 'state',
        common: { name: 'Mute', type: 'boolean', role: 'media.mute', read: true, write: true, def: false },
        native: {},
    },
    {
        _id: 'device.input',
        type: 'state',
        common: {
            name: 'Input source',
            type: 'string',
            role: 'media.input',
            read: true,
            write: true,
            states: listToStates(INPUT_SOURCES),
            def: '',
        },
        native: {},
    },
    {
        _id: 'device.soundMode',
        type: 'state',
        common: {
            name: 'Sound mode',
            type: 'string',
            role: 'media.mode',
            read: true,
            write: true,
            states: listToStates(SOUND_MODES),
            def: '',
        },
        native: {},
    },
    {
        _id: 'device.codec',
        type: 'state',
        common: { name: 'Current codec', type: 'string', role: 'text', read: true, write: false, def: '' },
        native: {},
    },
    {
        _id: 'control',
        type: 'channel',
        common: { name: 'Remote control' },
        native: {},
    },
    {
        _id: 'control.remoteKey',
        type: 'state',
        common: {
            name: 'Send remote key',
            type: 'string',
            role: 'text',
            read: false,
            write: true,
            states: listToStates(REMOTE_KEYS),
            def: '',
        },
        native: {},
    },
    {
        _id: 'control.volumeUp',
        type: 'state',
        common: { name: 'Volume +1', type: 'boolean', role: 'button', read: false, write: true },
        native: { key: 'VOL_UP' },
    },
    {
        _id: 'control.volumeDown',
        type: 'state',
        common: { name: 'Volume -1', type: 'boolean', role: 'button', read: false, write: true },
        native: { key: 'VOL_DOWN' },
    },
    {
        _id: 'control.muteToggle',
        type: 'state',
        common: { name: 'Toggle mute', type: 'boolean', role: 'button', read: false, write: true },
        native: { key: 'MUTE' },
    },
    {
        _id: 'control.wooferUp',
        type: 'state',
        common: { name: 'Subwoofer +1', type: 'boolean', role: 'button', read: false, write: true },
        native: { key: 'WOOFER_PLUS' },
    },
    {
        _id: 'control.wooferDown',
        type: 'state',
        common: { name: 'Subwoofer -1', type: 'boolean', role: 'button', read: false, write: true },
        native: { key: 'WOOFER_MINUS' },
    },
    {
        _id: 'info',
        type: 'channel',
        common: { name: 'Information' },
        native: {},
    },
    {
        _id: 'info.connection',
        type: 'state',
        common: {
            name: 'Soundbar reachable',
            type: 'boolean',
            role: 'indicator.connected',
            read: true,
            write: false,
            def: false,
        },
        native: {},
    },
    {
        _id: 'info.mqttConnection',
        type: 'state',
        common: {
            name: 'MQTT broker connected',
            type: 'boolean',
            role: 'indicator.connected',
            read: true,
            write: false,
            def: false,
        },
        native: {},
    },
    {
        _id: 'info.identifier',
        type: 'state',
        common: { name: 'Device identifier', type: 'string', role: 'info.name', read: true, write: false, def: '' },
        native: {},
    },
];

// Button id -> remote key, derived from the object list above.
const BUTTONS = OBJECTS.filter(o => o.native && o.native.key).reduce((acc, o) => {
    acc[o._id] = o.native.key;
    return acc;
}, {});

module.exports = { OBJECTS, BUTTONS, SOUND_MODES, INPUT_SOURCES, REMOTE_KEYS };
