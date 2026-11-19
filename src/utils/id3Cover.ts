import { resolveAssetUrl } from './assetUrl';

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

function readSynchsafe32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] & 0x7f) << 21) |
    ((bytes[offset + 1] & 0x7f) << 14) |
    ((bytes[offset + 2] & 0x7f) << 7) |
    (bytes[offset + 3] & 0x7f)
  );
}

function detectImageMimeFromBytes(bytes: Uint8Array): string | null {
  if (bytes.length < 4) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
    return 'image/webp';
  }
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  return null;
}

function findNullTerminator(bytes: Uint8Array, start: number, encoding: number, limit: number): number {
  if (encoding === 1 || encoding === 2) {
    for (let i = start; i + 1 < limit; i += 2) {
      if (bytes[i] === 0 && bytes[i + 1] === 0) return i + 2;
    }
    return limit;
  }
  for (let i = start; i < limit; i++) {
    if (bytes[i] === 0) return i + 1;
  }
  return limit;
}

export interface ExtractedId3Cover {
  bytes: Uint8Array;
  mime: string;
}

export function extractId3CoverBytes(buffer: ArrayBuffer): ExtractedId3Cover | null {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 16) return null;
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) {
    return null; // Not ID3v2
  }

  const majorVersion = bytes[3];
  const flags = bytes[5];
  const tagSize = readSynchsafe32(bytes, 6);
  const tagEnd = Math.min(bytes.length, 10 + tagSize);

  let pos = 10;
  // Skip extended header if present
  if ((flags & 0x40) !== 0 && pos + 4 <= tagEnd) {
    const extSize =
      majorVersion === 4 ? readSynchsafe32(bytes, pos) : readUint32BE(bytes, pos);
    pos += majorVersion === 4 ? extSize : extSize + 4;
  }

  while (pos < tagEnd) {
    if (majorVersion === 2) {
      if (pos + 6 > tagEnd) break;
      const frameId = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2]);
      if (frameId === '\0\0\0') break;
      const frameSize = (bytes[pos + 3] << 16) | (bytes[pos + 4] << 8) | bytes[pos + 5];
      pos += 6;
      if (frameSize <= 0 || pos + frameSize > tagEnd) break;
      if (frameId === 'PIC') {
        const encoding = bytes[pos];
        // 3 bytes image format (e.g. PNG/JPG), 1 byte picture type, description
        const descStart = pos + 5;
        const imgStart = findNullTerminator(bytes, descStart, encoding, pos + frameSize);
        const imgBytes = bytes.slice(imgStart, pos + frameSize);
        const mime = detectImageMimeFromBytes(imgBytes) || 'image/jpeg';
        if (imgBytes.length > 64) return { bytes: imgBytes, mime };
      }
      pos += frameSize;
    } else {
      if (pos + 10 > tagEnd) break;
      const frameId = String.fromCharCode(
        bytes[pos],
        bytes[pos + 1],
        bytes[pos + 2],
        bytes[pos + 3]
      );
      if (bytes[pos] === 0) break;

      let frameSize =
        majorVersion === 4
          ? readSynchsafe32(bytes, pos + 4)
          : readUint32BE(bytes, pos + 4);
      // Some ID3v2.4 taggers write raw 32-bit size instead of synchsafe
      if (majorVersion === 4 && pos + 10 + frameSize > tagEnd) {
        const rawSize = readUint32BE(bytes, pos + 4);
        if (pos + 10 + rawSize <= tagEnd) {
          frameSize = rawSize;
        }
      }

      pos += 10;
      if (frameSize <= 0 || pos + frameSize > tagEnd) break;

      if (frameId === 'APIC') {
        const frameEnd = pos + frameSize;
        const encoding = bytes[pos];
        let cursor = pos + 1;
        let mimeBytes = '';
        while (cursor < frameEnd && bytes[cursor] !== 0) {
          mimeBytes += String.fromCharCode(bytes[cursor]);
          cursor += 1;
        }
        cursor += 1; // skip null
        cursor += 1; // skip picture type byte
        cursor = findNullTerminator(bytes, cursor, encoding, frameEnd);
        if (cursor < frameEnd) {
          const imgBytes = bytes.slice(cursor, frameEnd);
          const detected = detectImageMimeFromBytes(imgBytes);
          const mime =
            detected ||
            (mimeBytes.includes('/') ? mimeBytes : mimeBytes === 'png' ? 'image/png' : 'image/jpeg');
          if (imgBytes.length > 64) {
            return { bytes: imgBytes, mime };
          }
        }
      }
      pos += frameSize;
    }
  }
  return null;
}

async function blobToResizedDataUrl(blob: Blob, maxSize = 240): Promise<string> {
  return new Promise((resolve, reject) => {
    const objUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxSize / Math.max(img.width || maxSize, img.height || maxSize));
        const w = Math.max(1, Math.round((img.width || maxSize) * scale));
        const h = Math.max(1, Math.round((img.height || maxSize) * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(objUrl);
          reject(new Error('no_canvas'));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.84);
        URL.revokeObjectURL(objUrl);
        resolve(dataUrl);
      } catch (err) {
        URL.revokeObjectURL(objUrl);
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objUrl);
      reject(new Error('img_decode_failed'));
    };
    img.src = objUrl;
  });
}

export async function extractAndResizeId3CoverFromBlob(
  blob: Blob
): Promise<string | undefined> {
  try {
    const slice = blob.slice(0, 768 * 1024);
    const buf = await slice.arrayBuffer();
    const extracted = extractId3CoverBytes(buf);
    if (!extracted) return undefined;
    const copy = new Uint8Array(extracted.bytes);
    const imgBlob = new Blob([copy], { type: extracted.mime });
    return await blobToResizedDataUrl(imgBlob, 240);
  } catch {
    return undefined;
  }
}

const urlCoverCache = new Map<string, string | null>();

export async function resolveTrackCoverUrl(track: {
  coverUrl?: string;
  audioUrl?: string;
}): Promise<string | undefined> {
  if (track.coverUrl && track.coverUrl.trim()) {
    return track.coverUrl;
  }
  const rawUrl = track.audioUrl?.trim();
  if (!rawUrl) return undefined;

  const resolved = resolveAssetUrl(rawUrl);
  if (urlCoverCache.has(resolved)) {
    return urlCoverCache.get(resolved) || undefined;
  }

  try {
    const res = await fetch(resolved, {
      headers: resolved.startsWith('blob:') ? undefined : { Range: 'bytes=0-786431' },
    });
    if (!res.ok && res.status !== 206) {
      urlCoverCache.set(resolved, null);
      return undefined;
    }
    const buf = await res.arrayBuffer();
    const extracted = extractId3CoverBytes(buf);
    if (!extracted) {
      urlCoverCache.set(resolved, null);
      return undefined;
    }
    const copy = new Uint8Array(extracted.bytes);
    const imgBlob = new Blob([copy], { type: extracted.mime });
    const dataUrl = await blobToResizedDataUrl(imgBlob, 240);
    urlCoverCache.set(resolved, dataUrl);
    return dataUrl;
  } catch {
    urlCoverCache.set(resolved, null);
    return undefined;
  }
}
