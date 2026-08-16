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

Every tone is a real note of one scale — **A Dorian**, C4 to A7 — so whatever letters
sound together stack into a chord that belongs to a key, rather than a cluster of
arbitrary frequencies.

A letter is a **pair of notes**, and the interval identifies it. Nine notes give
exactly `C(9,2) = 36` pairs, one per character with none left over. Each position in
the word owns its own nine-note register, stacked low to high, so registers never
overlap and two letters can never claim the same note — the reading stays unambiguous
and anagrams still differ.

| | |
|---|---|
| Scale | A Dorian, C4–A7 (27 notes) |
| Slots | 3 letters per chord (longer words chunk) |
| Registers | 9 notes each, non-overlapping |
| Letter | a pair of notes; the interval carries it |
| Accent | a third note at 45% level |
| Timbre | triangle wave |
| Spacing | ≥ 22 Hz (3.8 bins at the analysis window) |
| Chord length | ≥ 380 ms |
| Analysis | 8192 samples, Hann-windowed, read once per chord |
| Slot occupied | ≥ 6% of the loudest slot, and 2.5× its own register |

The scale is deliberately gapped: its notes sit far enough apart to be separable at
the analysis window. A denser scale sounds richer and decodes worse — that trade is
what fixes the note count at 27, and so the slots at 3.

### Accents and languages

Supported: **English, French, Spanish, Portuguese, Italian, German, Swedish.**

Accented letters get no symbols of their own — there are exactly 36 pairs and no
spare, and widening the register to fit ~91 precomposed characters would need 14
notes per slot, collapsing the chord to a single letter.

Instead a letter decomposes (Unicode NFD) into an ASCII base plus a combining mark:
`É` is `E` + acute. The base uses its usual pair; the **mark rides on a third note**
from the same register, sounded at 45% level. Power scales as amplitude², so the
accent lands at ~20% of the pair's power — unmistakably present, but never loud
enough to be read as part of the letter. The decoder takes the two loudest notes as
the letter and a clear third as its accent.

Seven marks cover all seven languages:

| Mark | Letters |
|---|---|
| acute | á é í ó ú ý |
| grave | à è ì ò ù |
| circumflex | â ê î ô û |
| diaeresis | ä ë ï ö ü ÿ |
| cedilla | ç |
| tilde | ã ñ õ |
| ring | å |

Ligatures and letters with no combining form are spelled out at input instead:
`Œ → OE`, `Æ → AE`, `ß → SS`. So `Straße` sounds as `STRASSE`.

Adding a language means adding its marks to `MARKS` in
[public/index.html](public/index.html) — there is room for one more (8 states, 7
used). Czech and Polish need caron, ogonek, and stroke, which exceeds that budget;
supporting them would require a wider register and fewer letters per chord.

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
