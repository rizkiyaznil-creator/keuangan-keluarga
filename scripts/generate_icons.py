#!/usr/bin/env python3
"""Membuat ikon PWA (PNG) tanpa dependensi eksternal (hanya stdlib zlib).

Desain: latar teal full-bleed (ramah "maskable"), dompet putih dengan slot
kartu, dan koin amber. Dipakai sekali untuk menghasilkan berkas di folder
icons/. Jalankan: python3 scripts/generate_icons.py
"""
import os
import struct
import zlib

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")


def write_png(path, size, pixels):
    """pixels: bytearray RGBA sepanjang size*size*4."""
    def chunk(typ, data):
        return (struct.pack(">I", len(data)) + typ + data
                + struct.pack(">I", zlib.crc32(typ + data) & 0xffffffff))

    stride = size * 4
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter type 0 (None)
        raw += pixels[y * stride:(y + 1) * stride]

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # RGBA 8-bit
    idat = zlib.compress(bytes(raw), 9)
    with open(path, "wb") as f:
        f.write(sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b""))


def lerp(a, b, t):
    return a + (b - a) * t


def in_round_rect(x, y, x0, y0, x1, y1, r):
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def make_icon(size):
    ss = max(1, min(6, 1400 // size))   # supersampling untuk tepi halus
    W = size * ss
    hi = bytearray(W * W * 4)

    top = (15, 118, 110)    # teal-700
    bot = (17, 80, 76)      # teal-900-ish
    white = (255, 255, 255)
    slot = (13, 148, 136)   # teal-600
    coin = (245, 158, 11)   # amber-500

    wx0, wy0, wx1, wy1 = 0.24 * W, 0.33 * W, 0.76 * W, 0.65 * W
    rad = 0.05 * W
    slot_y0, slot_y1 = 0.40 * W, 0.455 * W
    slot_x0, slot_x1 = wx0 + 0.03 * W, wx1 - 0.03 * W
    coin_cx, coin_cy, coin_r = 0.635 * W, 0.635 * W, 0.135 * W

    for y in range(W):
        ty = y / (W - 1)
        bg = (int(lerp(top[0], bot[0], ty)), int(lerp(top[1], bot[1], ty)), int(lerp(top[2], bot[2], ty)))
        row = y * W
        for x in range(W):
            r, g, b = bg
            if in_round_rect(x, y, wx0, wy0, wx1, wy1, rad):
                r, g, b = white
                if slot_y0 <= y <= slot_y1 and slot_x0 <= x <= slot_x1:
                    r, g, b = slot
            dx, dy = x - coin_cx, y - coin_cy
            d2 = dx * dx + dy * dy
            if d2 <= coin_r * coin_r:
                r, g, b = white if d2 >= (coin_r * 0.74) ** 2 else coin
            i = (row + x) * 4
            hi[i] = r; hi[i + 1] = g; hi[i + 2] = b; hi[i + 3] = 255

    if ss == 1:
        return hi

    out = bytearray(size * size * 4)
    n = ss * ss
    for oy in range(size):
        for ox in range(size):
            ar = ag = ab = 0
            for j in range(ss):
                base = ((oy * ss + j) * W + ox * ss) * 4
                for k in range(ss):
                    p = base + k * 4
                    ar += hi[p]; ag += hi[p + 1]; ab += hi[p + 2]
            o = (oy * size + ox) * 4
            out[o] = ar // n; out[o + 1] = ag // n; out[o + 2] = ab // n; out[o + 3] = 255
    return out


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    targets = {
        "icon-192.png": 192,
        "icon-512.png": 512,
        "apple-touch-icon.png": 180,
        "favicon-32.png": 32,
    }
    for name, size in targets.items():
        path = os.path.join(OUT_DIR, name)
        write_png(path, size, make_icon(size))
        print("dibuat:", path, f"({size}x{size})")


if __name__ == "__main__":
    main()
