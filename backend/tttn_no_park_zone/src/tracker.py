from __future__ import annotations
from typing import Dict, Any, List, Optional, Tuple

def xyxy_center(xyxy: List[float]) -> Tuple[float, float]:
    x1, y1, x2, y2 = xyxy
    return ((x1 + x2) / 2.0, (y1 + y2) / 2.0)

def get_name(names: Dict[int, str], cls_id: int) -> str:
    return names.get(int(cls_id), str(int(cls_id)))

def extract_tracks(results) -> List[Dict[str, Any]]:
    """
    Chuẩn hoá output Ultralytics -> list dict:
    [{id, cls_id, name, conf, xyxy, center}, ...]
    """
    out = []
    if not results or results[0].boxes is None:
        return out

    r0 = results[0]
    boxes = r0.boxes
    if boxes.id is None:
        return out

    ids = boxes.id.cpu().tolist()
    clss = boxes.cls.cpu().tolist()
    confs = boxes.conf.cpu().tolist()
    xyxys = boxes.xyxy.cpu().tolist()
    names = r0.names

    for tid, cls_id, cf, xyxy in zip(ids, clss, confs, xyxys):
        name = get_name(names, int(cls_id))
        c = xyxy_center(xyxy)
        out.append({
            "id": int(tid),
            "cls_id": int(cls_id),
            "name": name,
            "conf": float(cf),
            "xyxy": [float(v) for v in xyxy],
            "center": (float(c[0]), float(c[1])),
        })
    return out