#!/usr/bin/env node
'use strict';

/**
 * Offline unit test of the MQTT bridge: payload formatting, change detection and
 * command parsing. No broker and no soundbar needed.
 *   node tools/mqtt-test.js
 */

const { MqttBridge } = require('../lib/mqtt-bridge');
const { nameToNum, numToName, SOUND_MODES, INPUT_SOURCES, CODECS } = require('../lib/objects');
const wol = require('../lib/wol');

const log = { debug() {}, info() {}, warn() {}, error() {} };
let failures = 0;

function check(name, cond) {
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
    if (!cond) {
        failures++;
    }
}

function makeBridge(config) {
    const published = [];
    const commands = [];
    const bridge = new MqttBridge({
        config: { mqttUrl: 'mqtt://127.0.0.1:1883', mqttBaseTopic: 'samsung/test', ...config },
        log,
        onCommand: (key, value) => commands.push([ key, value ]),
    });
    // stub the network layer
    bridge.connected = true;
    bridge.client = { publish: (topic, payload) => published.push([ topic, payload ]) };
    return { bridge, published, commands };
}

// ---- publishing -------------------------------------------------------------
{
    const { bridge, published } = makeBridge({ mqttBoolFormat: '1/0', mqttPublishJson: true });
    const snapshot = { power: true, volume: 11, mute: false, input: 'E_ARC', soundMode: 'ADAPTIVE', codec: 'PCM' };
    bridge.publishSnapshot(snapshot);
    const map = Object.fromEntries(published);

    check('boolean format 1/0', map['samsung/test/power'] === '1' && map['samsung/test/mute'] === '0');
    check('number published as plain value', map['samsung/test/volume'] === '11');
    check('string published verbatim', map['samsung/test/input'] === 'E_ARC');
    check('json topic present', JSON.parse(map['samsung/test/state']).soundMode === 'ADAPTIVE');

    const countBefore = published.length;
    bridge.publishSnapshot(snapshot);
    check('unchanged values are not republished', published.length === countBefore);

    bridge.publishSnapshot({ ...snapshot, volume: 12 });
    const volumeMsgs = published.filter(p => p[0] === 'samsung/test/volume');
    check('changed value is republished', volumeMsgs.length === 2 && volumeMsgs[1][1] === '12');
    check('only the changed key went out', published.length === countBefore + 2); // volume + json
}

// ---- boolean formats --------------------------------------------------------
{
    const { bridge, published } = makeBridge({ mqttBoolFormat: 'ON/OFF' });
    bridge.publish('power', true);
    check('ON/OFF format', published[0][1] === 'ON');
}
{
    const { bridge, published } = makeBridge({});
    bridge.publish('power', false);
    check('default true/false format', published[0][1] === 'false');
}

// ---- commands ---------------------------------------------------------------
{
    const { bridge, commands } = makeBridge({});
    bridge._onMessage('samsung/test/volume/set', '14');
    bridge._onMessage('samsung/test/power/set', 'ON');
    bridge._onMessage('samsung/test/mute/set', 'toggle');
    bridge._onMessage('samsung/test/remoteKey/set', 'WOOFER_PLUS');
    bridge._onMessage('samsung/test/set', JSON.stringify({ soundMode: 'NIGHT', volume: 9 }));
    bridge._onMessage('samsung/test/nonsense/set', 'x');
    bridge._onMessage('samsung/test/volume/set', 'abc');

    const values = key => commands.filter(c => c[0] === key).map(c => c[1]);
    check('volume parsed as number', values('volume')[0] === 14);
    check('power parsed as boolean', values('power')[0] === true);
    check('mute toggle passed through', values('mute')[0] === 'toggle');
    check('remote key passed through', values('remoteKey')[0] === 'WOOFER_PLUS');
    check('json command object handled', values('soundMode')[0] === 'NIGHT' && values('volume')[1] === 9);
    check('unknown key ignored', commands.every(c => c[0] !== 'nonsense'));
    check('unparsable number ignored', values('volume').length === 2);
}

// ---- numeric enum mapping ---------------------------------------------------
{
    check('sound mode name -> number', nameToNum(SOUND_MODES, 'ADAPTIVE') === 3 && nameToNum(SOUND_MODES, 'STANDARD') === 0);
    check('input name -> number', nameToNum(INPUT_SOURCES, 'E_ARC') === 0 && nameToNum(INPUT_SOURCES, 'BT') === 4);
    check('unknown name -> -1', nameToNum(SOUND_MODES, 'MOVIE') === -1);
    check('number -> name', numToName(SOUND_MODES, 2) === 'GAME' && numToName(INPUT_SOURCES, 1) === 'HDMI_IN1');
    check('out of range -> null', numToName(SOUND_MODES, 99) === null && numToName(SOUND_MODES, -1) === null);
    check('round trip', numToName(INPUT_SOURCES, nameToNum(INPUT_SOURCES, 'D_IN')) === 'D_IN');
}

// ---- numeric enum over MQTT -------------------------------------------------
{
    const { bridge, commands, published } = makeBridge({});
    bridge._onMessage('samsung/test/soundModeNum/set', '3');
    bridge._onMessage('samsung/test/inputNum/set', '0');
    bridge._onMessage('samsung/test/soundModeNum/set', 'NIGHT');
    check('soundModeNum parsed as number', commands[0][0] === 'soundModeNum' && commands[0][1] === 3);
    check('inputNum parsed as number', commands[1][0] === 'inputNum' && commands[1][1] === 0);
    check('non-numeric enum payload ignored', commands.length === 2);

    bridge.publishSnapshot({ soundMode: 'ADAPTIVE', soundModeNum: 3, input: 'E_ARC', inputNum: 0 });
    const map = Object.fromEntries(published);
    check('numeric enums published', map['samsung/test/soundModeNum'] === '3' && map['samsung/test/inputNum'] === '0');
}

// ---- volumeStep + codec over MQTT -------------------------------------------
{
    const { bridge, commands } = makeBridge({});
    bridge._onMessage('samsung/test/volumeStep/set', '3');
    bridge._onMessage('samsung/test/volumeStep/set', '-2');
    bridge._onMessage('samsung/test/volumeStep/set', '+4');
    check('positive step', commands[0][0] === 'volumeStep' && commands[0][1] === 3);
    check('negative step', commands[1][1] === -2);
    check('explicit plus sign', commands[2][1] === 4);
    check('codec numbering stable', nameToNum(CODECS, 'PCM') === 0 && numToName(CODECS, 4) === 'DOLBY_ATMOS');
    check('unknown codec -> -1', nameToNum(CODECS, 'SOMETHING_NEW') === -1);
}

// ---- wake-on-lan packet -----------------------------------------------------
{
    const packet = wol.magicPacket('8c:79:f5:aa:bb:cc');
    check('magic packet is 102 bytes', packet.length === 102);
    check('magic packet header', packet.subarray(0, 6).every(b => b === 0xff));
    check('mac repeated 16 times', packet.subarray(6, 12).toString('hex') === '8c79f5aabbcc'
        && packet.subarray(96, 102).toString('hex') === '8c79f5aabbcc');
    check('mac validation', wol.isValidMac('8C-79-F5-AA-BB-CC') && !wol.isValidMac('8c:79:f5:aa:bb') && !wol.isValidMac(''));
}

// ---- broker url normalisation ----------------------------------------------
{
    const n = MqttBridge.normaliseUrl;
    check('bare host gets mqtt:// prefix', n('192.168.0.5') === 'mqtt://192.168.0.5');
    check('host:port gets prefix', n(' 192.168.0.5:1883 ') === 'mqtt://192.168.0.5:1883');
    check('full url untouched', n('mqtts://broker.lan:8883') === 'mqtts://broker.lan:8883');
    check('ws url untouched', n('ws://broker.lan:9001') === 'ws://broker.lan:9001');
    check('empty stays empty', n('  ') === '');
}

console.log(failures ? `\n${failures} FAILED` : '\nall green');
process.exit(failures ? 1 : 0);
