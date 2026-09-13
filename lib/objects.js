'use strict';

const { CODEC_FAMILIES } = require('./codecs');

// Values confirmed on HW-Q990F (2025). soundModeControl accepts exactly these;
// anything else is answered with {"success":false}.
// The array index is the numeric equivalent published as soundModeNum - keep the
// order stable, append new entries at the end only.
// MUSIC, DTS_VIRTUAL_X and NIGHT are answered with success:true but the device
// keeps the previous mode, so they are deliberately not offered here.
const SOUND_MODES = [ 'STANDARD', 'SURROUND', 'GAME', 'ADAPTIVE' ];

// Inputs verified by switching and reading back on HW-Q990F. "ARC" is accepted
// but collapses to E_ARC (same port), HDMI1/HDMI2/WIFI/USB are refused outright.
// Index = numeric equivalent published as inputNum.
const INPUT_SOURCES = [ 'E_ARC', 'HDMI_IN1', 'HDMI_IN2', 'D_IN', 'BT' ];

const REMOTE_KEYS = [ 'VOL_UP', 'VOL_DOWN', 'MUTE', 'WOOFER_PLUS', 'WOOFER_MINUS' ];


// Numeric <-> name mapping. Loxone talks analog values far more comfortably
// than strings, so every enum is mirrored as a number.
function nameToNum(list, name) {
    const index = list.indexOf(String(name));
    return index < 0 ? -1 : index;
}

function numToName(list, num) {
    const index = Number(num);
    return Number.isInteger(index) && index >= 0 && index < list.length ? list[index] : null;
}

function listToStates(list) {
    const states = {};
    for (const item of list) {
        states[item] = item;
    }
    return states;
}

function listToNumStates(list) {
    const states = {};
    list.forEach((item, index) => {
        states[index] = item;
    });
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
        _id: 'device.inputNum',
        type: 'state',
        common: {
            name: 'Input source (numeric)',
            type: 'number',
            role: 'level.mode',
            read: true,
            write: true,
            min: -1,
            max: INPUT_SOURCES.length - 1,
            states: listToNumStates(INPUT_SOURCES),
            def: -1,
        },
        native: {},
    },
    {
        _id: 'device.soundModeNum',
        type: 'state',
        common: {
            name: 'Sound mode (numeric)',
            type: 'number',
            role: 'level.mode',
            read: true,
            write: true,
            min: -1,
            max: SOUND_MODES.length - 1,
            states: listToNumStates(SOUND_MODES),
            def: -1,
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
        _id: 'device.codecNum',
        type: 'state',
        common: {
            name: 'Current codec family (numeric)',
            type: 'number',
            role: 'level.mode',
            read: true,
            write: false,
            min: -1,
            max: CODEC_FAMILIES.length - 1,
            states: listToNumStates(CODEC_FAMILIES),
            def: -1,
        },
        native: {},
    },
    {
        _id: 'device.codecFamily',
        type: 'state',
        common: {
            name: 'Current codec family',
            type: 'string',
            role: 'text',
            read: true,
            write: false,
            states: listToStates(CODEC_FAMILIES),
            def: '',
        },
        native: {},
    },
    {
        _id: 'device.atmos',
        type: 'state',
        common: { name: 'Dolby Atmos stream', type: 'boolean', role: 'indicator', read: true, write: false, def: false },
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
        _id: 'control.volumeStep',
        type: 'state',
        common: {
            name: 'Relative volume change (e.g. 3 or -2)',
            type: 'number',
            role: 'level.volume',
            read: false,
            write: true,
            min: -100,
            max: 100,
            def: 0,
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
        _id: 'info.lastUpdate',
        type: 'state',
        common: {
            name: 'Last successful read (unix time, s)',
            type: 'number',
            role: 'date',
            read: true,
            write: false,
            def: 0,
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

module.exports = {
    OBJECTS,
    BUTTONS,
    SOUND_MODES,
    INPUT_SOURCES,
    REMOTE_KEYS,
    CODEC_FAMILIES,
    nameToNum,
    numToName,
};
