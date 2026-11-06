/** 자체 구현 바이너리 직렬화 */
export class Writer {
  buf: ArrayBuffer;
  dv: DataView;
  u8: Uint8Array;
  o = 0;
  constructor(size = 1024) { this.buf = new ArrayBuffer(size); this.dv = new DataView(this.buf); this.u8 = new Uint8Array(this.buf); }
  private need(n: number) {
    if (this.o + n <= this.buf.byteLength) return;
    let size = this.buf.byteLength * 2;
    while (size < this.o + n) size *= 2;
    const nb = new ArrayBuffer(size);
    new Uint8Array(nb).set(this.u8.subarray(0, this.o));
    this.buf = nb; this.dv = new DataView(nb); this.u8 = new Uint8Array(nb);
  }
  reset() { this.o = 0; return this; }
  writeU8(v: number) { this.need(1); this.dv.setUint8(this.o, v & 0xff); this.o += 1; }
  writeI8(v: number) { this.need(1); this.dv.setInt8(this.o, Math.max(-128, Math.min(127, Math.round(v)))); this.o += 1; }
  writeU16(v: number) { this.need(2); this.dv.setUint16(this.o, Math.max(0, Math.min(65535, Math.round(v))), true); this.o += 2; }
  writeI16(v: number) { this.need(2); this.dv.setInt16(this.o, Math.max(-32768, Math.min(32767, Math.round(v))), true); this.o += 2; }
  writeU32(v: number) { this.need(4); this.dv.setUint32(this.o, v >>> 0, true); this.o += 4; }
  writeF32(v: number) { this.need(4); this.dv.setFloat32(this.o, v, true); this.o += 4; }
  writeF64(v: number) { this.need(8); this.dv.setFloat64(this.o, v, true); this.o += 8; }
  writeVarU(v: number) { v = Math.max(0, Math.floor(v)); while (v >= 0x80) { this.writeU8((v & 0x7f) | 0x80); v = Math.floor(v / 128); } this.writeU8(v); }
  writeStr(s: string) { const b = new TextEncoder().encode(s); this.writeVarU(b.length); this.need(b.length); this.u8.set(b, this.o); this.o += b.length; }
  bytes(): Uint8Array { return this.u8.slice(0, this.o); }
}

export class Reader {
  dv: DataView;
  u8: Uint8Array;
  o = 0;
  constructor(data: ArrayBuffer | Uint8Array) {
    if (data instanceof Uint8Array) { this.u8 = data; this.dv = new DataView(data.buffer, data.byteOffset, data.byteLength); }
    else { this.u8 = new Uint8Array(data); this.dv = new DataView(data); }
  }
  get left() { return this.u8.byteLength - this.o; }
  private chk(n: number) { if (this.o + n > this.u8.byteLength) throw new RangeError('패킷이 잘렸습니다'); }
  readU8() { this.chk(1); return this.dv.getUint8(this.o++); }
  readI8() { this.chk(1); return this.dv.getInt8(this.o++); }
  readU16() { this.chk(2); const v = this.dv.getUint16(this.o, true); this.o += 2; return v; }
  readI16() { this.chk(2); const v = this.dv.getInt16(this.o, true); this.o += 2; return v; }
  readU32() { this.chk(4); const v = this.dv.getUint32(this.o, true); this.o += 4; return v; }
  readF32() { this.chk(4); const v = this.dv.getFloat32(this.o, true); this.o += 4; return v; }
  readF64() { this.chk(8); const v = this.dv.getFloat64(this.o, true); this.o += 8; return v; }
  readVarU() { let v = 0, mul = 1; for (let i = 0; i < 5; i++) { const b = this.readU8(); v += (b & 0x7f) * mul; if (!(b & 0x80)) return v; mul *= 128; } return v; }
  readStr() { const n = this.readVarU(); this.chk(n); const s = new TextDecoder().decode(this.u8.subarray(this.o, this.o + n)); this.o += n; return s; }
}
