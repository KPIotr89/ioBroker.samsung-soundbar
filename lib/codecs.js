'use strict';

/**
 * The soundbar reports composite codec names (HW-Q990F over eARC sends
 * "MAT_PCM_ATMOS" for a Dolby MAT stream, "PCM" for plain stereo), so a fixed
 * lookup table does not work. Names are classified by pattern instead and the
 * raw string is always kept in device.codec.
 *
 * The numbers are the contract for Loxone - append new families at the end only.
 */
const CODEC_FAMILIES = [
    'PCM', // 0
    'DOLBY_DIGITAL', // 1
    'DOLBY_DIGITAL_PLUS', // 2
    'DOLBY_TRUEHD', // 3
    'DOLBY_ATMOS', // 4
    'DTS', // 5
    'DTS_HD', // 6
    'DTS_X', // 7
    'AAC', // 8
    'MP3', // 9
    'OTHER', // 10
];

// Evaluated in order - the first match wins, so Atmos beats its carrier format
// and the specific DTS variants beat plain DTS.
const RULES = [
    [ /ATMOS/, 4 ],
    [ /DTS[_ -]?X/, 7 ],
    [ /DTS[_ -]?HD/, 6 ],
    [ /DTS/, 5 ],
    [ /TRUE[_ -]?HD|(^|_)MAT(_|$)/, 3 ],
    [ /PLUS|\+|DDP|E[_ -]?AC3/, 2 ],
    [ /DOLBY|(^|_)DD(_|$)|AC3/, 1 ],
    [ /AAC/, 8 ],
    [ /MP3|MPEG/, 9 ],
    [ /PCM/, 0 ],
];

/**
 * @param {string} raw codec name as reported by getCodec
 * @returns {{num: number, family: string|null, atmos: boolean}}
 *          num is -1 when nothing was reported at all, 10 (OTHER) for a name
 *          that no rule matched - that one is worth reporting.
 */
function classifyCodec(raw) {
    const name = String(raw || '').trim().toUpperCase();
    if (!name) {
        return { num: -1, family: null, atmos: false };
    }
    for (const [ pattern, num ] of RULES) {
        if (pattern.test(name)) {
            return { num, family: CODEC_FAMILIES[num], atmos: num === 4 };
        }
    }
    return { num: 10, family: 'OTHER', atmos: false };
}

module.exports = { classifyCodec, CODEC_FAMILIES };
