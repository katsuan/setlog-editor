function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Reads EXIF DateTimeOriginal (or DateTime) from a JPEG file, as "HH:MM" local capture time. */
export async function readPhotoShootTime(file: File): Promise<string | null> {
  const isJpeg =
    file.type === 'image/jpeg' || /\.(jpe?g)$/i.test(file.name)
  if (!isJpeg) return null

  try {
    const buf = await file.slice(0, 128 * 1024).arrayBuffer()
    const view = new DataView(buf)
    if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) return null

    let offset = 2
    while (offset + 4 <= view.byteLength) {
      const marker = view.getUint16(offset, false)
      if ((marker & 0xff00) !== 0xff00) break
      if (marker === 0xffd8 || marker === 0xffd9) {
        offset += 2
        continue
      }
      const segLength = view.getUint16(offset + 2, false)
      if (marker === 0xffe1 && offset + 4 + 6 <= view.byteLength) {
        const exifStart = offset + 4
        if (view.getUint32(exifStart, false) === 0x45786966) {
          const dateStr = parseExifDateTime(view, exifStart + 6)
          if (dateStr) return dateStr
        }
      }
      if (marker === 0xffda) break // start of scan — no more metadata segments follow
      offset += 2 + segLength
    }
  } catch {
    return null
  }
  return null
}

function parseExifDateTime(view: DataView, tiffStart: number): string | null {
  if (tiffStart + 8 > view.byteLength) return null
  const byteOrder = view.getUint16(tiffStart, false)
  const little = byteOrder === 0x4949
  if (byteOrder !== 0x4949 && byteOrder !== 0x4d4d) return null

  const u16 = (o: number) => view.getUint16(o, little)
  const u32 = (o: number) => view.getUint32(o, little)
  const ascii19 = (o: number) => {
    if (o + 19 > view.byteLength) return null
    let s = ''
    for (let i = 0; i < 19; i++) s += String.fromCharCode(view.getUint8(o + i))
    return s
  }

  const readIfd = (ifdOffset: number): { tag: number; entryOffset: number }[] => {
    if (ifdOffset + 2 > view.byteLength) return []
    const count = u16(ifdOffset)
    const entries = []
    for (let i = 0; i < count; i++) {
      const entryOffset = ifdOffset + 2 + i * 12
      if (entryOffset + 12 > view.byteLength) break
      entries.push({ tag: u16(entryOffset), entryOffset })
    }
    return entries
  }

  try {
    const ifd0Offset = tiffStart + u32(tiffStart + 4)
    const ifd0Entries = readIfd(ifd0Offset)

    let dateTimeStr: string | null = null
    let exifSubIfdOffset = -1
    for (const { tag, entryOffset } of ifd0Entries) {
      if (tag === 0x8769) exifSubIfdOffset = tiffStart + u32(entryOffset + 8)
      if (tag === 0x0132) dateTimeStr = ascii19(tiffStart + u32(entryOffset + 8))
    }

    if (exifSubIfdOffset >= 0) {
      for (const { tag, entryOffset } of readIfd(exifSubIfdOffset)) {
        if (tag === 0x9003 || tag === 0x9004) {
          const s = ascii19(tiffStart + u32(entryOffset + 8))
          if (s) {
            dateTimeStr = s
            break
          }
        }
      }
    }

    if (!dateTimeStr) return null
    const m = /^\d{4}:\d{2}:\d{2} (\d{2}):(\d{2}):\d{2}$/.exec(dateTimeStr)
    return m ? `${m[1]}:${m[2]}` : null
  } catch {
    return null
  }
}

const MP4_EPOCH_OFFSET_SECONDS = 2082844800 // seconds between 1904-01-01 and 1970-01-01 (Unix epoch)

/** Reads the mvhd creation_time from an MP4/MOV file, as "HH:MM" in the local timezone. */
export async function readVideoShootTime(file: File): Promise<string | null> {
  try {
    let offset = 0
    const fileSize = file.size
    // Bound how much we're willing to scan through top-level boxes before
    // giving up (moov can sit near the end of a "streaming-optimized" file).
    const maxScan = Math.min(fileSize, 200 * 1024 * 1024)

    while (offset < maxScan) {
      const header = await readBoxHeader(file, offset)
      if (!header) break
      const { boxType, boxSize, headerLen } = header
      if (boxSize <= 0) break

      if (boxType === 'moov') {
        const found = await findMvhdCreationTime(file, offset + headerLen, offset + boxSize)
        if (found != null) return unixSecondsToLocalClock(found)
        return null
      }
      offset += boxSize
    }
  } catch {
    return null
  }
  return null
}

async function readBoxHeader(
  file: File,
  offset: number,
): Promise<{ boxType: string; boxSize: number; headerLen: number } | null> {
  const buf = await file.slice(offset, offset + 8).arrayBuffer()
  if (buf.byteLength < 8) return null
  const view = new DataView(buf)
  let boxSize = view.getUint32(0, false)
  const boxType = String.fromCharCode(
    view.getUint8(4),
    view.getUint8(5),
    view.getUint8(6),
    view.getUint8(7),
  )
  let headerLen = 8
  if (boxSize === 1) {
    const largeBuf = await file.slice(offset + 8, offset + 16).arrayBuffer()
    if (largeBuf.byteLength < 8) return null
    boxSize = Number(new DataView(largeBuf).getBigUint64(0, false))
    headerLen = 16
  } else if (boxSize === 0) {
    boxSize = file.size - offset
  }
  return { boxType, boxSize, headerLen }
}

async function findMvhdCreationTime(
  file: File,
  start: number,
  end: number,
): Promise<number | null> {
  let offset = start
  while (offset < end) {
    const header = await readBoxHeader(file, offset)
    if (!header) return null
    const { boxType, boxSize, headerLen } = header
    if (boxSize <= 0) return null

    if (boxType === 'mvhd') {
      const bodyStart = offset + headerLen
      const versionBuf = await file.slice(bodyStart, bodyStart + 1).arrayBuffer()
      if (versionBuf.byteLength < 1) return null
      const version = new DataView(versionBuf).getUint8(0)
      if (version === 1) {
        const buf = await file.slice(bodyStart + 4, bodyStart + 12).arrayBuffer()
        if (buf.byteLength < 8) return null
        const creationTime = Number(new DataView(buf).getBigUint64(0, false))
        return creationTime - MP4_EPOCH_OFFSET_SECONDS
      }
      const buf = await file.slice(bodyStart + 4, bodyStart + 8).arrayBuffer()
      if (buf.byteLength < 4) return null
      const creationTime = new DataView(buf).getUint32(0, false)
      return creationTime - MP4_EPOCH_OFFSET_SECONDS
    }

    offset += boxSize
  }
  return null
}

function unixSecondsToLocalClock(unixSeconds: number): string | null {
  if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) return null
  const date = new Date(unixSeconds * 1000)
  if (Number.isNaN(date.getTime())) return null
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}
