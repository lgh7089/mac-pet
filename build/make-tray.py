"""生成 MacPet 的托盘图标。

用法：python3 build/make-tray.py
- macOS：模板图（黑色剪影，系统自动按深浅色反色）→ trayTemplate.png / @2x
- Windows：彩色小头像（模板图在 Windows 上会显示成一片白）→ tray-win.png
两者都是手绘矢量风格，超采样后缩小，保证 16px 下轮廓依然清晰。
"""

import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT16 = os.path.join(ROOT, "build", "trayTemplate.png")
OUT32 = os.path.join(ROOT, "build", "trayTemplate@2x.png")
OUT_WIN = os.path.join(ROOT, "build", "tray-win.png")

# 在 256 的画布上作画（16px 的 16 倍超采样）
CANVAS = 256


def draw_design():
    """黑色头部剪影，返回 RGBA 图（alpha 即形状）。"""
    img = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    FILL = (0, 0, 0, 255)

    # 呆毛：歪向右边的一个粗卷（半圆弧钩，下端埋进头顶确保连接）
    d.arc((118, 14, 186, 82), start=200, end=355, fill=FILL, width=22)

    # 脸：接近正圆的大脑袋
    d.ellipse((44, 62, 212, 230), fill=FILL)

    # 眼睛：两个竖椭圆镂空
    for cx in (100, 156):
        d.ellipse((cx - 15, 134, cx + 15, 180), fill=(0, 0, 0, 0))

    return img


def make_template(size):
    big = draw_design()
    return big.resize((size, size), Image.LANCZOS)


def draw_win_design():
    """Windows 用彩色小头像：银灰发 + 奶油脸 + 红蝴蝶结。"""
    img = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    HAIR = (201, 193, 184, 255)
    EDGE = (92, 79, 68, 255)
    FACE = (255, 234, 216, 255)
    EYE = (54, 34, 20, 255)
    BOW = (226, 96, 88, 255)

    # 呆毛
    d.arc((116, 10, 188, 82), start=196, end=352, fill=EDGE, width=18)
    # 头发轮廓（带深色描边，浅色任务栏上也看得清）
    d.ellipse((36, 46, 220, 240), fill=HAIR, outline=EDGE, width=7)
    # 脸
    d.ellipse((64, 96, 192, 230), fill=FACE)
    # 刘海：盖住额头
    d.chord((50, 58, 206, 202), start=184, end=356, fill=HAIR)
    # 眼睛 + 高光
    for cx in (97, 159):
        d.ellipse((cx - 14, 148, cx + 14, 192), fill=EYE)
        d.ellipse((cx - 5, 153, cx + 3, 165), fill=(255, 255, 255, 235))
    # 腮红
    for cx in (80, 176):
        d.ellipse((cx - 11, 196, cx + 11, 214), fill=(255, 176, 158, 150))
    # 蝴蝶结（右侧发侧）
    d.polygon([(208, 100), (238, 78), (238, 122)], fill=BOW)
    d.polygon([(208, 100), (178, 82), (178, 118)], fill=BOW)
    d.ellipse((196, 88, 220, 112), fill=(250, 132, 122, 255))
    return img


def make_win(size):
    return draw_win_design().resize((size, size), Image.LANCZOS)


make_template(16).save(OUT16)
make_template(32).save(OUT32)
# Windows 托盘：给 32px 母版，系统缩放到 16/20/24 都清楚
make_win(32).save(OUT_WIN)
print("已生成:", OUT16, "和", OUT32, "和", OUT_WIN)
