// Postgres BIGINT is signed 64-bit; @sakshi/core's pHash is an unsigned 64-bit bigint
// (docs/DATABASE.md §3.5: "pHash as BIGINT" — two's complement of the same 64 bits).
const TWO_POW_63 = 1n << 63n;
const TWO_POW_64 = 1n << 64n;

export function toSignedBigInt64(unsigned: bigint): bigint {
  return unsigned >= TWO_POW_63 ? unsigned - TWO_POW_64 : unsigned;
}

export function fromSignedBigInt64(signed: bigint): bigint {
  return signed < 0n ? signed + TWO_POW_64 : signed;
}
