import { crc32, deflateRawSync } from 'node:zlib'

/**
 * A minimal ZIP writer, enough to build an EPUB.
 *
 * Written rather than installed because the only archive this project makes is
 * an EPUB, and an EPUB is a zip with four fixed files in it. A dependency for
 * that would be more code to audit than the format needs, and it would run in
 * a serverless function on every export.
 *
 * Only what EPUB requires: STORE and DEFLATE, no encryption, no Zip64, no
 * directory entries. An exported novel is a few hundred kilobytes of text, so
 * the 4 GB and 65,535-entry limits of classic zip are not in reach.
 *
 * Everything is UTF-8 and the language-encoding flag (bit 11) is set, so a CJK
 * filename survives the trip. EPUB itself only uses ASCII names internally,
 * but the flag costs nothing and the writer is general.
 */

export type ZipEntry = {
  path: string
  data: Buffer | string
  /**
   * Stored uncompressed. The EPUB spec requires exactly this for `mimetype`,
   * which must also be the first entry — a reader looks for the magic string
   * at a fixed offset and will reject the file otherwise.
   */
  store?: boolean
}

type Central = {
  path: Buffer
  crc: number
  compressedSize: number
  size: number
  method: number
  offset: number
}

export function createZip(entries: ZipEntry[]): Buffer {
  const chunks: Buffer[] = []
  const central: Central[] = []
  let offset = 0

  for (const entry of entries) {
    const path = Buffer.from(entry.path, 'utf8')
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8')

    const deflated = entry.store ? data : deflateRawSync(data)
    /*
     * Deflate can make small or already-compressed input larger. Storing it
     * instead keeps the archive from growing, and every reader handles both.
     */
    const useStore = entry.store || deflated.length >= data.length
    const payload = useStore ? data : deflated
    const method = useStore ? 0 : 8

    const crc = crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0) // local file header signature
    local.writeUInt16LE(20, 4) // version needed: 2.0 (deflate)
    local.writeUInt16LE(0x0800, 6) // flags: filename is UTF-8
    local.writeUInt16LE(method, 8)
    // DOS time/date. Fixed at 1980-01-01, the epoch of the format: the export
    // is reproducible, and the real timestamp is in the filename anyway.
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0x0021, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(path.length, 26)
    local.writeUInt16LE(0, 28) // extra field length

    chunks.push(local, path, payload)

    central.push({
      path,
      crc,
      compressedSize: payload.length,
      size: data.length,
      method,
      offset,
    })

    offset += local.length + path.length + payload.length
  }

  const directoryStart = offset

  for (const entry of central) {
    const header = Buffer.alloc(46)
    header.writeUInt32LE(0x02014b50, 0) // central directory signature
    header.writeUInt16LE(0x031e, 4) // version made by: 3.0, Unix
    header.writeUInt16LE(20, 6)
    header.writeUInt16LE(0x0800, 8)
    header.writeUInt16LE(entry.method, 10)
    header.writeUInt16LE(0, 12)
    header.writeUInt16LE(0x0021, 14)
    header.writeUInt32LE(entry.crc, 16)
    header.writeUInt32LE(entry.compressedSize, 20)
    header.writeUInt32LE(entry.size, 24)
    header.writeUInt16LE(entry.path.length, 28)
    header.writeUInt16LE(0, 30) // extra
    header.writeUInt16LE(0, 32) // comment
    header.writeUInt16LE(0, 34) // disk number
    header.writeUInt16LE(0, 36) // internal attributes
    header.writeUInt32LE(0o644 << 16, 38) // external attributes: rw-r--r--
    header.writeUInt32LE(entry.offset, 42)

    chunks.push(header, entry.path)
    offset += header.length + entry.path.length
  }

  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0) // end of central directory
  end.writeUInt16LE(0, 4) // this disk
  end.writeUInt16LE(0, 6) // disk with directory
  end.writeUInt16LE(central.length, 8)
  end.writeUInt16LE(central.length, 10)
  end.writeUInt32LE(offset - directoryStart, 12)
  end.writeUInt32LE(directoryStart, 16)
  end.writeUInt16LE(0, 20) // comment length

  chunks.push(end)

  return Buffer.concat(chunks)
}
