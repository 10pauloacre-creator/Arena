// Aleatoriedade isomórfica (navegador + Node), usada pelas regras do domínio.
//
// Fora de `withDeterministic` tudo vem do gerador criptográfico do sistema (Web Crypto).
// Dentro dele, os valores saem de uma sequência derivada de uma "semente" (o id da operação offline): assim o aparelho
// (que aplica a ação sem internet) e o servidor (que a repete depois) geram os MESMOS ids, sorteios e códigos.
// A semente é um id aleatório de 128 bits que só o aparelho e o servidor conhecem.

let det = null;

/** cyrb128: transforma um texto em 4 números de 32 bits. */
function cyrb128(str) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0, k; i < str.length; i++) {
    k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

/** sfc32: gerador de 128 bits de estado. */
function sfc32(a, b, c, d) {
  return () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b | 0) + d | 0;
    d = d + 1 | 0; a = b ^ b >>> 9; b = c + (c << 3) | 0; c = c << 21 | c >>> 11; c = c + t | 0;
    return (t >>> 0) / 4294967296;
  };
}

/** Executa `fn` (síncrona!) com a aleatoriedade derivada de `seed`. Sem semente, não muda nada. */
export function withDeterministic(seed, fn) {
  if (!seed) return fn();
  const prev = det;
  det = sfc32(...cyrb128(String(seed)));
  try {
    const out = fn();
    if (out && typeof out.then === 'function') throw new Error('withDeterministic exige uma função síncrona.');
    return out;
  } finally { det = prev; }
}

export function randomBytes(n) {
  const b = new Uint8Array(n);
  if (det) { for (let i = 0; i < n; i++) b[i] = Math.floor(det() * 256); return b; }
  globalThis.crypto.getRandomValues(b);
  return b;
}

/** Inteiro de 32 bits sem sinal. */
export const randomU32 = () => {
  const b = randomBytes(4);
  return ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
};

/** Número em [0, 1) com a mesma origem de `randomBytes` (substitui Math.random nas regras que precisam repetir). */
export const randomFloat = () => randomU32() / 4294967296;

export const b64url = bytes => {
  let s = '';
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** Token aleatório curto e seguro para URLs (convites, códigos de acesso). */
export const randomCode = (bytes = 16) => b64url(randomBytes(bytes));
export const randomId = (prefix = '') => prefix + b64url(randomBytes(9));

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** Código curto legível (sem caracteres ambíguos) — usado como código do capitão. */
export function shortCode(len = 8) {
  const bytes = randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return s;
}
