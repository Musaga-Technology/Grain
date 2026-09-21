/**
 * Generates the DCT-II basis matrix as source constants.
 *
 * WHY THIS IS GENERATED AND COMMITTED, NOT COMPUTED AT RUNTIME:
 * Math.cos is implementation-approximated in ECMAScript -- engines are not
 * required to agree bit-for-bit. V8 (Node, Chrome) and JavaScriptCore (Safari)
 * use different libm implementations, and Safari is the recommended demo
 * browser (SPEC.md 9.2). Computing the basis at runtime would silently produce
 * different fingerprints per engine.
 *
 * Emitting the table as literals means the hash path uses only +, -, * and /,
 * all of which IEEE-754 defines exactly. Determinism then holds by construction
 * rather than by luck.
 *
 * Run: pnpm --filter @grain/core gen:dct
 */
const N = 32; // resize target
const K = 8;  // retained low-frequency coefficients per axis

const basis: number[][] = [];
for (let k = 0; k < K; k++) {
  const alpha = k === 0 ? Math.sqrt(1 / N) : Math.sqrt(2 / N);
  const row: number[] = [];
  for (let n = 0; n < N; n++) {
    row.push(alpha * Math.cos((Math.PI * (2 * n + 1) * k) / (2 * N)));
  }
  basis.push(row);
}

// String(x) is the shortest representation that round-trips exactly for a
// float64, so these literals reload as the identical bit patterns.
const body = basis.map((row) => '  [' + row.map(String).join(', ') + '],').join('\n');

const out = `// GENERATED FILE -- do not edit by hand.
// Regenerate with: pnpm --filter @grain/core gen:dct
//
// DCT-II basis, orthonormal scaling folded in.
// basis[k][n] = alpha(k) * cos(pi * (2n+1) * k / (2N)),  N=${N}, K=${K}
//
// Committed as literals so no transcendental function runs on the hash path.
// See scripts/gen-dct-basis.ts for why.

export const DCT_N = ${N};
export const DCT_K = ${K};

export const DCT_BASIS: readonly (readonly number[])[] = [
${body}
];
`;

process.stdout.write(out);
