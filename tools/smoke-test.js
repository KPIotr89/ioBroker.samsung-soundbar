#!/usr/bin/env node
'use strict';

/**
 * Manual smoke test against a real soundbar - no ioBroker required.
 *   node tools/smoke-test.js 192.168.0.214
 * Reads everything, nudges the volume by +1 and restores it.
 */

const { SoundbarApi } = require('../lib/api');

const host = process.argv[2];
if (!host) {
    console.error('usage: node tools/smoke-test.js <ip> [--verbose]');
    process.exit(1);
}
const verbose = process.argv.includes('--verbose');
const log = {
    debug: m => verbose && console.log(`  . ${m}`),
    warn: m => console.warn(`  ! ${m}`),
    error: m => console.error(`  E ${m}`),
    info: m => console.log(`  i ${m}`),
};

(async () => {
    const api = new SoundbarApi({ host, log });
    const t0 = Date.now();
    console.log(`identifier : ${await api.getIdentifier()}   (${Date.now() - t0} ms)`);

    const state = await api.readAll();
    for (const [ k, v ] of Object.entries(state)) {
        console.log(`${k.padEnd(11)}: ${v}`);
    }

    const before = state.volume;
    console.log(`\nvolume ${before} -> ${before + 1} ...`);
    await api.setVolume(before + 1);
    await new Promise(r => setTimeout(r, 600));
    console.log(`read back  : ${await api.getVolume()}`);
    await api.setVolume(before);
    await new Promise(r => setTimeout(r, 600));
    console.log(`restored   : ${await api.getVolume()}`);

    console.log('\nrejection handling:');
    try {
        await api.setSoundMode('NOT_A_MODE');
        console.log('  unexpected success');
    } catch (e) {
        console.log(`  ${e.code}: ${e.message}`);
    }

    api.destroy();
    console.log('\nOK');
})().catch(e => {
    console.error(`FAILED [${e.code || 'ERR'}] ${e.message}`);
    process.exit(2);
});
