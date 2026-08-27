
const M = 1n << 32n;

export const OPS = {
  PUSH: 0x01, ADD: 0x02, SUB: 0x03, MUL: 0x04, XOR: 0x05, AND: 0x06, OR: 0x07,
  DUP: 0x08, SWAP: 0x09, DROP: 0x0a, LOAD: 0x0b, STORE: 0x0c, JNZ: 0x0d,
  JMP: 0x0e, OUT: 0x0f, HALT: 0x10, ROTL: 0x11,
};

export const ISA = [
  ['01 nnnnnnnn', 'PUSH imm32', 'push a 32-bit big-endian immediate'],
  ['02', 'ADD', 'b=pop a=pop push((a+b) mod 2^32)'],
  ['03', 'SUB', 'b=pop a=pop push((a-b) mod 2^32)'],
  ['04', 'MUL', 'b=pop a=pop push((a*b) mod 2^32)'],
  ['05', 'XOR', 'b=pop a=pop push(a^b)'],
  ['06', 'AND', 'b=pop a=pop push(a&b)'],
  ['07', 'OR', 'b=pop a=pop push(a|b)'],
  ['08', 'DUP', 'push(top)'],
  ['09', 'SWAP', 'swap the top two'],
  ['0a', 'DROP', 'pop and discard'],
  ['0b rr', 'LOAD r', 'push register r'],
  ['0c rr', 'STORE r', 'pop into register r'],
  ['0d oooo', 'JNZ rel16', 'pop; if nonzero, ip += signed rel16 (relative to the next instruction)'],
  ['0e oooo', 'JMP rel16', 'ip += signed rel16'],
  ['0f', 'OUT', 'pop and emit'],
  ['10', 'HALT', 'stop'],
  ['11', 'ROTL', 'b=pop a=pop push(rotate-left(a, b & 31))'],
];

/** Tiny label-resolving assembler. Instructions are ['OP', operand?] or {label}. */
function assemble(program) {
  const sizes = { PUSH: 5, LOAD: 2, STORE: 2, JNZ: 3, JMP: 3 };
  const labels = new Map();
  let pc = 0;
  for (const ins of program) {
    if (ins.label) { labels.set(ins.label, pc); continue; }
    pc += sizes[ins[0]] ?? 1;
  }

  const out = [];
  pc = 0;
  for (const ins of program) {
    if (ins.label) continue;
    const [op, operand] = ins;
    const size = sizes[op] ?? 1;
    const next = pc + size;
    out.push(OPS[op]);
    if (op === 'PUSH') {
      const b = Buffer.alloc(4);
      b.writeUInt32BE(Number(BigInt(operand) % M));
      out.push(...b);
    } else if (op === 'LOAD' || op === 'STORE') {
      out.push(operand & 0xff);
    } else if (op === 'JNZ' || op === 'JMP') {
      const target = labels.get(operand);
      if (target === undefined) throw new Error(`unknown label ${operand}`);
      const rel = target - next;
      const b = Buffer.alloc(2);
      b.writeInt16BE(rel);
      out.push(...b);
    }
    pc = next;
  }
  return Buffer.from(out);
}

/** Reference interpreter. Used by the tests and by anyone brave enough to emulate. */
export function execute(bytecode, { maxSteps = 5_000_000 } = {}) {
  const stack = [];
  const regs = new Array(16).fill(0n);
  const output = [];
  let ip = 0;
  let steps = 0;
  const pop = () => {
    if (!stack.length) throw new Error('stack underflow');
    return stack.pop();
  };
  const push = (v) => stack.push(((v % M) + M) % M);

  while (ip < bytecode.length) {
    if (++steps > maxSteps) throw new Error('step limit exceeded');
    const op = bytecode[ip++];
    switch (op) {
      case OPS.PUSH: push(BigInt(bytecode.readUInt32BE(ip))); ip += 4; break;
      case OPS.ADD: { const b = pop(), a = pop(); push(a + b); break; }
      case OPS.SUB: { const b = pop(), a = pop(); push(a - b); break; }
      case OPS.MUL: { const b = pop(), a = pop(); push(a * b); break; }
      case OPS.XOR: { const b = pop(), a = pop(); push(a ^ b); break; }
      case OPS.AND: { const b = pop(), a = pop(); push(a & b); break; }
      case OPS.OR: { const b = pop(), a = pop(); push(a | b); break; }
      case OPS.DUP: { const a = pop(); push(a); push(a); break; }
      case OPS.SWAP: { const b = pop(), a = pop(); push(b); push(a); break; }
      case OPS.DROP: pop(); break;
      case OPS.LOAD: push(regs[bytecode[ip++]]); break;
      case OPS.STORE: regs[bytecode[ip++]] = pop(); break;
      case OPS.JNZ: { const rel = bytecode.readInt16BE(ip); ip += 2; if (pop() !== 0n) ip += rel; break; }
      case OPS.JMP: { const rel = bytecode.readInt16BE(ip); ip += 2; ip += rel; break; }
      case OPS.OUT: output.push(pop()); break;
      case OPS.HALT: return { output, steps };
      case OPS.ROTL: {
        const b = pop() & 31n, a = pop();
        push(((a << b) | (a >> (32n - b))) & (M - 1n));
        break;
      }
      default: throw new Error(`bad opcode 0x${op.toString(16)} at ${ip - 1}`);
    }
  }
  return { output, steps };
}

/**
 * n-fold composition of the affine map T(x) = A*x + B over Z/2^32, by doubling.
 * This is the whole puzzle: the bytecode runs the loop, you have to not.
 */
export function affinePower(A, B, n) {
  let a = 1n, b = 0n;      // identity
  let ba = A % M, bb = B % M;
  let e = n;
  while (e > 0n) {
    if (e & 1n) {
      a = (ba * a) % M;
      b = (ba * b + bb) % M;
    }
    const na = (ba * ba) % M;
    const nb = (ba * bb + bb) % M;
    ba = na; bb = nb;
    e >>= 1n;
  }
  return { a, b };
}

/**
 * The loop count outgrows emulation long before it outgrows the hour. Early on
 * you write an interpreter and wait; later you have to notice the loop body is
 * affine and close the form.
 */
export default {
  id: 'vm',
  name: 'Black Box',
  minHour: 3,
  maxHour: 34,
  blurb: 'Bytecode in, one number out. Do not run it.',

  params(hour) {
    const raw = Math.round(Math.pow(2, 8.2 + 0.75 * hour) / 14);
    const iterations = Math.min(raw, 4e15);
    const regs = hour < 12 ? 1 : hour < 28 ? 2 : 3;
    return { iterations, regs, nested: iterations > 2 ** 31 || hour >= 20 };
  },

  /** What emulating it costs. Finding the closed form costs a lot less. */
  workBits(hour) {
    return Math.log2(this.params(hour).iterations * 14);
  },

  generate(hour, rng) {
    const { regs: accCount, nested } = this.params(hour);
    let { iterations } = this.params(hour);

    let outer = 1, inner = iterations;
    if (nested) {
      outer = Math.max(2, Math.round(Math.sqrt(iterations)));
      inner = Math.max(2, Math.round(iterations / outer));
      iterations = outer * inner;
    }
    const total = BigInt(outer) * BigInt(inner);

    // Odd multipliers keep the map invertible mod 2^32 and the orbit long.
    const accs = [];
    for (let i = 0; i < accCount; i++) {
      accs.push({
        reg: i,
        x0: BigInt(rng.int(1, 0xffffff)) * BigInt(rng.int(1, 255)) % M,
        A: (BigInt(rng.int(1, 0x7fffffff)) * 2n + 1n) % M,
        B: BigInt(rng.int(1, 0x7fffffff)) % M,
      });
    }
    const CTR_INNER = 14;
    const CTR_OUTER = 15;
    const finalKey = BigInt(rng.int(1, 0x7fffffff));

    const prog = [];
    for (const acc of accs) {
      prog.push(['PUSH', acc.x0], ['STORE', acc.reg]);
    }
    if (nested) prog.push(['PUSH', outer], ['STORE', CTR_OUTER], { label: 'outer' });
    prog.push(['PUSH', inner], ['STORE', CTR_INNER], { label: 'inner' });

    for (const acc of accs) {
      prog.push(['LOAD', acc.reg], ['PUSH', acc.A], ['MUL'], ['PUSH', acc.B], ['ADD'], ['STORE', acc.reg]);
    }
    prog.push(['LOAD', CTR_INNER], ['PUSH', 1], ['SUB'], ['DUP'], ['STORE', CTR_INNER], ['JNZ', 'inner']);
    if (nested) prog.push(['LOAD', CTR_OUTER], ['PUSH', 1], ['SUB'], ['DUP'], ['STORE', CTR_OUTER], ['JNZ', 'outer']);

    prog.push(['LOAD', accs[0].reg]);
    for (let i = 1; i < accs.length; i++) prog.push(['LOAD', accs[i].reg], ['XOR']);
    prog.push(['PUSH', finalKey], ['XOR'], ['OUT'], ['HALT']);

    const bytecode = assemble(prog);

    // Closed form, so generating hour 60 costs the same as generating hour 3.
    let result = null;
    for (const acc of accs) {
      const { a, b } = affinePower(acc.A, acc.B, total);
      const value = (a * acc.x0 + b) % M;
      result = result === null ? value : result ^ value;
    }
    result ^= finalKey;

    return {
      title: 'Black Box',
      brief:
        `${bytecode.length} bytes of bytecode for a 32-bit stack machine with 16 registers. ` +
        'All arithmetic is mod 2^32. Execution starts at offset 0. Report the single value ' +
        'it emits with OUT, as an unsigned decimal integer. ' +
        (nested
          ? 'Warning: the loop bounds are not something you want to iterate.'
          : 'It terminates. Eventually.'),
      data: {
        bytecode: bytecode.toString('hex'),
        bytes: bytecode.length,
        isa: ISA.map(([enc, mnemonic, meaning]) => `${enc.padEnd(11)} ${mnemonic.padEnd(11)} ${meaning}`),
      },
      answerFormat: 'one unsigned decimal integer',
      answer: result.toString(),
      _iterations: total.toString(),
    };
  },

  verify(submission, challenge) {
    const raw = String(submission ?? '').trim().replace(/^0x/i, (m) => m);
    if (!/^\d+$/.test(raw)) return false;
    return BigInt(raw) === BigInt(challenge.answer);
  },
};
