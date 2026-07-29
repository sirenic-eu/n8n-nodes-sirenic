/**
 * Self-contained EIP-3009 signer: keccak-256, secp256k1 (RFC 6979) and the
 * one EIP-712 struct x402 needs — TransferWithAuthorization.
 *
 * WHY THIS FILE EXISTS. n8n verification requires two things at once: the
 * package must ship with **zero runtime dependencies**, and the published
 * bundle must pass n8n's scanner, which forbids `setTimeout`/`globalThis`/…
 * anywhere in the shipped code. Bundling viem/@x402 satisfied the first rule
 * and broke the second (18 violations, all inside the bundled libraries).
 * So the signing path is implemented here, from the curve up:
 *
 *  - keccak-256: direct implementation of Keccak-f[1600] over BigInt lanes.
 *    Slow compared to optimized libraries, and it does not matter: we hash a
 *    few hundred bytes per payment.
 *  - secp256k1: textbook Jacobian double-and-add over BigInt, deterministic
 *    nonces per RFC 6979 (HMAC-SHA256 from node:crypto — a Node builtin, not
 *    an npm dependency), low-s normalization, recovery bit for the 65-byte
 *    Ethereum signature.
 *  - EIP-712: domain separator + struct hash for the fixed
 *    TransferWithAuthorization type used by USDC/EURC (EIP-3009).
 *
 * Correctness is enforced by tests, not by trust: signatures produced here
 * are compared BYTE FOR BYTE against viem's signTypedData (dev dependency,
 * never shipped) across fixed and randomized cases, plus known keccak and
 * EIP-55 vectors. If this file drifts from the reference implementation by
 * one bit, the parity test fails.
 */
import { createHmac, randomBytes as nodeRandomBytes } from 'node:crypto';

// ---------------------------------------------------------------------------
// keccak-256
// ---------------------------------------------------------------------------

const KECCAK_ROUNDS = 24n;
/** Round constants for Keccak-f[1600]. */
const RC: bigint[] = [
	0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
	0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
	0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
	0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
	0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
	0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
/** Rotation offsets, by lane index x + 5y. */
const RHO: number[] = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
const MASK64 = (1n << 64n) - 1n;

function rotl64(value: bigint, shift: number): bigint {
	const s = BigInt(shift);
	return ((value << s) | (value >> (64n - s))) & MASK64;
}

function keccakF1600(state: bigint[]): void {
	for (let round = 0n; round < KECCAK_ROUNDS; round++) {
		// θ
		const c = new Array<bigint>(5);
		for (let x = 0; x < 5; x++) {
			c[x] = state[x]! ^ state[x + 5]! ^ state[x + 10]! ^ state[x + 15]! ^ state[x + 20]!;
		}
		for (let x = 0; x < 5; x++) {
			const d = c[(x + 4) % 5]! ^ rotl64(c[(x + 1) % 5]!, 1);
			for (let y = 0; y < 25; y += 5) state[x + y] = state[x + y]! ^ d;
		}
		// ρ et π
		const b = new Array<bigint>(25);
		for (let x = 0; x < 5; x++) {
			for (let y = 0; y < 5; y++) {
				b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl64(state[x + 5 * y]!, RHO[x + 5 * y]!);
			}
		}
		// χ
		for (let x = 0; x < 5; x++) {
			for (let y = 0; y < 25; y += 5) {
				state[x + y] = b[x + y]! ^ (~b[((x + 1) % 5) + y]! & b[((x + 2) % 5) + y]!) & MASK64;
			}
		}
		// ι
		state[0] = state[0]! ^ RC[Number(round)]!;
	}
}

/** keccak-256 (the pre-NIST padding Ethereum uses, NOT sha3-256). */
export function keccak256(data: Uint8Array): Uint8Array {
	const rate = 136; // 1088-bit rate for a 256-bit output
	const state: bigint[] = new Array(25).fill(0n);

	// Padding 0x01 … 0x80 (multi-rate keccak padding).
	const padded = new Uint8Array(Math.ceil((data.length + 1) / rate) * rate);
	padded.set(data);
	padded[data.length] = 0x01;
	padded[padded.length - 1]! |= 0x80;

	for (let offset = 0; offset < padded.length; offset += rate) {
		for (let i = 0; i < rate / 8; i++) {
			let lane = 0n;
			for (let byte = 7; byte >= 0; byte--) {
				lane = (lane << 8n) | BigInt(padded[offset + i * 8 + byte]!);
			}
			state[i] = state[i]! ^ lane;
		}
		keccakF1600(state);
	}

	const out = new Uint8Array(32);
	for (let i = 0; i < 4; i++) {
		let lane = state[i]!;
		for (let byte = 0; byte < 8; byte++) {
			out[i * 8 + byte] = Number(lane & 0xffn);
			lane >>= 8n;
		}
	}
	return out;
}

// ---------------------------------------------------------------------------
// Hex / bytes helpers (no Buffer in the hot path: plain loops, no globals)
// ---------------------------------------------------------------------------

export function hexToBytes(hex: string): Uint8Array {
	const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
	if (clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) {
		throw new Error('Invalid hex string');
	}
	const out = new Uint8Array(clean.length / 2);
	for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
	return out;
}

export function bytesToHex(bytes: Uint8Array): string {
	let out = '0x';
	for (const b of bytes) out += b.toString(16).padStart(2, '0');
	return out;
}

function bytesToBigInt(bytes: Uint8Array): bigint {
	let out = 0n;
	for (const b of bytes) out = (out << 8n) | BigInt(b);
	return out;
}

function bigIntTo32Bytes(value: bigint): Uint8Array {
	const out = new Uint8Array(32);
	let v = value;
	for (let i = 31; i >= 0; i--) {
		out[i] = Number(v & 0xffn);
		v >>= 8n;
	}
	return out;
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
	const total = arrays.reduce((s, a) => s + a.length, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const a of arrays) {
		out.set(a, offset);
		offset += a.length;
	}
	return out;
}

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

// ---------------------------------------------------------------------------
// secp256k1 — Jacobian double-and-add over BigInt, RFC 6979 nonces
// ---------------------------------------------------------------------------

/** Field prime and group order of secp256k1. */
const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const Gx = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const Gy = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;

function mod(a: bigint, m: bigint): bigint {
	const r = a % m;
	return r >= 0n ? r : r + m;
}

/** Modular inverse via extended Euclid (m prime in our two uses). */
function invert(a: bigint, m: bigint): bigint {
	let [old_r, r] = [mod(a, m), m];
	let [old_s, s] = [1n, 0n];
	while (r !== 0n) {
		const q = old_r / r;
		[old_r, r] = [r, old_r - q * r];
		[old_s, s] = [s, old_s - q * s];
	}
	if (old_r !== 1n) throw new Error('No modular inverse');
	return mod(old_s, m);
}

/** Point in Jacobian coordinates; ZERO is the point at infinity. */
type Jac = { x: bigint; y: bigint; z: bigint };
const ZERO: Jac = { x: 0n, y: 1n, z: 0n };
const G: Jac = { x: Gx, y: Gy, z: 1n };

function jacDouble(p: Jac): Jac {
	if (p.z === 0n) return p;
	const { x, y, z } = p;
	const a = mod(x * x, P);
	const b = mod(y * y, P);
	const c = mod(b * b, P);
	const d = mod(2n * (mod((x + b) * (x + b), P) - a - c), P);
	const e = mod(3n * a, P);
	const f = mod(e * e, P);
	const x3 = mod(f - 2n * d, P);
	const y3 = mod(e * (d - x3) - 8n * c, P);
	const z3 = mod(2n * y * z, P);
	return { x: x3, y: y3, z: z3 };
}

function jacAdd(p: Jac, q: Jac): Jac {
	if (p.z === 0n) return q;
	if (q.z === 0n) return p;
	const z1z1 = mod(p.z * p.z, P);
	const z2z2 = mod(q.z * q.z, P);
	const u1 = mod(p.x * z2z2, P);
	const u2 = mod(q.x * z1z1, P);
	const s1 = mod(p.y * q.z * z2z2, P);
	const s2 = mod(q.y * p.z * z1z1, P);
	const h = mod(u2 - u1, P);
	const r = mod(s2 - s1, P);
	if (h === 0n) {
		if (r === 0n) return jacDouble(p); // same point
		return ZERO; // opposite points
	}
	const h2 = mod(h * h, P);
	const h3 = mod(h * h2, P);
	const v = mod(u1 * h2, P);
	const x3 = mod(r * r - h3 - 2n * v, P);
	const y3 = mod(r * (v - x3) - s1 * h3, P);
	const z3 = mod(p.z * q.z * h, P);
	return { x: x3, y: y3, z: z3 };
}

function jacMultiply(point: Jac, scalar: bigint): Jac {
	let result = ZERO;
	let addend = point;
	let k = scalar;
	while (k > 0n) {
		if (k & 1n) result = jacAdd(result, addend);
		addend = jacDouble(addend);
		k >>= 1n;
	}
	return result;
}

function toAffine(p: Jac): { x: bigint; y: bigint } {
	if (p.z === 0n) throw new Error('Point at infinity');
	const zInv = invert(p.z, P);
	const zInv2 = mod(zInv * zInv, P);
	return { x: mod(p.x * zInv2, P), y: mod(p.y * zInv2 * zInv, P) };
}

/** Uncompressed public key (x, y) for a private key. */
function publicPoint(privateKey: bigint): { x: bigint; y: bigint } {
	if (privateKey <= 0n || privateKey >= N) throw new Error('Private key out of range');
	return toAffine(jacMultiply(G, privateKey));
}

function hmacSha256(key: Uint8Array, ...messages: Uint8Array[]): Uint8Array {
	const h = createHmac('sha256', key);
	for (const m of messages) h.update(m);
	// Copy into a fresh Uint8Array: Buffer's backing store is typed
	// ArrayBufferLike, which does not satisfy Uint8Array<ArrayBuffer>.
	const digest = h.digest();
	const out = new Uint8Array(digest.length);
	for (let i = 0; i < digest.length; i++) out[i] = digest[i]!;
	return out;
}

/**
 * Deterministic nonce per RFC 6979 §3.2 (SHA-256), returning the first
 * candidate in range — the standard loop, which viem/noble also implement.
 */
function rfc6979Nonce(privateKey: bigint, msgHash: Uint8Array): bigint {
	const x = bigIntTo32Bytes(privateKey);
	// h1 already reduced: msgHash is 32 bytes, same size as the order.
	// Explicit annotations: since TypeScript 5.7 a bare `Uint8Array` means
	// `Uint8Array<ArrayBufferLike>`, which is what hmacSha256 returns — the
	// inferred `Uint8Array<ArrayBuffer>` of the initializers would not accept it.
	let v: Uint8Array = new Uint8Array(32).fill(0x01);
	let k: Uint8Array = new Uint8Array(32).fill(0x00);
	k = hmacSha256(k, v, new Uint8Array([0x00]), x, msgHash);
	v = hmacSha256(k, v);
	k = hmacSha256(k, v, new Uint8Array([0x01]), x, msgHash);
	v = hmacSha256(k, v);
	for (;;) {
		v = hmacSha256(k, v);
		const candidate = bytesToBigInt(v);
		if (candidate > 0n && candidate < N) return candidate;
		k = hmacSha256(k, v, new Uint8Array([0x00]));
		v = hmacSha256(k, v);
	}
}

export interface Signature {
	r: bigint;
	s: bigint;
	/** 0 or 1 — which of the two candidate public keys signed. */
	recovery: number;
}

/** ECDSA over a 32-byte digest, deterministic (RFC 6979), low-s, with recovery. */
export function signDigest(msgHash: Uint8Array, privateKey: bigint): Signature {
	const z = bytesToBigInt(msgHash);
	for (let attempt = 0; ; attempt++) {
		// The extra-entropy retry path of RFC 6979 §3.6 is intentionally not
		// implemented: r=0 / s=0 has probability ~2^-256. Guarded anyway.
		if (attempt > 8) throw new Error('Signing failed: could not produce a valid signature');
		const k = rfc6979Nonce(privateKey, msgHash);
		const kg = toAffine(jacMultiply(G, k));
		const r = mod(kg.x, N);
		if (r === 0n) continue;
		let s = mod(invert(k, N) * mod(z + r * privateKey, N), N);
		if (s === 0n) continue;
		let recovery = Number(kg.y & 1n) | (kg.x >= N ? 2 : 0);
		// Ethereum requires low-s; flipping s flips the recovery parity.
		if (s > N / 2n) {
			s = N - s;
			recovery ^= 1;
		}
		return { r, s, recovery };
	}
}

/** 65-byte Ethereum signature r || s || v, with v in {27, 28}. */
export function toEthSignature(sig: Signature): string {
	const v = new Uint8Array(65);
	v.set(bigIntTo32Bytes(sig.r), 0);
	v.set(bigIntTo32Bytes(sig.s), 32);
	v[64] = 27 + sig.recovery;
	return bytesToHex(v);
}

// ---------------------------------------------------------------------------
// Addresses (EIP-55)
// ---------------------------------------------------------------------------

/** Checksummed address from a private key. */
export function addressFromPrivateKey(privateKeyHex: string): string {
	const priv = bytesToBigInt(hexToBytes(privateKeyHex));
	const pub = publicPoint(priv);
	const raw = concatBytes(bigIntTo32Bytes(pub.x), bigIntTo32Bytes(pub.y));
	const hash = keccak256(raw);
	return toChecksumAddress(bytesToHex(hash.slice(12)));
}

/** EIP-55 mixed-case checksum encoding. */
export function toChecksumAddress(address: string): string {
	const addr = address.toLowerCase().replace(/^0x/, '');
	if (!/^[0-9a-f]{40}$/.test(addr)) throw new Error(`Invalid address: ${address}`);
	const hash = keccak256(utf8(addr));
	let out = '0x';
	for (let i = 0; i < 40; i++) {
		const nibble = (hash[i >> 1]! >> (i % 2 === 0 ? 4 : 0)) & 0x0f;
		out += nibble >= 8 ? addr[i]!.toUpperCase() : addr[i]!;
	}
	return out;
}

// ---------------------------------------------------------------------------
// EIP-712 — TransferWithAuthorization only (EIP-3009, what x402 `exact` signs)
// ---------------------------------------------------------------------------

const EIP712_DOMAIN_TYPEHASH = keccak256(
	utf8('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'),
);
const TRANSFER_WITH_AUTHORIZATION_TYPEHASH = keccak256(
	utf8(
		'TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)',
	),
);

export interface Eip3009Authorization {
	from: string;
	to: string;
	value: bigint;
	validAfter: bigint;
	validBefore: bigint;
	/** 32-byte hex, 0x-prefixed. */
	nonce: string;
}

export interface Eip712Domain {
	name: string;
	version: string;
	chainId: bigint;
	verifyingContract: string;
}

function encodeAddress(address: string): Uint8Array {
	const out = new Uint8Array(32);
	out.set(hexToBytes(address), 12);
	return out;
}

/** keccak(0x1901 || domainSeparator || structHash) — the digest ECDSA signs. */
export function eip712Digest(domain: Eip712Domain, auth: Eip3009Authorization): Uint8Array {
	const domainSeparator = keccak256(
		concatBytes(
			EIP712_DOMAIN_TYPEHASH,
			keccak256(utf8(domain.name)),
			keccak256(utf8(domain.version)),
			bigIntTo32Bytes(domain.chainId),
			encodeAddress(domain.verifyingContract),
		),
	);
	const structHash = keccak256(
		concatBytes(
			TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
			encodeAddress(auth.from),
			encodeAddress(auth.to),
			bigIntTo32Bytes(auth.value),
			bigIntTo32Bytes(auth.validAfter),
			bigIntTo32Bytes(auth.validBefore),
			hexToBytes(auth.nonce),
		),
	);
	return keccak256(concatBytes(new Uint8Array([0x19, 0x01]), domainSeparator, structHash));
}

/** Signs a TransferWithAuthorization; returns the 65-byte 0x signature. */
export function signTransferWithAuthorization(
	privateKeyHex: string,
	domain: Eip712Domain,
	auth: Eip3009Authorization,
): string {
	const priv = bytesToBigInt(hexToBytes(privateKeyHex));
	const digest = eip712Digest(domain, auth);
	return toEthSignature(signDigest(digest, priv));
}

/** 32 random bytes as 0x hex — the EIP-3009 nonce. node:crypto, no globals. */
export function randomNonce(): string {
	return bytesToHex(new Uint8Array(nodeRandomBytes(32)));
}
