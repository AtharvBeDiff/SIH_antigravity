// EXIF reader — dependency-free GPS and capture-time extraction.
//
// Why this exists as hand-written byte parsing rather than a library: the backend's
// dependency set is deliberately minimal (see package.json), it runs .ts directly under
// Node with no build step, and it deploys to a platform where every native module is a
// deployment risk. An EXIF/image library would be the heaviest dependency in the tree to
// read four numbers out of a file header. So we read them ourselves.
//
// Scope: EXIF GPS latitude/longitude and DateTimeOriginal, from the containers a field
// photograph actually arrives in — JPEG (overwhelmingly the common case), PNG (`eXIf`
// chunk), and WebP (`EXIF` chunk). All three wrap the same TIFF/IFD structure, so one
// walker serves all three once the embedded TIFF blob is located.
//
// Contract: this module NEVER throws. Every malformed, truncated, or geotag-less image
// yields nulls, so a broken header degrades to "location not read" (Doctrine 11) and the
// geotag check simply does not run — it never crashes an upload and never fabricates a
// coordinate.

export interface ExifData {
  // Decimal degrees, hemisphere sign already applied (south/west negative). null = the
  // image carried no usable GPS tags. NEVER 0 for "absent": (0, 0) is a real point in the
  // Gulf of Guinea, and writing it for a missing geotag would invent a location.
  latitude: number | null;
  longitude: number | null;
  // EXIF DateTimeOriginal as "YYYY-MM-DDTHH:MM:SS" (the camera's local wall-clock; EXIF
  // carries no timezone). null if absent or a placeholder ("0000:00:00 00:00:00").
  takenAt: string | null;
}

const EMPTY: ExifData = { latitude: null, longitude: null, takenAt: null };

// EXIF/TIFF tag numbers we read.
const TAG_EXIF_SUBIFD = 0x8769; // pointer to the EXIF sub-IFD (holds DateTimeOriginal)
const TAG_GPS_IFD = 0x8825; // pointer to the GPS sub-IFD
const TAG_DATETIME = 0x0132; // DateTime, in IFD0 (fallback for capture time)
const TAG_DATETIME_ORIGINAL = 0x9003; // DateTimeOriginal, in the EXIF sub-IFD
const GPS_LAT_REF = 0x0001;
const GPS_LAT = 0x0002;
const GPS_LON_REF = 0x0003;
const GPS_LON = 0x0004;

// TIFF field type → byte width. Used to decide whether a value is inline (fits in the
// 4-byte value slot) or stored at an offset.
const TYPE_SIZE: Record<number, number> = {
  1: 1, // BYTE
  2: 1, // ASCII
  3: 2, // SHORT
  4: 4, // LONG
  5: 8, // RATIONAL (two LONGs: numerator, denominator)
  7: 1, // UNDEFINED
  9: 4, // SLONG
  10: 8, // SRATIONAL
};

interface IfdEntry {
  type: number;
  count: number;
  // Absolute offset within the TIFF blob where this entry's value data begins — already
  // resolved through the inline-vs-offset rule.
  valueOffset: number;
}

/** Top-level: read what we can, return nulls for anything unreadable. Never throws. */
export function readExif(input: Uint8Array | Buffer): ExifData {
  try {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const tiff = locateTiff(bytes);
    if (!tiff) return EMPTY;
    return parseTiff(tiff);
  } catch {
    // Any bounds error, malformed structure, or surprise input degrades to "not read".
    return EMPTY;
  }
}

// ─── Locate the embedded TIFF blob inside its container ─────────────────────

/** Returns the EXIF TIFF blob (starting at the "II"/"MM" byte-order mark) or null. */
function locateTiff(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 2) return null;

  // Already a bare TIFF/EXIF blob?
  if (isByteOrderMark(bytes, 0)) return bytes;

  // JPEG: 0xFF 0xD8 ...
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return locateTiffInJpeg(bytes);

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return locateTiffInPng(bytes);
  }

  // WebP: "RIFF" .... "WEBP"
  if (
    bytes.length >= 12 &&
    ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP'
  ) {
    return locateTiffInWebp(bytes);
  }

  return null;
}

function isByteOrderMark(bytes: Uint8Array, off: number): boolean {
  if (off + 2 > bytes.length) return false;
  const a = bytes[off];
  const b = bytes[off + 1];
  return (a === 0x49 && b === 0x49) || (a === 0x4d && b === 0x4d); // "II" or "MM"
}

// "Exif\0\0" — the APP1/EXIF payload prefix.
function hasExifPrefix(bytes: Uint8Array, off: number): boolean {
  return (
    off + 6 <= bytes.length &&
    bytes[off] === 0x45 && bytes[off + 1] === 0x78 && bytes[off + 2] === 0x69 &&
    bytes[off + 3] === 0x66 && bytes[off + 4] === 0x00 && bytes[off + 5] === 0x00
  );
}

function locateTiffInJpeg(bytes: Uint8Array): Uint8Array | null {
  let offset = 2; // past SOI
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null; // not aligned on a marker → give up
    const marker = bytes[offset + 1];

    // SOS (start of scan) — compressed data follows, no more header segments worth reading.
    if (marker === 0xda) return null;
    // Standalone markers with no length payload.
    if (marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2;
      continue;
    }

    const segLength = readU16BE(bytes, offset + 2); // includes the 2 length bytes
    if (segLength < 2) return null;
    const payloadStart = offset + 4;
    const payloadEnd = offset + 2 + segLength;
    if (payloadEnd > bytes.length) return null;

    if (marker === 0xe1 && hasExifPrefix(bytes, payloadStart)) {
      // TIFF begins right after "Exif\0\0".
      return bytes.subarray(payloadStart + 6, payloadEnd);
    }

    offset = payloadEnd; // skip this segment (APP0/JFIF, XMP APP1, quant tables, …)
  }
  return null;
}

function locateTiffInPng(bytes: Uint8Array): Uint8Array | null {
  let offset = 8; // past the 8-byte signature
  while (offset + 8 <= bytes.length) {
    const len = readU32BE(bytes, offset); // chunk data length (big-endian)
    const type = ascii(bytes, offset + 4, 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + len;
    if (dataEnd + 4 > bytes.length) return null; // +4 for the trailing CRC
    if (type === 'eXIf') {
      const blob = bytes.subarray(dataStart, dataEnd);
      // Standard eXIf data is a bare TIFF blob, but tolerate a stray "Exif\0\0" prefix.
      return hasExifPrefix(blob, 0) ? blob.subarray(6) : blob;
    }
    if (type === 'IEND') return null;
    offset = dataEnd + 4; // skip data + CRC
  }
  return null;
}

function locateTiffInWebp(bytes: Uint8Array): Uint8Array | null {
  let offset = 12; // past "RIFF" + size + "WEBP"
  while (offset + 8 <= bytes.length) {
    const fourcc = ascii(bytes, offset, 4);
    const len = readU32LE(bytes, offset + 4); // chunk size (little-endian)
    const dataStart = offset + 8;
    const dataEnd = dataStart + len;
    if (dataEnd > bytes.length) return null;
    if (fourcc === 'EXIF') {
      const blob = bytes.subarray(dataStart, dataEnd);
      return hasExifPrefix(blob, 0) ? blob.subarray(6) : blob;
    }
    // Chunks are padded to an even length.
    offset = dataEnd + (len % 2);
  }
  return null;
}

// ─── Parse the TIFF/IFD structure ───────────────────────────────────────────

function parseTiff(tiff: Uint8Array): ExifData {
  if (tiff.length < 8) return EMPTY;

  // Byte order: "II" = little-endian (Intel), "MM" = big-endian (Motorola).
  let le: boolean;
  if (tiff[0] === 0x49 && tiff[1] === 0x49) le = true;
  else if (tiff[0] === 0x4d && tiff[1] === 0x4d) le = false;
  else return EMPTY;

  if (readU16(tiff, 2, le) !== 0x002a) return EMPTY; // TIFF magic (42)

  const ifd0Offset = readU32(tiff, 4, le);
  if (ifd0Offset + 2 > tiff.length) return EMPTY;

  const ifd0 = parseIfd(tiff, ifd0Offset, le);
  if (!ifd0) return EMPTY;

  const result: ExifData = { latitude: null, longitude: null, takenAt: null };

  // GPS sub-IFD.
  const gpsPtr = ifd0.get(TAG_GPS_IFD);
  if (gpsPtr) {
    const gpsOffset = readU32(tiff, gpsPtr.valueOffset, le);
    const gps = parseIfd(tiff, gpsOffset, le);
    if (gps) {
      const lat = coordinate(tiff, gps.get(GPS_LAT), gps.get(GPS_LAT_REF), 'S', le);
      const lon = coordinate(tiff, gps.get(GPS_LON), gps.get(GPS_LON_REF), 'W', le);
      // Only accept a coordinate pair; a lone latitude is not a location.
      if (lat !== null && lon !== null) {
        result.latitude = lat;
        result.longitude = lon;
      }
    }
  }

  // Capture time: prefer DateTimeOriginal in the EXIF sub-IFD, fall back to IFD0 DateTime.
  const subPtr = ifd0.get(TAG_EXIF_SUBIFD);
  if (subPtr) {
    const subOffset = readU32(tiff, subPtr.valueOffset, le);
    const sub = parseIfd(tiff, subOffset, le);
    const original = sub?.get(TAG_DATETIME_ORIGINAL);
    if (sub && original) result.takenAt = parseExifDateTime(readAscii(tiff, original));
  }
  if (result.takenAt === null) {
    const dt = ifd0.get(TAG_DATETIME);
    if (dt) result.takenAt = parseExifDateTime(readAscii(tiff, dt));
  }

  return result;
}

/** Parse one IFD into tag → entry. Returns null on any bounds violation. */
function parseIfd(tiff: Uint8Array, ifdOffset: number, le: boolean): Map<number, IfdEntry> | null {
  if (ifdOffset < 0 || ifdOffset + 2 > tiff.length) return null;
  const count = readU16(tiff, ifdOffset, le);
  const entriesStart = ifdOffset + 2;
  if (entriesStart + count * 12 > tiff.length) return null;

  const entries = new Map<number, IfdEntry>();
  for (let i = 0; i < count; i++) {
    const entryOffset = entriesStart + i * 12;
    const tag = readU16(tiff, entryOffset, le);
    const type = readU16(tiff, entryOffset + 2, le);
    const cnt = readU32(tiff, entryOffset + 4, le);
    const size = TYPE_SIZE[type];
    if (!size) continue; // unknown type — skip this entry, keep parsing the rest

    const dataSize = size * cnt;
    // If the value fits in 4 bytes it is inline at entryOffset+8; otherwise those 4 bytes
    // are a LONG offset (from the TIFF start) to where the value actually lives.
    let valueOffset: number;
    if (dataSize <= 4) {
      valueOffset = entryOffset + 8;
    } else {
      valueOffset = readU32(tiff, entryOffset + 8, le);
      if (valueOffset < 0 || valueOffset + dataSize > tiff.length) continue; // out of range
    }
    entries.set(tag, { type, count: cnt, valueOffset });
  }
  return entries;
}

/**
 * Resolve a GPS coordinate (three RATIONALs: degrees, minutes, seconds) to signed decimal
 * degrees. `negativeRef` is the hemisphere letter that flips the sign ('S' for latitude,
 * 'W' for longitude).
 */
function coordinate(
  tiff: Uint8Array,
  value: IfdEntry | undefined,
  ref: IfdEntry | undefined,
  negativeRef: string,
  le: boolean,
): number | null {
  if (!value || value.count < 3) return null;
  const deg = readRational(tiff, value.valueOffset, le);
  const min = readRational(tiff, value.valueOffset + 8, le);
  const sec = readRational(tiff, value.valueOffset + 16, le);
  if (deg === null || min === null || sec === null) return null;

  let decimal = deg + min / 60 + sec / 3600;
  if (!Number.isFinite(decimal)) return null;

  const refStr = ref ? readAscii(tiff, ref).trim().toUpperCase() : '';
  if (refStr === negativeRef) decimal = -decimal;

  // Reject anything outside the valid coordinate range — a corrupt tag should read as
  // "not read", not as an impossible point.
  const limit = negativeRef === 'S' ? 90 : 180;
  if (Math.abs(decimal) > limit) return null;
  return decimal;
}

// ─── Low-level readers (all bounds-guarded) ─────────────────────────────────

function readRational(tiff: Uint8Array, offset: number, le: boolean): number | null {
  if (offset + 8 > tiff.length) return null;
  const num = readU32(tiff, offset, le);
  const den = readU32(tiff, offset + 4, le);
  if (den === 0) return null; // undefined ratio → not read
  return num / den;
}

function readAscii(tiff: Uint8Array, entry: IfdEntry): string {
  const end = Math.min(entry.valueOffset + entry.count, tiff.length);
  let out = '';
  for (let i = entry.valueOffset; i < end; i++) {
    const c = tiff[i];
    if (c === 0) break; // NUL-terminated
    out += String.fromCharCode(c);
  }
  return out;
}

function readU16(bytes: Uint8Array, off: number, le: boolean): number {
  return le ? readU16LE(bytes, off) : readU16BE(bytes, off);
}
function readU32(bytes: Uint8Array, off: number, le: boolean): number {
  return le ? readU32LE(bytes, off) : readU32BE(bytes, off);
}
function readU16BE(bytes: Uint8Array, off: number): number {
  return (bytes[off] << 8) | bytes[off + 1];
}
function readU16LE(bytes: Uint8Array, off: number): number {
  return bytes[off] | (bytes[off + 1] << 8);
}
function readU32BE(bytes: Uint8Array, off: number): number {
  // `>>> 0` keeps the result an unsigned 32-bit integer.
  return ((bytes[off] << 24) | (bytes[off + 1] << 16) | (bytes[off + 2] << 8) | bytes[off + 3]) >>> 0;
}
function readU32LE(bytes: Uint8Array, off: number): number {
  return (bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24)) >>> 0;
}

function ascii(bytes: Uint8Array, off: number, len: number): string {
  if (off + len > bytes.length) return '';
  let out = '';
  for (let i = 0; i < len; i++) out += String.fromCharCode(bytes[off + i]);
  return out;
}

/**
 * EXIF DateTimeOriginal is "YYYY:MM:DD HH:MM:SS", timezone-naive. Emit ISO-shaped
 * "YYYY-MM-DDTHH:MM:SS" (still zone-naive — the caller documents that). Returns null for
 * the all-zero placeholder or anything that does not parse to a real calendar time.
 */
function parseExifDateTime(raw: string): string | null {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(raw.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const year = Number(y), month = Number(mo), day = Number(d);
  const hour = Number(h), minute = Number(mi), second = Number(s);
  if (year < 1900 || year > 2100) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  // The per-field ranges above still let impossible calendar dates through — "2025:02:30",
  // "2025:04:31", a non-leap "2025:02:29". Round-trip through a UTC Date and reject if any
  // field drifted: Feb 30 rolls to Mar 2, so getUTCDate() no longer matches. This keeps the
  // docstring's promise (no fabricated capture time) without a per-month day table. Year is
  // already ≥ 1900, so Date.UTC's 0–99 → 1900s remap cannot bite.
  const dt = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day ||
    dt.getUTCHours() !== hour ||
    dt.getUTCMinutes() !== minute ||
    dt.getUTCSeconds() !== second
  ) {
    return null;
  }
  return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
}
