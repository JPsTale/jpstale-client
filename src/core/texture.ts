/**
 * PT 加密 BMP/TGA 纹理解码。纯解析层,无 three/DOM。
 * 游戏只加密文件头：
 *   BMP: bytes[0..1]=0x41,0x38; bytes[2..13] += i*i
 *   TGA: bytes[0..1]=0x47,0x38; bytes[2..17] += i*i
 */
export interface DecodedTexture {
  width: number;
  height: number;
  pixels: Uint8Array;
  hasAlpha?: boolean;
}

export function decodeTexture(arrayBuffer: ArrayBuffer): DecodedTexture | null {
  const data = new Uint8Array(arrayBuffer);
  if (data.length < 18) return null;

  if (data[0] === 0x41 && data[1] === 0x38) return decodeBMP(data);
  if (data[0] === 0x47 && data[1] === 0x38) return decodeTGA(data);
  if (data[0] === 0x42 && data[1] === 0x4d) return decodeBMP(data); // already decrypted BMP
  return decodeTGA(data);
}

function decryptBMPHeader(data: Uint8Array): void {
  data[0] = 0x42;
  data[1] = 0x4d;
  for (let i = 2; i < 14; i++) data[i] = (data[i] - i * i) & 0xff;
}

function decryptTGAHeader(data: Uint8Array): void {
  data[0] = 0;
  data[1] = 0;
  for (let i = 2; i < 18; i++) data[i] = (data[i] - i * i) & 0xff;
}

function decodeBMP(data: Uint8Array): DecodedTexture | null {
  const raw = new Uint8Array(data);
  const dv = new DataView(raw.buffer);

  if (raw[0] === 0x41 && raw[1] === 0x38) decryptBMPHeader(raw);
  if (raw[0] !== 0x42 || raw[1] !== 0x4d) return null;

  const pixelOffset = dv.getUint32(10, true);
  const width = dv.getInt32(18, true);
  const heightAbs = Math.abs(dv.getInt32(22, true));
  const bpp = dv.getUint16(28, true);
  const topDown = dv.getInt32(22, true) < 0;
  const compression = dv.getUint32(30, true);

  if (compression !== 0 || (bpp !== 24 && bpp !== 32)) {
    return createFallbackTexture(heightAbs > 0 ? heightAbs : 1, 1);
  }

  const bytesPerPixel = bpp / 8;
  const rowStride = Math.ceil((width * bytesPerPixel) / 4) * 4;
  const height = heightAbs;

  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const srcRow = topDown ? y : height - 1 - y;
    const srcOff = pixelOffset + srcRow * rowStride;
    const dstOff = y * width * 4;
    for (let x = 0; x < width; x++) {
      const si = srcOff + x * bytesPerPixel;
      const di = dstOff + x * 4;
      pixels[di] = raw[si + 2];
      pixels[di + 1] = raw[si + 1];
      pixels[di + 2] = raw[si];
      pixels[di + 3] = bytesPerPixel === 4 ? raw[si + 3] : 255;
    }
  }

  return { width, height, pixels, hasAlpha: bytesPerPixel === 4 };
}

function decodeTGA(data: Uint8Array): DecodedTexture | null {
  const raw = new Uint8Array(data);
  const dv = new DataView(raw.buffer);

  if (raw[0] === 0x47 && raw[1] === 0x38) decryptTGAHeader(raw);

  const idLen = raw[0];
  const imageType = raw[2];
  const width = dv.getUint16(12, true);
  const height = dv.getUint16(14, true);
  const bpp = raw[16];
  const descriptor = raw[17];
  const topDown = (descriptor & 0x20) !== 0;

  if (imageType !== 2 && imageType !== 10) return null;
  if (width === 0 || height === 0) return null;

  const bytesPerPixel = bpp / 8;
  const pixelDataOffset = 18 + idLen;
  const pixels = new Uint8Array(width * height * 4);

  if (imageType === 2) {
    let si = pixelDataOffset;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const di = (y * width + x) * 4;
        pixels[di] = raw[si + 2];
        pixels[di + 1] = raw[si + 1];
        pixels[di + 2] = raw[si];
        if (bytesPerPixel === 4) {
          pixels[di + 3] = raw[si + 3];
          si += 4;
        } else {
          pixels[di + 3] = 255;
          si += 3;
        }
      }
    }
    if (!topDown) flipVertically(pixels, width, height);
    return { width, height, pixels, hasAlpha: bytesPerPixel === 4 };
  }

  // RLE (imageType 10)
  let si = pixelDataOffset;
  let di = 0;
  const total = width * height;
  while (di < total && si < raw.length) {
    const chunk = raw[si++];
    const count = (chunk & 0x7f) + 1;
    if (chunk & 0x80) {
      const b = raw[si], g = raw[si + 1], r = raw[si + 2];
      const a = bytesPerPixel === 4 ? raw[si + 3] : 255;
      si += bytesPerPixel;
      for (let j = 0; j < count && di < total; j++) {
        const o = di * 4;
        pixels[o] = r; pixels[o + 1] = g; pixels[o + 2] = b; pixels[o + 3] = a;
        di++;
      }
    } else {
      for (let j = 0; j < count && di < total; j++) {
        const b = raw[si], g = raw[si + 1], r = raw[si + 2];
        const a = bytesPerPixel === 4 ? raw[si + 3] : 255;
        si += bytesPerPixel;
        const o = di * 4;
        pixels[o] = r; pixels[o + 1] = g; pixels[o + 2] = b; pixels[o + 3] = a;
        di++;
      }
    }
  }
  if (!topDown) flipVertically(pixels, width, height);
  return { width, height, pixels, hasAlpha: bytesPerPixel === 4 };
}

function flipVertically(pixels: Uint8Array, width: number, height: number): void {
  const row = width * 4;
  const tmp = new Uint8Array(row);
  for (let y = 0; y < height / 2; y++) {
    const top = y * row;
    const bot = (height - 1 - y) * row;
    tmp.set(pixels.subarray(top, top + row));
    pixels.set(pixels.subarray(bot, bot + row), top);
    pixels.set(tmp, bot);
  }
}

function createFallbackTexture(w: number, h: number): DecodedTexture {
  const pixels = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const checker = ((x >> 3) + (y >> 3)) & 1;
      pixels[i] = checker ? 200 : 50;
      pixels[i + 1] = checker ? 50 : 200;
      pixels[i + 2] = 150;
      pixels[i + 3] = 255;
    }
  }
  return { width: w, height: h, pixels };
}
