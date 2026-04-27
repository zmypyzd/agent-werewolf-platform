function mulberry32(seed: number): () => number {
  let s = seed;
  return function() {
    let t = (s += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function djb2Hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ (s.charCodeAt(i) | 0);
    h = h >>> 0;
  }
  return h;
}

export function createSeededRng(seed: string): () => number {
  return mulberry32(djb2Hash(seed));
}
