'use strict';

const dgram = require('dgram');

const MAC_RE = /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i;

/** Build the 102-byte magic packet: 6x 0xFF followed by the MAC 16 times. */
function magicPacket(mac) {
    const clean = mac.replace(/[:-]/g, '');
    const addr = Buffer.from(clean, 'hex');
    const packet = Buffer.alloc(6 + 16 * 6, 0xff);
    for (let i = 0; i < 16; i++) {
        addr.copy(packet, 6 + i * 6);
    }
    return packet;
}

function isValidMac(mac) {
    return MAC_RE.test(String(mac || '').trim());
}

/**
 * Send a Wake-on-LAN packet to the broadcast address on ports 9 and 7.
 * The soundbar closes its control port in standby, so this is the only way
 * to switch it on from the network.
 */
function wake(mac, options = {}) {
    if (!isValidMac(mac)) {
        return Promise.reject(new Error(`invalid MAC address "${mac}"`));
    }
    const address = options.address || '255.255.255.255';
    const ports = options.ports || [ 9, 7 ];
    const packet = magicPacket(mac.trim());

    return new Promise((resolve, reject) => {
        const socket = dgram.createSocket('udp4');
        socket.once('error', err => {
            socket.close();
            reject(err);
        });
        socket.bind(() => {
            socket.setBroadcast(true);
            let pending = ports.length;
            for (const port of ports) {
                socket.send(packet, 0, packet.length, port, address, err => {
                    if (err) {
                        socket.close();
                        return reject(err);
                    }
                    if (--pending === 0) {
                        socket.close();
                        resolve();
                    }
                });
            }
        });
    });
}

module.exports = { wake, magicPacket, isValidMac };
