// 2026-09-01 dödade en uppladdad logotyp hela API:t.
//
// Det var en palett-PNG med transparens. pdfkit avkodar PNG med png-js, som
// kastade `Z_DATA_ERROR: invalid distance too far back` ur zlib — asynkront,
// ur en callback. try/catch runt doc.image() fångade därför ingenting: felet
// blev ett ohanterat undantag och node-processen dog. Varje försök att generera
// en faktura gav 502 och systemd startade om tjänsten. Fyra gånger på en halvtimme.
//
// Åtgärden är att kontrollera bilden vid UPPLADDNING, där felet går att fånga
// synkront. Det här provet mäter att spärren sitter, och — lika viktigt — att
// den inte är en spärr mot allt. En validator som avvisade varje bild hade
// klarat det första fallet och ändå varit trasig, så varje avvisning här har en
// motsvarande godkänd bild bredvid sig.
//
// PNG:erna byggs i provet i stället för att checkas in som binärer: då står det
// i klartext VAD som gör en fil giftig (färgtyp 3 + tRNS), och fixturerna kan
// inte tyst sluta vara det de utger sig för att vara.
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { assertRenderableImage } from '../src/services/companyLogo.js';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([len, typeAndData, crc]);
}

/** colorType: 2 = RGB, 3 = palett. interlace: 0 = ingen, 1 = Adam7. */
function png(opts: { colorType: number; interlace?: number; trns?: boolean; idat?: Buffer }): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);          // bredd
  ihdr.writeUInt32BE(1, 4);          // höjd
  ihdr[8] = 8;                       // bitdjup
  ihdr[9] = opts.colorType;
  ihdr[10] = 0;                      // komprimering
  ihdr[11] = 0;                      // filter
  ihdr[12] = opts.interlace ?? 0;

  const parts = [SIGNATURE, chunk('IHDR', ihdr)];
  if (opts.colorType === 3) parts.push(chunk('PLTE', Buffer.from([0xff, 0x00, 0x00])));
  if (opts.trns) parts.push(chunk('tRNS', Buffer.from([0x00])));
  // En rad: filterbyte 0 + pixeldata (3 byte för RGB, 1 byte palettindex).
  const pixels = opts.colorType === 3 ? Buffer.from([0x00, 0x00]) : Buffer.from([0x00, 0xff, 0x00, 0x00]);
  parts.push(chunk('IDAT', opts.idat ?? deflateSync(pixels)));
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

// Minimal giltig JPEG-header. Innehållet spelar ingen roll — poängen är att
// kontrollen ska släppa förbi JPEG orört, eftersom pdfkit läser JPEG direkt
// utan att gå via png-js. Det var därför bytet till JPEG löste kraschen.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]);

const kör = (buf: Buffer, mime = 'image/png') => () => assertRenderableImage('logo.png', mime, buf);

describe('logotypen kontrolleras vid uppladdning', () => {
  it('fixturerna är vad de utger sig för att vara', () => {
    // Färgtypen ligger på offset 9 i IHDR-datan: 8 (signatur) + 8 (len+typ) + 9.
    expect(png({ colorType: 3, trns: true })[25], 'palettfixturen ska ha färgtyp 3').toBe(3);
    expect(png({ colorType: 2 })[25], 'RGB-fixturen ska ha färgtyp 2').toBe(2);
    expect(png({ colorType: 3, trns: true }).includes(Buffer.from('tRNS')), 'palettfixturen ska ha tRNS').toBe(true);
    expect(png({ colorType: 3 }).includes(Buffer.from('tRNS')), 'palett UTAN alfa ska sakna tRNS').toBe(false);
  });

  it('palett-PNG med transparens avvisas — det var filen som dödade processen', () => {
    expect(kör(png({ colorType: 3, trns: true }))).toThrow(/palett/i);
  });

  it('interlacad PNG avvisas — png-js stöder inte Adam7', () => {
    expect(kör(png({ colorType: 2, interlace: 1 }))).toThrow(/interlac/i);
  });

  it('PNG med trasig bildström avvisas i stället för att smälla vid rendering', () => {
    const skräp = Buffer.from([0x78, 0x9c, 0x00, 0x11, 0x22, 0x33, 0x44]);
    expect(kör(png({ colorType: 2, idat: skräp }))).toThrow(/packa upp/i);
  });

  it('fil med PNG-ändelse men utan PNG-signatur avvisas', () => {
    expect(kör(Buffer.from('det här är inte en bild'))).toThrow(/signatur/i);
  });

  // Negativa kontroller: utan dem kunde proven ovan vara gröna av fel skäl.
  it('vanlig RGB-PNG släpps igenom', () => {
    expect(kör(png({ colorType: 2 }))).not.toThrow();
  });

  it('palett-PNG UTAN transparens släpps igenom — det är alfakanalen som är problemet', () => {
    expect(kör(png({ colorType: 3 }))).not.toThrow();
  });

  it('JPEG rörs inte alls — pdfkit läser den utan png-js', () => {
    expect(kör(JPEG, 'image/jpeg')).not.toThrow();
  });
});
