"""生成 MacPet 的托盘图标。

用法：python3 build/make-tray.py
- macOS：模板图（只有 alpha 有效，系统按菜单栏深浅自动着色）→ trayTemplate.png / @2x
          深色菜单栏 = 白底圆角方 + 镂空深脸 + 白眼睛；浅色菜单栏整体反相。
- Windows：同造型但固定彩色（模板图的镂空在 Windows 上会露出任务栏底色，脸就看不见了）→ tray-win.png

造型：白色圆角方底 + 居中圆形脑袋（r=76/256）+ 两只白色竖椭圆眼睛，无呆毛。
超采样到 1024 再缩到 16/32px，保证菜单栏尺寸下轮廓干净。
"""

import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT16 = os.path.join(ROOT, "build", "trayTemplate.png")
OUT32 = os.path.join(ROOT, "build", "trayTemplate@2x.png")
OUT_WIN = os.path.join(ROOT, "build", "tray-win.png")

# 1024 超采样（16px 的 64 倍），缩到 16px 时边缘更干净
S = 1024

# 各元素比例（相对画布边长，与设计稿 256 画布一致）
PAD = 0.039          # 白色方底四周边距  ≈10/256
RADIUS = 0.226       # 圆角半径          ≈58/256
HEAD_R = 76 / 256    # 脑袋半径（居中）
EYE_DX = 27 / 256    # 眼睛中心相对中轴的偏移
EYE_RX = 11 / 256
EYE_RY = 15 / 256
EYE_CY = 0.5 - 0.028  # 眼睛中心略高于脑袋中心


def _eye_boxes():
    cx, cy = S // 2, int(S * EYE_CY)
    rx, ry = int(S * EYE_RX), int(S * EYE_RY)
    dx = int(S * EYE_DX)
    return [((cx + s * dx - rx, cy - ry), (cx + s * dx + rx, cy + ry)) for s in (-1, 1)]


def draw_template():
    """模板图：白色方底实心，脑袋镂空（alpha=0），眼睛实心。"""
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    pad = int(S * PAD)
    d.rounded_rectangle((pad, pad, S - pad, S - pad),
                        radius=int(S * RADIUS), fill=(255, 255, 255, 255))

    # 脑袋：镂空，透出菜单栏底色
    c, r = S // 2, int(S * HEAD_R)
    d.ellipse((c - r, c - r, c + r, c + r), fill=(0, 0, 0, 0))

    # 眼睛：实心（模板图里会渲染成菜单栏的反色）
    for (x0, y0), (x1, y1) in _eye_boxes():
        d.ellipse((x0, y0, x1, y1), fill=(255, 255, 255, 255))
    return img


def draw_win():
    """Windows 彩色版：同造型，但脑袋用深棕色实心，眼睛留白。"""
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    PLATE = (255, 255, 255, 255)
    HEAD = (58, 36, 22, 255)
    EDGE = (0, 0, 0, 20)     # 极淡描边，浅色任务栏上也有边界

    pad = int(S * PAD)
    d.rounded_rectangle((pad, pad, S - pad, S - pad), radius=int(S * RADIUS),
                        fill=PLATE, outline=EDGE, width=max(1, S // 256))
    c, r = S // 2, int(S * HEAD_R)
    d.ellipse((c - r, c - r, c + r, c + r), fill=HEAD)

    for (x0, y0), (x1, y1) in _eye_boxes():
        d.ellipse((x0, y0, x1, y1), fill=(255, 255, 255, 255))
    return img


def make(img_fn, size, edge=False):
    img = img_fn().resize((size, size), Image.LANCZOS)
    if edge:
        # 缩小后再补 1px 描边，浅色任务栏上白底也有边界
        pad = round(size * PAD)
        d = ImageDraw.Draw(img)
        d.rounded_rectangle((pad, pad, size - 1 - pad, size - 1 - pad),
                            radius=round(size * RADIUS),
                            outline=(224, 217, 207, 255), width=1)
    return img


if __name__ == "__main__":
    make(draw_template, 16).save(OUT16)
    make(draw_template, 32).save(OUT32)
    # Windows 托盘：给 32px 母版，系统缩放到 16/20/24 都清楚
    make(draw_win, 32, edge=True).save(OUT_WIN)
    print("已生成:", OUT16, "和", OUT32, "和", OUT_WIN)
