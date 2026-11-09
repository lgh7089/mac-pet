#!/usr/bin/env python3
"""生成 MacPet 的应用图标（macOS .icns + Windows .ico）。

用法：python3 build/make-icon.py
读取 assets/girl/idle_0.png，合成圆角底 + 桌宠形象 + 投影的 1024px 图标，
输出 build/icon.iconset/ 并用 iconutil 转成 build/icon.icns；
在非 macOS 上会跳过 icns，Windows 用的 build/icon.ico 始终生成。
"""

import os
import shutil
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FROG = os.path.join(ROOT, "assets", "girl", "idle_0.png")
OUT_DIR = os.path.join(ROOT, "build")
ICONSET = os.path.join(OUT_DIR, "icon.iconset")

CANVAS = 1024
CONTENT = 824          # macOS 大苏尔风格：图标内容占 824，四周留 100 边距
MARGIN = (CANVAS - CONTENT) // 2
RADIUS = 185           # 圆角半径，接近官方 squircle 的观感

# 背景：奶油暖色渐变（配白发红结的小姑娘）
BG_TOP = (255, 238, 214)    # #FFEE D6
BG_BOTTOM = (247, 196, 161) # #F7C4A1


def rounded_mask(size, box, radius):
    mask = Image.new("L", size, 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle(box, radius=radius, fill=255)
    return mask


def build_base():
    """1024 透明画布 + 渐变圆角底 + 顶部微高光。"""
    img = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))

    grad = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grad)
    for y in range(MARGIN, MARGIN + CONTENT):
        t = (y - MARGIN) / CONTENT
        color = tuple(round(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * t) for i in range(3)) + (255,)
        gd.line([(MARGIN, y), (MARGIN + CONTENT, y)], fill=color)

    mask = rounded_mask((CANVAS, CANVAS), (MARGIN, MARGIN, MARGIN + CONTENT, MARGIN + CONTENT), RADIUS)
    grad.putalpha(mask)
    img.alpha_composite(grad)

    # 顶部高光：上沿往下渐隐的白色，让底板有一点立体感
    hl = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    hd = ImageDraw.Draw(hl)
    for i in range(70):
        alpha = int(30 * (1 - i / 70))
        hd.rounded_rectangle(
            (MARGIN + i, MARGIN + i, MARGIN + CONTENT - i, MARGIN + CONTENT - i),
            radius=max(0, RADIUS - i), outline=(255, 255, 255, alpha), width=2
        )
    img.alpha_composite(hl)
    return img


def paste_frog(img):
    frog = Image.open(FROG).convert("RGBA")
    scale = 6  # 96px 素材最近邻放大 6 倍 = 576px，边缘保持锐利
    frog = frog.resize((96 * scale, 96 * scale), Image.LANCZOS)

    # 脚底对齐：素材脚底在第 92 行，让它落在底板下方约 90% 高度处
    feet_row = 92
    target_feet = MARGIN + int(CONTENT * 0.90)
    x = (CANVAS - frog.width) // 2
    y = target_feet - feet_row * scale

    # 投影：脚下一个椭圆软阴影
    shadow = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.ellipse(
        (CANVAS // 2 - 230, target_feet - 20, CANVAS // 2 + 230, target_feet + 34),
        fill=(150, 90, 50, 60)
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(14))
    img.alpha_composite(shadow)
    img.alpha_composite(frog, (x, y))


def main():
    base = build_base()
    paste_frog(base)

    # Windows：单个 .ico 内含多尺寸，任务栏/资源管理器/安装包都用它
    ico = os.path.join(OUT_DIR, "icon.ico")
    base.save(
        ico,
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print("已生成:", ico)

    # macOS：iconset + iconutil（iconutil 只有 macOS 有）
    os.makedirs(ICONSET, exist_ok=True)
    base.save(os.path.join(ICONSET, "icon_512x512@2x.png"))  # 1024
    sizes = [16, 32, 128, 256, 512]
    for s in sizes:
        base.resize((s, s), Image.LANCZOS).save(os.path.join(ICONSET, f"icon_{s}x{s}.png"))
        base.resize((s * 2, s * 2), Image.LANCZOS).save(os.path.join(ICONSET, f"icon_{s}x{s}@2x.png"))

    if sys.platform != "darwin" or not shutil.which("iconutil"):
        print("跳过 icns（需要 macOS 的 iconutil）")
        return 0

    icns = os.path.join(OUT_DIR, "icon.icns")
    subprocess.run(["iconutil", "-c", "icns", ICONSET, "-o", icns], check=True)
    print("已生成:", icns)
    return 0


if __name__ == "__main__":
    sys.exit(main())
