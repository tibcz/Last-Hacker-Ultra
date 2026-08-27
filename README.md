# Last Hacker Ultra

A backyard ultra, for hackers.

In a [backyard ultra](https://en.wikipedia.org/wiki/Backyard_ultra), runners set off on the same
6.7 km loop every hour, on the hour. Finish inside the hour and you may start the next one. Miss it
and you are out. There is no distance to reach and no finish line — the race simply continues until
one person is the only one left, and even then they have to go out and run one more loop alone to
be crowned. If they don't, nobody wins.

This is that, with challenges instead of kilometres.

Every hour a new challenge drops. Everybody gets the same one. Solve it before the next bell or you
are eliminated. The next hour is harder. So is the one after that. It never stops getting harder,
and there is no hour at which it becomes impossible — only the hour at which it becomes impossible
**for you**.

```
  hour 34  DEEP HOURS                            difficulty ×116.2
  next bell in 41:08   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░

  hacker       hour 1 ──────────────────────────► 34  hrs
  nightshift   ██████████████████████████████████   34
  coldbrew     ██████████████████████████████████   34
  segfault     ███████████████████████████████✕··   31
  deadbeef     ██████████████████████████✕·······   26
  ninetail     ██████████████████████✕···········   22
  hexdump      ██████████████✕···················   14
```

## Run one

```bash
git clone https://github.com/tibcz/last-hacker-ultra && cd last-hacker-ultra
npm start                       # board on http://localhost:3000
```

No dependencies — it is Node's standard library and nothing else. Then, from another shell:

```bash
curl -XPOST localhost:3000/api/admin/start -H "authorization: Bearer $ADMIN_TOKEN"
```

The admin token is printed when the server boots, or you can pin it with `LHU_ADMIN_TOKEN`.

### Watch one play out first

```bash
npm run demo
```

Six hackers with different amounts of patience and very different hardware, on 20-second hours,
running the real challenges through the real solvers. A whole ultra in a few minutes.
`LHU_DEMO_HOUR=45` gives them longer to think and pushes the race deeper; `LHU_DEMO_BOTS=8` puts
the full roster on the line.

It often ends with nobody winning. The bots all run the same solver, so when an hour crosses that
solver's ceiling it tends to take the whole surviving field at once — which is exactly the ending
the rules are built to handle, and exactly what happens at real backyard ultras when the last few
runners break together. A field of humans with their own tooling spreads out a lot more.

## Play

From the browser, or from a terminal:

```bash
./bin/lhu.js signup nightshift   # take a bib; the token is saved to ~/.config/lhu
./bin/lhu.js watch               # the board, live
./bin/lhu.js hour                # this hour's challenge
./bin/lhu.js submit 'spindrift'  # your answer
./bin/lhu.js solve --budget 300  # let the reference solvers have a go, then submit
```

Point it anywhere with `--server https://race.example` or `LHU_SERVER`.

## The rules

- **One challenge per hour, on the hour.** It unlocks at the bell and closes at the next one.
- **Solve it or you are out.** Unlimited attempts inside the hour, no credit for being close.
- **The corral closes at the first bell.** Everyone starts together. (`LHU_LATE_ENTRY=1` relaxes this.)
- **The winner clears one more hour than everybody else.** When one hacker is left, they still have
  to go out alone and clear one more. Finish it and the race is theirs.
- **If they don't, nobody wins.** The last hacker to be eliminated is recorded as the *assist* — the
  one who pushed the field furthest. This is a real result in real backyard ultras, and it happens
  here too.
- **You cannot win a race you are alone in.** A solo entrant runs until the clock beats them, and
  the board records the hours, but there is no title without somebody to outlast.

## What the hours are made of

Eight challenge families. Each one is generated from `(race seed, hour)`, so the server never
stores an answer — it regenerates the hour and re-derives it, which also means a restart cannot lose
one. Each family declares what its intended attack costs, in log2 of operations, and that number is
required to be non-decreasing hour over hour.

| family | opens | runs until | what it is | what makes it harder |
|---|---|---|---|---|
| **Onion** | 1 | 16 | Layered encodings, no map | one more layer every two hours |
| **Cold Cipher** | 1 | 24 | Caesar → Vigenère → repeating-key XOR | longer key, less ciphertext to attack |
| **Black Box** | 3 | 34 | Bytecode for a 32-bit stack machine | loop counts that outgrow emulation |
| **Grind** | 4 | ∞ | Proof of work against SHA-256 | one zero bit every ~1.3 hours |
| **Keyspace** | 6 | ∞ | A hash and the space it came from | one more character every ~7 hours |
| **Exact Change** | 8 | ∞ | Subset-sum at density ≈ 1 | 1.6 more integers every hour |
| **Salvage** | 10 | ∞ | Recover redacted bytes from a checksum | one more hole every 7 hours |
| **Discrete Log** | 12 | ∞ | `g^x = h (mod p)`, p a safe prime | 1.5 more bits of p every hour |

The gentle families retire. **Onion** and **Cold Cipher** are warm-up hours and stop being scheduled
once the race is properly under way. **Black Box** retires too, for a different reason: it is an
insight puzzle, and once you have written the analysis it stays written — it would start handing out
free hours. Past hour 34 only the search-bound families are left, which is the right shape for the
deep hours. Nothing to be clever about any more. Just work, against a clock.

### The curve

Every family is tuned to cost about `2^(12 + 0.75 × hour)` operations at hour *h*, so no hour is a
soft touch because of which family came up:

```
hour        1    4    8   12   16   20   25   30   35   40   50   60
target     13   15   18   21   24   27   31   35   38   42   50   57
grind       ·   15   18   21   24   27   31   35   38   42   50   57
keyspace    ·    ·   16   21   26   26   31   36   36   41   52   57
exact       ·    ·   14   17   20   23   27   31   35   39   47   55
salvage     ·    ·    ·   21   26   26   31   37   37   42   47   58
dlog        ·    ·    ·   21   24   27   31   35   39   42   50   57
```

Hour 1 is a few seconds of work. Hour 20 is a script. Hour 35 is a script that had better be
written in something fast. Hour 50 is a machine room. There is no hour at which the generator gives
up, and `npm test` asserts the curve never dips.

The reference solvers in `tools/solver.js` implement the intended attack for every family — crib
dragging, meet-in-the-middle, baby-step giant-step, closed-form loop analysis — and work only from
the same public view a competitor gets. They exist to prove each hour is solvable, and they double
as the brains of the demo bots.

They are also deliberately ordinary: plain JavaScript, single threaded, with the memory ceilings a
laptop actually has. Given a full hour they run out of road in the low twenties — baby-step
giant-step blows its table around hour 21, meet-in-the-middle gives up past 44 integers around hour
23, and brute force stops being an hour's work around hour 25. None of those are limits of the
*challenges*. Pollard's rho needs no table. Meet-in-the-middle scales with the memory you are willing
to buy. A GPU eats proof of work. Every one of those walls moves if you bring something better, and
that is the entire game: the hour that stops you is a fact about your tooling, not about the race.

## HTTP

```
GET  /api/state            the race, the board, the clock
GET  /api/challenge        this hour, without the answer
GET  /api/tally            one row per hacker, one column per hour
GET  /api/hours/:n         a closed hour, answer included
POST /api/signup           {"handle": "..."}          -> {"token": "..."}
GET  /api/me               bearer token
POST /api/submit           {"answer": "..."}          bearer token
POST /api/admin/start      bearer admin token
POST /api/admin/new        {"hourSeconds": 3600, "seed": "...", "maxHours": 0}
POST /api/admin/bell       ring the next bell early (demo and testing)
```

Tokens are stored hashed. Submissions are rate limited per hacker and signups per address. Past
hours are readable with their answers; the live hour never is.

## Configuration

| variable | default | |
|---|---|---|
| `LHU_PORT` | `3000` | |
| `LHU_HOST` | `0.0.0.0` | |
| `LHU_HOUR_SECONDS` | `3600` | shorten it and the whole race compresses |
| `LHU_ADMIN_TOKEN` | random per boot | printed on start if unset |
| `LHU_SEED` | random | pin it and the race is reproducible |
| `LHU_DATA` | `data/race.json` | atomic writes; a crash cannot corrupt it |
| `LHU_RACE_NAME` | `Last Hacker Ultra` | |
| `LHU_LATE_ENTRY` | off | `1` lets people join mid-race |

The server can be stopped and restarted mid-race. On the next request it replays every bell it
slept through and eliminates whoever should have been eliminated.

## Layout

```
src/core/challenges/   eight families, one file each, plus the schedule
src/core/race.js       the rules: bells, elimination, the extra hour, no-winner
src/core/difficulty.js the curve, in one place
src/server/            zero-dependency HTTP
web/                   the board — the light drains out of it as the hours pile up
bin/lhu.js             the CLI
tools/solver.js        reference attacks, one per family
tools/demo.js          a whole ultra in five minutes
test/                  45 tests, no fixtures, no mocks
```

## Licence

MIT.
