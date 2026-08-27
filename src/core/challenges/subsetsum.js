/**
 * NP-hard by construction, and generated at density ~1 where the lattice
 * attacks stop helping. Meet-in-the-middle buys you half the exponent; the
 * hour count takes it straight back.
 */
export default {
  id: 'subsetsum',
  name: 'Exact Change',
  minHour: 8,
  maxHour: Infinity,
  blurb: 'Hit the target exactly. Some subset does.',

  params(hour) {
    const n = Math.min(14 + Math.round(hour * 1.6), 132);
    return { n, bits: n };
  },

  /** Meet in the middle, which is the best anyone realistically brings. */
  workBits(hour) {
    return this.params(hour).n / 2;
  },

  generate(hour, rng) {
    const { n, bits } = this.params(hour);
    // Density n / log2(max) ~ 1: the region where subset-sum is genuinely hard.
    const numbers = [];
    for (let i = 0; i < n; i++) {
      let v = 0n;
      for (let b = 0; b < bits; b++) v = (v << 1n) | BigInt(rng.int(0, 1));
      numbers.push(v | (1n << BigInt(bits - 1)));
    }
    const chosen = rng.sample([...numbers.keys()], rng.int(Math.floor(n / 3), Math.floor(n / 2)));
    const target = chosen.reduce((acc, i) => acc + numbers[i], 0n);

    return {
      title: 'Exact Change',
      brief:
        `${n} integers, one target. Find a subset that sums to the target exactly. ` +
        `Answer with the 1-based indices, comma separated, any order. ` +
        `A solution is guaranteed to exist. Brute force is 2^${n}.`,
      data: {
        numbers: numbers.map((v) => v.toString()),
        target: target.toString(),
        count: n,
      },
      answerFormat: 'comma-separated 1-based indices, e.g. 2,5,9',
      answer: chosen.map((i) => i + 1).sort((a, b) => a - b).join(','),
      target: target.toString(),
    };
  },

  verify(submission, challenge) {
    const raw = String(submission ?? '').trim();
    if (!/^\s*\d+(\s*,\s*\d+)*\s*$/.test(raw)) return false;
    const idx = raw.split(',').map((s) => Number(s.trim()));
    if (new Set(idx).size !== idx.length) return false;
    const nums = challenge.data.numbers;
    if (idx.some((i) => !Number.isInteger(i) || i < 1 || i > nums.length)) return false;
    const sum = idx.reduce((acc, i) => acc + BigInt(nums[i - 1]), 0n);
    return sum === BigInt(challenge.target);
  },
};
