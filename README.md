# ioBroker.samsung-soundbar

Adapter ioBroker do **lokalnego** sterowania soundbarami Samsung (seria D z 2024 r. i nowsze,
potwierdzone na **HW-Q990F**) przez firmowe API IP-control, z **natywnym mostem MQTT**.

Bez chmury SmartThings, bez konta Samsung — cała komunikacja zostaje w LAN.
Zmierzona latencja pojedynczego wywołania: ~40 ms.

## Wymagania

- soundbar w sieci LAN z **włączonym sterowaniem IP** (Ustawienia → Sterowanie IP)
- ioBroker z js-controller ≥ 5.0.19, Node.js ≥ 18
- opcjonalnie broker MQTT (Mosquitto), jeśli most MQTT ma być używany

## Instalacja

```bash
cd /opt/iobroker
npm i https://github.com/piotrkalbarczyk/ioBroker.samsung-soundbar/tarball/main
iobroker add samsung-soundbar
```

Albo w Adminie: *Adaptery → Instaluj z własnego URL → adres repozytorium GitHub*.

## Konfiguracja

| Pole | Domyślnie | Opis |
|---|---|---|
| Adres IP soundbara | — | np. `192.168.0.214` |
| Port | `1516` | port API IP-control |
| Odpytywanie | `5 s` | API nie ma powiadomień push, stan jest odpytywany |
| Timeout | `8 s` | limit pojedynczego żądania HTTPS |
| Most MQTT | wył. | publikacja stanu i przyjmowanie komend |
| Format wartości logicznych | `true/false` | do wyboru `1/0` albo `ON/OFF` (wygodne dla Loxone) |

## Stany (ioBroker)

| Obiekt | Typ | R/W | Uwagi |
|---|---|---|---|
| `device.power` | boolean | rw | `powerOn` / `powerOff` |
| `device.volume` | number 0–100 | rw | zapis ustawia wartość bezpośrednio |
| `device.mute` | boolean | rw | |
| `device.input` | string | rw | `E_ARC`, `ARC`, `HDMI1`, `HDMI2`, `D_IN`, `BT`, `WIFI`, `USB` |
| `device.soundMode` | string | rw | `STANDARD`, `SURROUND`, `GAME`, `MUSIC`, `DTS_VIRTUAL_X`, `ADAPTIVE`, `NIGHT` |
| `device.codec` | string | r | np. `PCM`, `DOLBY_ATMOS` |
| `control.remoteKey` | string | w | `VOL_UP`, `VOL_DOWN`, `MUTE`, `WOOFER_PLUS`, `WOOFER_MINUS` |
| `control.volumeUp` / `volumeDown` / `muteToggle` / `wooferUp` / `wooferDown` | button | w | skróty do `remoteKey` |
| `info.connection` | boolean | r | soundbar osiągalny |
| `info.mqttConnection` | boolean | r | broker osiągalny |
| `info.identifier` | string | r | np. `22_AV_HW-Q990F` |

## MQTT

Topic bazowy domyślnie `samsung/soundbar`.

**Publikacja** (retain, tylko przy zmianie):

```
samsung/soundbar/connected    true
samsung/soundbar/power        true
samsung/soundbar/volume       11
samsung/soundbar/mute         false
samsung/soundbar/input        E_ARC
samsung/soundbar/soundMode    ADAPTIVE
samsung/soundbar/codec        PCM
samsung/soundbar/state        {"power":true,"volume":11,...}   # opcjonalnie
```

`connected` jest jednocześnie LWT — przy padzie adaptera broker sam ustawi `false`.

**Komendy:**

```
samsung/soundbar/volume/set      14
samsung/soundbar/power/set       false        # true/1/on/ON także działają
samsung/soundbar/mute/set        toggle
samsung/soundbar/input/set       E_ARC
samsung/soundbar/soundMode/set   NIGHT
samsung/soundbar/remoteKey/set   WOOFER_PLUS
samsung/soundbar/set             {"power":true,"volume":12,"soundMode":"MUSIC"}
```

Po każdej komendzie adapter odpytuje urządzenie po 700 ms i publikuje faktyczny stan —
jeśli soundbar odrzuci wartość, topic wróci do rzeczywistości zamiast kłamać.

### Loxone

W Loxone MQTT Gateway wystarczy subskrypcja `samsung/soundbar/#`. Dla wirtualnych wejść
najwygodniejszy jest format `1/0`. Komendy wysyłasz wirtualnym wyjściem MQTT na
`samsung/soundbar/volume/set` z payloadem `<v>`.

## Protokół (co udało się ustalić)

JSON-RPC 2.0 po **HTTPS** (certyfikat self-signed) na porcie **1516**:

```bash
curl -sk -X POST https://192.168.0.214:1516/ \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"createAccessToken","id":1}'
```

- `createAccessToken` nie wymaga potwierdzenia na urządzeniu, ale jest limitowane —
  odstęp poniżej ~4 s zwraca pustą odpowiedź
- token przekazuje się w `params.AccessToken`, jest wielokrotnego użytku
- nieprawidłowy/wygasły token → **HTTP 400 z pustym body** (nie błąd JSON-RPC)
- nieznana metoda → `-32601 Method not found`
- `volumeControl` wymaga liczby, nie stringa (string → `-32602 Invalid params`)
- błędna wartość enum → `{"success":false}` zamiast wyjątku

Metody: `createAccessToken`, `powerControl`, `getVolume`, `volumeControl`, `getMute`,
`muteControl`, `inputSelectControl`, `soundModeControl`, `remoteKeyControl`, `getCodec`,
`getIdentifier`.

Nie istnieją (sprawdzone): night mode jako osobna metoda, voice amplifier, poziomy
pojedynczych głośników, EQ. Subwoofer tylko krokowo przez `WOOFER_PLUS` / `WOOFER_MINUS`.

## Licencja

MIT © 2026 Piotr Kalbarczyk
