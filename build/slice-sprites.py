#!/usr/bin/env python3
"""把分镜图切片成桌宠序列帧（支持多形态）。

用法:
  python3 slice-sprites.py girl            # design/sheets -> assets/girl
  python3 slice-sprites.py sunny           # design/weather/sunny -> assets/weather/sunny

流程：连通域检测找角色 -> 过滤小漂浮物（雨滴/落叶/星光等）-> 裁剪 ->
泛洪去白底 -> 按动作统一缩放（以该动作第一个姿势为基准）-> 底部对齐 ->
输出 96x96 帧与总览图。
"""

import os
import sys
from collections import deque

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SIZE = 288        # 单帧素材边长（3x 高清版；渲染层显示尺寸不变，baseScale 相应调整）
GROUND = 276
TARGET_H = 246    # 单帧内角色目标高度（留头顶呆毛/帽子余量）

# 天气形态共用 8 张分镜图（固定 2 行 x 4 列网格，按格子取帧，多余格子留空）
# 格子布局: (文件名, 列数, 行数, [(动作, 帧数)...]) —— 动作按格子阅读顺序消耗
WEATHER_MAP = [
    ("s1.png", 4, 2, [("idle", 4), ("drag", 2)]),
    ("s2.png", 4, 2, [("walk", 4), ("sit", 2)]),
    ("s3.png", 4, 2, [("run", 4), ("fall", 3)]),
    ("s4.png", 4, 2, [("jump", 5), ("sleep", 3)]),
    ("s5.png", 4, 2, [("laugh", 6)]),
    ("s6.png", 4, 2, [("eat", 4), ("wave", 4)]),
    ("s7.png", 4, 2, [("dance", 4), ("dizzy", 3)]),
    ("s8.png", 4, 2, [("love", 3)]),
]

FORMS = {
    "girl": {
        "sheets": os.path.join(ROOT, "design", "sheets"),
        "out": os.path.join(ROOT, "assets", "girl"),
        "map": [
            ("Character_turnaround_sprite_sh_2026-11-02T02-57-21.png", [("idle", 4)]),
            ("Sprite_sheet__exactly_4_poses__2026-11-02T02-58-55.png", [("walk", 4)]),
            ("Sprite_sheet__exactly_4_poses__2026-11-02T02-59-13.png", [("run", 4)]),
            ("Sprite_sheet__exactly_5_poses__2026-11-02T02-59-33.png", [("jump", 5)]),
            ("Sprite_sheet__exactly_6_poses__2026-11-02T02-59-49.png", [("laugh", 6)]),
            ("Sprite_sheet__exactly_3_poses__2026-11-02T03-00-38.png", [("sleep", 3)]),
            ("Sprite_sheet__exactly_4_poses__2026-11-02T03-00-52.png", [("eat", 4)]),
            ("Sprite_sheet__exactly_2_poses__2026-11-02T03-01-10.png", [("drag", 2)]),
            ("Sprite_sheet__exactly_4_poses__2026-11-02T03-01-26.png", [("wave", 4)]),
            ("Sprite_sheet__exactly_4_poses__2026-11-02T03-02-06.png", [("dance", 4)]),
            ("Sprite_sheet__exactly_3_poses__2026-11-02T03-02-33.png", [("dizzy", 3)]),
            ("Sprite_sheet__exactly_3_poses__2026-11-02T03-02-52.png", [("fall", 3)]),
            ("Sprite_sheet__exactly_2_rows_i_2026-11-02T03-03-09.png", [("sit", 2)]),
            ("Sprite_sheet__exactly_3_poses__2026-11-02T03-05-51.png", [("love", 3)]),
        ],
        "min_ratio": 0.0,
    },
}

# 6 种天气形态共用 WEATHER_MAP
# 6 种天气形态共用 WEATHER_MAP；按形态微调（动作重分配 / 追加补充图）
MAP_EDITS = {
    "snow": {
        "s4.png": [("jump", 5)],                 # 睡姿行跨格，改由 s4b 单独提供
        "extra": [("s4b.png", 3, 1, [("sleep", 3)])],
    },
    "windy": {
        "s4.png": [("jump", 5)],
        "extra": [("s4b.png", 3, 1, [("sleep", 3)])],
    },
    # storm 的分镜图布局不同：s4=jump(1x5)、s5=sleep(1x3)、
    # s6=laugh、s7=eat+wave、s8=dance+dizzy、s9=love(1x3)
    "storm": {
        "s4.png": [("jump", 5)],
        "s5.png": [("sleep", 3)],
        "s6.png": [("laugh", 6)],
        "s7.png": [("eat", 4), ("wave", 4)],
        "s8.png": [("dance", 4), ("dizzy", 3)],
        "extra": [("s9.png", 3, 1, [("love", 3)])],
    },
}

for _f in ("sunny", "cloudy", "rain", "snow", "windy", "storm"):
    _map = [[fn, c, r, list(a)] for fn, c, r, a in WEATHER_MAP]
    _edits = MAP_EDITS.get(_f, {})
    for _e in _map:
        if _e[0] in _edits and isinstance(_edits[_e[0]], list):
            _e[3] = _edits[_e[0]]
    _map.extend(_edits.get("extra", []))
    FORMS[_f] = {
        "sheets": os.path.join(ROOT, "design", "weather", _f),
        "out": os.path.join(ROOT, "assets", "weather", _f),
        "map": _map,
        "grid": True,          # 按网格格子取帧
        "cell_ratio": 0.22,    # 格内丢弃面积不足主体 22% 的小组件（雨滴/落叶等）
    }

# 单张分镜图的网格覆盖（模型偶尔不按 2x4 出图时手动指定）
GRID_OVERRIDES = {
    ("cloudy", "s5.png"): (3, 2),
    ("snow", "s8.png"): (3, 1),
    ("sunny", "s8.png"): (3, 1),
    ("windy", "s8.png"): (3, 1),
    ("storm", "s4.png"): (5, 1),
    ("storm", "s5.png"): (3, 1),
    ("storm", "s9.png"): (3, 1),
}

# 个别帧的垂直位移微调（跳跃离地、跑步腾空等）——单位：素材像素
DY = {
    "jump": [0, 0, -36, -18, 0],
    "run": [0, -9, 0, -9],
    "laugh": [0, -6, 0, -6, 0, 0],
}


def near_white(px, tol=238):
    return px[0] >= tol and px[1] >= tol and px[2] >= tol


def find_components(img, min_ratio=0.0):
    """在缩小图上做连通域检测，返回全尺寸 bbox 列表（按阅读顺序）。

    min_ratio > 0 时，丢弃面积小于最大连通域该比例的组件（雨滴/落叶/星光等）。
    """
    small = img.copy()
    small.thumbnail((600, 600))
    w, h = small.size
    px = small.load()
    mask = [[not near_white(px[x, y]) for x in range(w)] for y in range(h)]

    seen = [[False] * w for _ in range(h)]
    comps = []
    for sy in range(h):
        for sx in range(w):
            if not mask[sy][sx] or seen[sy][sx]:
                continue
            q = deque([(sx, sy)])
            seen[sy][sx] = True
            minx, miny, maxx, maxy, area = sx, sy, sx, sy, 0
            while q:
                x, y = q.popleft()
                area += 1
                minx, miny = min(minx, x), min(miny, y)
                maxx, maxy = max(maxx, x), max(maxy, y)
                for nx, ny in ((x+1, y), (x-1, y), (x, y+1), (x, y-1)):
                    if 0 <= nx < w and 0 <= ny < h and mask[ny][nx] and not seen[ny][nx]:
                        seen[ny][nx] = True
                        q.append((nx, ny))
            if area > w * h * 0.004:
                k = img.width / w
                comps.append((minx * k, miny * k, (maxx + 1) * k, (maxy + 1) * k, area))

    if min_ratio > 0 and comps:
        biggest = max(c[4] for c in comps)
        comps = [c for c in comps if c[4] >= biggest * min_ratio]

    # 按行聚类 -> 行内按 x 排序
    comps.sort(key=lambda c: ((c[1] + c[3]) / 2, c[0]))
    rows = []
    for c in comps:
        cy = (c[1] + c[3]) / 2
        if rows and abs(cy - rows[-1][-1][4]) < img.height * 0.2:
            rows[-1].append(c)
        else:
            rows.append([c])
    ordered = []
    for row in rows:
        row.sort(key=lambda c: c[0])
        ordered.extend(row)
    return ordered


def grid_cells(img, cols, rows, cell_ratio):
    """按网格切分图片，返回每个格子的内容 bbox（按阅读顺序，空格子为 None）。

    组件按中心点归入格子；格内保留面积 >= 主体 cell_ratio 的组件，
    帧区域 = 这些组件的联合 bbox。
    """
    comps = find_components(img)
    cw, ch = img.width / cols, img.height / rows
    cells = [[] for _ in range(cols * rows)]
    for c in comps:
        cx, cy = (c[0] + c[2]) / 2, (c[1] + c[3]) / 2
        col, row = int(cx // cw), int(cy // ch)
        col = min(max(col, 0), cols - 1)
        row = min(max(row, 0), rows - 1)
        cells[row * cols + col].append(c)

    out = []
    for cell in cells:
        if not cell:
            out.append(None)
            continue
        biggest = max(c[4] for c in cell)
        keep = [c for c in cell if c[4] >= biggest * cell_ratio]
        if not keep:
            out.append(None)
            continue
        bbox = (
            min(c[0] for c in keep),
            min(c[1] for c in keep),
            max(c[2] for c in keep),
            max(c[3] for c in keep),
        )
        out.append(bbox)
    return out


def is_bg_like(px):
    """近白背景、纸纹、浅灰网格线/地面阴影。"""
    r, g, b = px[0], px[1], px[2]
    lum = (r + g + b) / 3
    sat = max(r, g, b) - min(r, g, b)
    return (r >= 230 and g >= 230 and b >= 228) or (sat < 20 and 180 <= lum <= 247)


def cut_cell(img, rect):
    """直接裁剪一个网格格子：边缘泛洪去底 -> 保留最大连通域。空格子返回 None。"""
    x0, y0, x1, y1 = rect
    x0 = max(0, int(x0)); y0 = max(0, int(y0))
    x1 = min(img.width, int(x1)); y1 = min(img.height, int(y1))
    crop = img.crop((x0, y0, x1, y1)).convert("RGBA")
    w, h = crop.size
    px = crop.load()

    bg = [[False] * w for _ in range(h)]
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if is_bg_like(px[x, y]) and not bg[y][x]:
                bg[y][x] = True
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if is_bg_like(px[x, y]) and not bg[y][x]:
                bg[y][x] = True
                q.append((x, y))
    while q:
        x, y = q.popleft()
        for nx, ny in ((x+1, y), (x-1, y), (x, y+1), (x, y-1)):
            if 0 <= nx < w and 0 <= ny < h and not bg[ny][nx] and is_bg_like(px[nx, ny]):
                bg[ny][nx] = True
                q.append((nx, ny))
    for y in range(h):
        for x in range(w):
            if bg[y][x]:
                r, g, b, _ = px[x, y]
                px[x, y] = (r, g, b, 0)

    bbox = crop.getbbox()
    if not bbox:
        return None
    crop = crop.crop(bbox)

    # 保留最大连通域（去游离碎片/邻格渗入）
    w, h = crop.size
    px = crop.load()
    seen = [[False] * w for _ in range(h)]
    labels = [[0] * w for _ in range(h)]
    best_area, best_id, cur = 0, -1, 0
    for sy in range(h):
        for sx in range(w):
            if seen[sy][sx] or px[sx, sy][3] == 0:
                continue
            cur += 1
            area = 0
            q = deque([(sx, sy)])
            seen[sy][sx] = True
            while q:
                x, y = q.popleft()
                labels[y][x] = cur
                area += 1
                for nx, ny in ((x+1, y), (x-1, y), (x, y+1), (x, y-1)):
                    if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx] and px[nx, ny][3] > 0:
                        seen[ny][nx] = True
                        q.append((nx, ny))
            if area > best_area:
                best_area, best_id = area, cur
    for y in range(h):
        for x in range(w):
            if px[x, y][3] > 0 and labels[y][x] != best_id:
                px[x, y] = (0, 0, 0, 0)
    bbox3 = crop.getbbox()
    if not bbox3:
        return None
    return crop.crop(bbox3)


def cut_component(img, bbox):
    """裁剪单帧并去白底，返回 RGBA。"""
    pad = 4
    x0 = max(0, int(bbox[0]) - pad)
    y0 = max(0, int(bbox[1]) - pad)
    x1 = min(img.width, int(bbox[2]) + pad)
    y1 = min(img.height, int(bbox[3]) + pad)
    crop = img.crop((x0, y0, x1, y1)).convert("RGBA")
    w, h = crop.size
    px = crop.load()

    # 从边缘泛洪填充，把与外界连通的近白像素抠掉（衣服内部的白色不受影响）
    bg = [[False] * w for _ in range(h)]
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if near_white(px[x, y], 232) and not bg[y][x]:
                bg[y][x] = True
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if near_white(px[x, y], 232) and not bg[y][x]:
                bg[y][x] = True
                q.append((x, y))
    while q:
        x, y = q.popleft()
        for nx, ny in ((x+1, y), (x-1, y), (x, y+1), (x, y-1)):
            if 0 <= nx < w and 0 <= ny < h and not bg[ny][nx] and near_white(px[nx, ny], 232):
                bg[ny][nx] = True
                q.append((nx, ny))
    for y in range(h):
        for x in range(w):
            if bg[y][x]:
                r, g, b, _ = px[x, y]
                px[x, y] = (r, g, b, 0)

    # 收紧到实际内容
    bbox2 = crop.getbbox()
    if not bbox2:
        return crop
    crop = crop.crop(bbox2)

    # 只保留最大连通域，去掉雨滴/伞尖等游离碎片
    w, h = crop.size
    px = crop.load()
    seen = [[False] * w for _ in range(h)]
    best_area, best_id = 0, -1
    labels = [[0] * w for _ in range(h)]
    cur = 0
    for sy in range(h):
        for sx in range(w):
            if seen[sy][sx] or px[sx, sy][3] == 0:
                continue
            cur += 1
            area = 0
            q = deque([(sx, sy)])
            seen[sy][sx] = True
            while q:
                x, y = q.popleft()
                labels[y][x] = cur
                area += 1
                for nx, ny in ((x+1, y), (x-1, y), (x, y+1), (x, y-1)):
                    if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx] and px[nx, ny][3] > 0:
                        seen[ny][nx] = True
                        q.append((nx, ny))
            if area > best_area:
                best_area, best_id = area, cur
    for y in range(h):
        for x in range(w):
            if px[x, y][3] > 0 and labels[y][x] != best_id:
                px[x, y] = (0, 0, 0, 0)
    bbox3 = crop.getbbox()
    return crop.crop(bbox3) if bbox3 else crop


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in FORMS:
        print("用法: python3 slice-sprites.py <" + "|".join(FORMS) + ">")
        return 1
    form = sys.argv[1]
    cfg = FORMS[form]
    sheets_dir, out_dir = cfg["sheets"], cfg["out"]
    os.makedirs(out_dir, exist_ok=True)

    total = 0
    problems = []
    for entry in cfg["map"]:
        if cfg.get("grid"):
            filename, cols, rows, anims = entry
            cols, rows = GRID_OVERRIDES.get((form, filename), (cols, rows))
        else:
            filename, anims = entry
        path = os.path.join(sheets_dir, filename)
        if not os.path.exists(path):
            problems.append(f"缺分镜图: {form}/{filename}")
            continue
        img = Image.open(path).convert("RGB")

        if cfg.get("grid"):
            need = sum(n for _, n in anims)
            cw, ch = img.width / cols, img.height / rows
            ex_x, ex_y = cw * 0.02, ch * 0.02   # 格子外扩 2%，减少贴边截断
            frames = []
            for r in range(rows):
                for c in range(cols):
                    rect = (c * cw - ex_x, r * ch - ex_y,
                            (c + 1) * cw + ex_x, (r + 1) * ch + ex_y)
                    frames.append(cut_cell(img, rect))
            filled = sum(1 for f in frames if f)
            print(f"{form}/{filename} 网格 {rows}x{cols}, 有内容格子 {filled}/{len(frames)}, 需要 {need}")
            if filled < need:
                problems.append(f"{form}/{filename}: 只检测到 {filled} 个姿势 (需要 {need})")

            idx = 0
            for anim, n in anims:
                # 收集该动作的全部帧，按最高帧归一化，避免后帧溢出画布
                got = []
                for _ in range(n):
                    while idx < len(frames) and not frames[idx]:
                        idx += 1
                    if idx >= len(frames):
                        break
                    got.append(frames[idx])
                    idx += 1
                if len(got) < n:
                    problems.append(f"{form}/{filename}: {anim} 只取到 {len(got)}/{n} 帧")
                if not got:
                    continue
                base_scale = TARGET_H / max(f.height for f in got)
                for i, frame in enumerate(got):
                    new_w = max(1, round(frame.width * base_scale))
                    new_h = max(1, round(frame.height * base_scale))
                    frame = frame.resize((new_w, new_h), Image.LANCZOS)
                    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
                    dy = DY.get(anim, [0] * n)[i] if i < len(DY.get(anim, [])) else 0
                    x = (SIZE - new_w) // 2
                    y = GROUND - new_h + dy
                    canvas.alpha_composite(frame, (x, y))
                    canvas.save(os.path.join(out_dir, f"{anim}_{i}.png"))
                    total += 1
            continue

        comps = find_components(img, cfg.get("min_ratio", 0.0))
        need = sum(n for _, n in anims)
        print(f"{form}/{filename} 检测到 {len(comps)} 个角色, 需要 {need}")

        if len(comps) != need:
            problems.append(f"{form}/{filename}: 数量不符 ({len(comps)} != {need})")

        idx = 0
        for anim, n in anims:
            # 以该动作第一个姿势的高度为缩放基准，保留姿势间的相对大小变化
            if idx >= len(comps):
                problems.append(f"{form}/{filename}: {anim} 缺帧")
                break
            first = cut_component(img, comps[idx])
            base_scale = TARGET_H / first.height
            for i in range(n):
                if idx >= len(comps):
                    break
                frame = cut_component(img, comps[idx])
                new_w = max(1, round(frame.width * base_scale))
                new_h = max(1, round(frame.height * base_scale))
                frame = frame.resize((new_w, new_h), Image.LANCZOS)
                canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
                dy = DY.get(anim, [0] * n)[i] if i < len(DY.get(anim, [])) else 0
                x = (SIZE - new_w) // 2
                y = GROUND - new_h + dy
                canvas.alpha_composite(frame, (x, y))
                canvas.save(os.path.join(out_dir, f"{anim}_{i}.png"))
                idx += 1
                total += 1
    print(f"[{form}] 共输出 {total} 帧 -> {out_dir}")

    # 总览图（帧缩略到 96px 单元格）
    names = sorted(os.listdir(out_dir))
    if names:
        cols = 8
        rows = (len(names) + cols - 1) // cols
        sheet = Image.new("RGBA", (cols * 100, rows * 100), (235, 235, 235, 255))
        for i, name in enumerate(names):
            frame = Image.open(os.path.join(out_dir, name))
            frame.thumbnail((96, 96), Image.LANCZOS)
            sheet.alpha_composite(frame, ((i % cols) * 100 + 2, (i // cols) * 100 + 2))
        preview = os.path.join(ROOT, "assets", f"{form}-preview.png")
        sheet.save(preview)
        print(f"总览图: assets/{form}-preview.png")

    if problems:
        print("\n".join("⚠️ " + p for p in problems))
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
