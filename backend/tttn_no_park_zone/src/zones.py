from __future__ import annotations
from typing import List, Tuple
from shapely.geometry import Point, Polygon
from .utils import load_json

class Zone:
    def __init__(self, points: List[Tuple[float, float]], name: str = "zone"):
        self.name = name
        self.poly = Polygon(points)

    @property
    def points(self) -> List[Tuple[float, float]]:
        return list(self.poly.exterior.coords)

    def contains_xy(self, x: float, y: float) -> bool:
        return self.poly.contains(Point(x, y))

def load_zone_json(path: str) -> Zone:
    data = load_json(path)
    pts = [(float(x), float(y)) for x, y in data["points"]]
    return Zone(pts, name=data.get("name", "zone"))