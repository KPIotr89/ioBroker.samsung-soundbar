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
npm i https://github.com/KPIotr89/ioBroker.samsung-soundbar/tarball/main
iobroker add samsung-soundbar
```

Albo w Adminie: *Adaptery → Instaluj z własnego URL → adres repozytorium GitHub*.

## Konfiguracja

| Pole | Domyślnie | Opis |
|---|---|---|
| Adres IP soundbara | — | np. `192.168.0.214` |
| Port | `1516` | port API IP-control |
| Odpytywanie | `5 s` | API nie ma powiadomień push, stan jest odpytywany |
| Odpytywanie w standby | `30 s` | gdy soundbar jest wyłączony |
| Timeout | `8 s` | limit pojedynczego żądania HTTPS |
| Maksymalna głośność | `100` | twardy limit dla komend z automatyki |
| Wake-on-LAN | wył. | MAC soundbara; w standby port 1516 jest zamknięty |
| Most MQTT | wył. | publikacja stanu i przyjmowanie komend |
| Format wartości logicznych | `true/false` | do wyboru `1/0` albo `ON/OFF` (wygodne dla Loxone) |

## Stany (ioBroker)

| Obiekt | Typ | R/W | Uwagi |
|---|---|---|---|
| `device.power` | boolean | rw | `powerOn` / `powerOff` |
| `device.volume` | number 0–100 | rw | zapis ustawia wartość bezpośrednio |
| `device.mute` | boolean | rw | |
| `device.input` | string | rw | `E_ARC`, `HDMI_IN1`, `HDMI_IN2`, `D_IN`, `BT` |
| `device.inputNum` | number | rw | 0 = `E_ARC`, 1 = `HDMI_IN1`, 2 = `HDMI_IN2`, 3 = `D_IN`, 4 = `BT`, −1 = nieznane |
| `device.soundMode` | string | rw | `STANDARD`, `SURROUND`, `GAME`, `ADAPTIVE` |
| `device.soundModeNum` | number | rw | 0 = `STANDARD`, 1 = `SURROUND`, 2 = `GAME`, 3 = `ADAPTIVE`, −1 = nieznane |
| `device.codec` | string | r | surowa nazwa z urządzenia, np. `MAT_PCM_ATMOS`, `PCM` |
| `device.codecFamily` | string | r | rodzina po klasyfikacji, np. `DOLBY_ATMOS` |
| `device.codecNum` | number | r | 0 = `PCM`, 1 = `DOLBY_DIGITAL`, 2 = `DOLBY_DIGITAL_PLUS`, 3 = `DOLBY_TRUEHD`, 4 = `DOLBY_ATMOS`, 5 = `DTS`, 6 = `DTS_HD`, 7 = `DTS_X`, 8 = `AAC`, 9 = `MP3`, 10 = `OTHER` (trafia do logu), −1 = brak |
| `device.atmos` | boolean | r | strumień Atmos — gotowa ikona do wizualizacji |
| `control.volumeStep` | number | w | zmiana względna, np. `3` albo `-2` |
| `control.remoteKey` | string | w | `VOL_UP`, `VOL_DOWN`, `MUTE`, `WOOFER_PLUS`, `WOOFER_MINUS` |
| `control.volumeUp` / `volumeDown` / `muteToggle` / `wooferUp` / `wooferDown` | button | w | skróty do `remoteKey` |
| `info.connection` | boolean | r | soundbar osiągalny |
| `info.mqttConnection` | boolean | r | broker osiągalny |
| `info.identifier` | string | r | np. `22_AV_HW-Q990F` |
| `info.lastUpdate` | number | r | czas ostatniego udanego odczytu (unix, s) — watchdog dla Loxone |

## MQTT

Topic bazowy domyślnie `samsung/soundbar`.

**Publikacja** (retain, tylko przy zmianie):

```
samsung/soundbar/connected    true
samsung/soundbar/power        true
samsung/soundbar/volume       11
samsung/soundbar/mute         false
samsung/soundbar/input        E_ARC
samsung/soundbar/inputNum     0
samsung/soundbar/soundMode    ADAPTIVE
samsung/soundbar/soundModeNum 3
samsung/soundbar/codec        MAT_PCM_ATMOS
samsung/soundbar/codecFamily  DOLBY_ATMOS
samsung/soundbar/codecNum     4
samsung/soundbar/atmos        true
samsung/soundbar/lastUpdate   1757707200
samsung/soundbar/state        {"power":true,"volume":11,...}   # opcjonalnie
```

`connected` jest jednocześnie LWT — przy padzie adaptera broker sam ustawi `false`.

**Komendy:**

```
samsung/soundbar/volume/set      14
samsung/soundbar/power/set       false        # true/1/on/ON także działają
samsung/soundbar/mute/set        toggle
samsung/soundbar/input/set       E_ARC
samsung/soundbar/inputNum/set    1
samsung/soundbar/soundMode/set   GAME
samsung/soundbar/soundModeNum/set 2
samsung/soundbar/volumeStep/set  -2
samsung/soundbar/remoteKey/set   WOOFER_PLUS
samsung/soundbar/set             {"power":true,"volume":12,"soundMode":"MUSIC"}
```

Po każdej komendzie adapter odpytuje urządzenie po 700 ms i publikuje faktyczny stan —
jeśli soundbar odrzuci wartość, topic wróci do rzeczywistości zamiast kłamać.

Zapisy głośności są zbierane w oknie 200 ms i wysyłana jest tylko ostatnia wartość, więc
suwak albo enkoder w Loxone nie zaleje urządzenia żądaniami (soundbar gubi równoległe
wywołania i odpowiada HTTP 400).

### Loxone

W Loxone MQTT Gateway wystarczy subskrypcja `samsung/soundbar/#`. Dla wirtualnych wejść
cyfrowych najwygodniejszy jest format `1/0` (konfiguracja instancji → MQTT).

Wejście i tryb dźwięku mają odpowiedniki numeryczne (`inputNum`, `soundModeNum`), więc
wpinasz je wprost w wirtualne wejścia analogowe i wybierasz np. selektorem stanów —
bez parsowania tekstu w Loxone. Komendy wysyłasz wirtualnym wyjściem MQTT na
`samsung/soundbar/inputNum/set` z payloadem `<n>`. Wartość −1 oznacza, że soundbar
zgłosił nazwę spoza listy.

`info.lastUpdate` to unix timestamp ostatniego udanego odczytu — w Loxone wystarczy blok
porównania z czasem systemowym, żeby dostać alarm, gdy soundbar przestanie odpowiadać.
`connected` (LWT) wyłapuje tylko pad adaptera, nie zawieszenie urządzenia.

Do ściszania/podgłaśniania przyciskiem najwygodniejszy jest `volumeStep` — wysyłasz `3`
albo `-2` zamiast liczyć wartość docelową w bloku.

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
- część wartości jest **potwierdzana, ale ignorowana**: `MUSIC`, `DTS_VIRTUAL_X` i `NIGHT`
  zwracają `success:true`, a tryb się nie zmienia; `ARC` zwija się do `E_ARC` (ten sam port).
  Dlatego adapter po każdej komendzie odczytuje stan i loguje ostrzeżenie, gdy urządzenie
  zostało przy starej wartości
- nazwy wejść HDMI to `HDMI_IN1` / `HDMI_IN2` — `HDMI1`, `HDMI2`, `WIFI`, `USB`, `OPTICAL`
  są odrzucane

Nazwy kodeków są złożone i zależą od kontenera — po eARC Atmos przychodzi jako
`MAT_PCM_ATMOS` (Dolby MAT), nie `DOLBY_ATMOS`. Dlatego adapter klasyfikuje nazwę
wzorcem zamiast trzymać sztywną tabelę, a surowy string zostaje w `device.codec`.

Metody: `createAccessToken`, `powerControl`, `getVolume`, `volumeControl`, `getMute`,
`muteControl`, `inputSelectControl`, `soundModeControl`, `remoteKeyControl`, `getCodec`,
`getIdentifier`.

Nie istnieją (sprawdzone): night mode jako osobna metoda, voice amplifier, poziomy
pojedynczych głośników, EQ. Subwoofer tylko krokowo przez `WOOFER_PLUS` / `WOOFER_MINUS`.

## Standby i włączanie

W standby soundbar zamyka port 1516, więc `power/set true` nie ma jak dojść. Adapter
wykrywa ten przypadek i — jeśli Wake-on-LAN jest włączony, a MAC uzupełniony — wysyła
magic packet na porty 9 i 7. Wymaga, żeby broker/ioBroker był w tej samej podsieci albo
żeby router przepuszczał rozgłoszenia.

## Licencja

MIT © 2026 Piotr Kalbarczyk
