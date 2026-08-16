# Tonescript

An alphabet where every character is a sound rather than a glyph.

Each of the 36 characters (A–Z, 0–9) is a pair of pure tones. There are two ways to
sound a message:

- **Whole word** — every letter of a word sounds *at once*, as a single chord. A
  word is one sound, not a string of beeps.
- **Letter by letter** — each character sounds in turn, spelled out. This is the
  DTMF principle behind touch-tone dialing, widened from 16 symbols to 36.

Both are decodable: type a message to hear it, then play it back at the microphone
to recover the text out of the air.

## Run it

```bash
npm start              # http://localhost:8080
```

No dependencies — plain Node, nothing to install.

```bash
node server.js --port 3000     # different port
node server.js --https         # TLS, for testing from another device
npm test                       # verify the codec
```

## Testing it

**On one machine.** Open the page, click **Listen**, then **Transmit**. Use
speakers, not headphones — the sound has to physically reach the microphone.

**Across two devices** is the better test, since it removes echo cancellation and
proves the signal survives a real acoustic path. This needs `--https`:

```bash
node server.js --https
```

Open the printed LAN address on the second device and accept the certificate
warning once. Transmit on one, listen on the other.

> **Why HTTPS is required here.** Browsers only expose `getUserMedia` in a secure
> context: HTTPS, or `localhost`. Over plain HTTP a LAN address will load the page
> fine but the microphone will never start. The certificate is self-signed and
> generated into `.cert/` on first use, so the browser warns once.

**Automated.** `npm test` extracts the decoder from `public/index.html` and runs it
against synthesized audio — 17 messages across 60–400 ms symbol rates and additive
noise, plus checks that silence and white noise decode to nothing. It exits
non-zero on failure.

## How it works

### Whole-word chords

Sounding a word's letters simultaneously is ambiguous if they all draw on the same
two banks: five letters put five row tones and five column tones in the air at once,
pairable 25 ways — and `LISTEN` and `SILENT` would be *the same sound*.

So **each position in the word gets its own pair of banks**. The first letter draws
from one set of twelve frequencies, the second from a different twelve, across five
slots — 60 distinct tones spanning 400–3600 Hz. No two positions share a frequency,
so overlapping letters never compete: the pairing is unambiguous, order survives, and
anagrams differ. Every letter rings for the full duration, so it is heard as one chord.

| | |
|---|---|
| Slots | 5 letters per chord (longer words chunk) |
| Banks | 60 tones, 400–3600 Hz, 12 per slot |
| Spacing | ≥ 15 Hz (2.6 bins at the analysis window) |
| Chord length | ≥ 380 ms |
| Analysis | 8192 samples, Hann-windowed, read once per chord |
| Slot occupied | ≥ 6% of the loudest slot, and 3× its own band |

Occupancy is judged *relative to the loudest slot* rather than an absolute floor. On
a clean signal an empty slot sits near zero, and any ratio taken against zero
explodes — an absolute threshold makes the decoder fail on perfect input while
working on noisy input.

### Letter by letter

| | |
|---|---|
| Row bank | 697 · 770 · 852 · 941 · 1041 · 1141 Hz |
| Column bank | 1209 · 1336 · 1477 · 1633 · 1789 · 1945 Hz |
| Alphabet | A–Z, 0–9 (36 = 6 × 6) |
| Symbol length | 60–400 ms, default 170 |
| Gap | 40% of symbol length |
| Envelope | 8 ms raised-cosine ramps |
| Detection | Goertzel, 12 bins |
| Window | 1024 samples, 512 hop |
| Accept | 6× median bin, both tones, 3 consecutive windows |

**Why two tones and not one.** One sine per letter is trivial to generate and very
hard to decode: 36 closely-spaced frequencies smear together, and a microphone
round trip fails. Tone *pairs* are widely separated and far more robust. The twelve
frequencies are also chosen so none is a whole-number multiple of another, so a
tone's distortion harmonics can never be mistaken for a different letter.

**Detection.** Twelve Goertzel filters, one per frequency — much cheaper than an
FFT when you already know the only twelve places a tone can be. Each candidate is
scored against the *median* bin: a real chord lights exactly two of twelve, so the
median stays at the noise floor and the ratio is meaningful. This is what keeps
room noise from spelling words.

**Word breaks** are the subtle part. The receiver does not assume a fixed rate; it
learns the sender's gap and symbol length from the signal, then calls a silence a
space if it is either much longer than a typical gap *or* longer than a whole
symbol. The second test exists because a message like `A B C` — where every silence
is a word break and no ordinary gap is ever transmitted — has no gap to compare
against.

## Layout

```
public/index.html      the whole app: encoder, decoder, UI
server.js              static server, no dependencies
test/chord.test.js     whole-word chord codec
test/decoder.test.js   letter-by-letter codec
```

The decoder is tested by extracting it from the shipped HTML rather than from a
copy, so the tests cannot pass against code that isn't the code being served.

## Limits

Testing uses synthetic additive noise, which is not the same as real room
acoustics — reverb, hard-wall echo, and speaker response distort tones in ways the
suite does not model. If decoding struggles in your room, raise **Level**, raise
**Rate** toward 250–300 ms, and move closer to the microphone. Longer symbols give
the detector more to integrate and are considerably more forgiving.
