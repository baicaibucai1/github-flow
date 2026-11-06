//! 只做一件事：从图片文件头里读出宽高。
//!
//! 之所以不引入 `image`  crate：采集期要判断「这张图能不能当封面」，
//! 需要的只是宽高两个整数，为此拉一个带各种编解码器的依赖不值得。
//! 这里只认四种最常见的格式，认不出就返回 None —— 认不出的图本来也不该当封面。

/// 从文件开头若干字节里读出（宽, 高）。
pub fn dims(b: &[u8]) -> Option<(u32, u32)> {
    if b.len() >= 24 && b.starts_with(b"\x89PNG\r\n\x1a\n") && &b[12..16] == b"IHDR" {
        let w = u32::from_be_bytes([b[16], b[17], b[18], b[19]]);
        let h = u32::from_be_bytes([b[20], b[21], b[22], b[23]]);
        return Some((w, h));
    }
    if b.len() >= 10 && (b.starts_with(b"GIF87a") || b.starts_with(b"GIF89a")) {
        let w = u16::from_le_bytes([b[6], b[7]]) as u32;
        let h = u16::from_le_bytes([b[8], b[9]]) as u32;
        return Some((w, h));
    }
    if b.len() >= 30 && &b[0..4] == b"RIFF" && &b[8..12] == b"WEBP" {
        return webp(b);
    }
    if b.len() >= 4 && b[0] == 0xFF && b[1] == 0xD8 {
        return jpeg(b);
    }
    None
}

fn webp(b: &[u8]) -> Option<(u32, u32)> {
    match &b[12..16] {
        b"VP8X" => {
            // 24 位小端存的「宽-1 / 高-1」
            let w = 1 + (b[24] as u32 | (b[25] as u32) << 8 | (b[26] as u32) << 16);
            let h = 1 + (b[27] as u32 | (b[28] as u32) << 8 | (b[29] as u32) << 16);
            Some((w, h))
        }
        b"VP8 " => {
            // 关键帧头：3 字节起始码 + 2 字节宽 + 2 字节高（各 14 位）
            if b.len() < 30 {
                return None;
            }
            let w = u16::from_le_bytes([b[26], b[27]]) as u32 & 0x3fff;
            let h = u16::from_le_bytes([b[28], b[29]]) as u32 & 0x3fff;
            Some((w, h))
        }
        b"VP8L" => {
            if b.len() < 25 {
                return None;
            }
            let bits = u32::from_le_bytes([b[21], b[22], b[23], b[24]]);
            let w = (bits & 0x3fff) + 1;
            let h = ((bits >> 14) & 0x3fff) + 1;
            Some((w, h))
        }
        _ => None,
    }
}

fn jpeg(b: &[u8]) -> Option<(u32, u32)> {
    let mut i = 2;
    while i + 9 < b.len() {
        if b[i] != 0xFF {
            i += 1;
            continue;
        }
        let marker = b[i + 1];
        // SOF0..SOF15，其中 C4/C8/CC 不是帧头
        if (0xC0..=0xCF).contains(&marker) && !matches!(marker, 0xC4 | 0xC8 | 0xCC) {
            let h = u16::from_be_bytes([b[i + 5], b[i + 6]]) as u32;
            let w = u16::from_be_bytes([b[i + 7], b[i + 8]]) as u32;
            return Some((w, h));
        }
        let len = u16::from_be_bytes([b[i + 2], b[i + 3]]) as usize;
        if len < 2 {
            return None;
        }
        i += 2 + len;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn png_宽高() {
        let mut b = vec![0u8; 24];
        b[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        b[12..16].copy_from_slice(b"IHDR");
        b[16..20].copy_from_slice(&1280u32.to_be_bytes());
        b[20..24].copy_from_slice(&720u32.to_be_bytes());
        assert_eq!(dims(&b), Some((1280, 720)));
    }

    #[test]
    fn gif_宽高() {
        let mut b = vec![0u8; 10];
        b[..6].copy_from_slice(b"GIF89a");
        b[6..8].copy_from_slice(&320u16.to_le_bytes());
        b[8..10].copy_from_slice(&240u16.to_le_bytes());
        assert_eq!(dims(&b), Some((320, 240)));
    }

    #[test]
    fn jpeg_宽高() {
        // SOI + APP0(空) + SOF0(高 600 宽 800)
        let mut b = vec![0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x04, 0x00, 0x00];
        b.extend_from_slice(&[0xFF, 0xC0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0x20, 0x03]);
        assert_eq!(dims(&b), Some((800, 600)));
    }

    #[test]
    fn 认不出的返回_none() {
        assert_eq!(dims(b"hello world, not an image"), None);
        assert_eq!(dims(b""), None);
    }
}
