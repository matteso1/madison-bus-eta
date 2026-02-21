import math
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

BUNCH_DIST_KM = 0.5
BUNCH_CONFIRM_COUNT = 2
BUNCH_GAP_SEC = 600


@dataclass
class BunchState:
    consecutive_close: int = 0
    last_event_at: Optional[float] = None


@dataclass
class BunchingEvent:
    rt: str
    vid_a: str
    vid_b: str
    lat_a: float
    lon_a: float
    lat_b: float
    lon_b: float
    dist_km: float
    detected_at: datetime


def _haversine(lat1, lon1, lat2, lon2) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))


class BunchDetector:
    def __init__(self):
        self._state: dict = {}  # (rt, vid_a, vid_b) -> BunchState

    def detect_bunching(self, vehicles: list) -> list:
        now = datetime.now(timezone.utc)
        now_ts = now.timestamp()
        by_route: dict = {}
        for v in vehicles:
            rt = v.get('rt', '')
            if rt and v.get('vid') and v.get('lat') and v.get('lon'):
                by_route.setdefault(rt, []).append(v)

        events = []
        active_keys = set()

        for rt, rt_vehicles in by_route.items():
            if len(rt_vehicles) < 2:
                continue
            for i in range(len(rt_vehicles)):
                for j in range(i + 1, len(rt_vehicles)):
                    va, vb = rt_vehicles[i], rt_vehicles[j]
                    key = (rt, min(str(va['vid']), str(vb['vid'])), max(str(va['vid']), str(vb['vid'])))
                    active_keys.add(key)
                    dist = _haversine(float(va['lat']), float(va['lon']), float(vb['lat']), float(vb['lon']))
                    state = self._state.get(key, BunchState())

                    if dist <= BUNCH_DIST_KM:
                        state.consecutive_close += 1
                    else:
                        state.consecutive_close = 0

                    if (state.consecutive_close >= BUNCH_CONFIRM_COUNT and
                            (state.last_event_at is None or now_ts - state.last_event_at >= BUNCH_GAP_SEC)):
                        events.append(BunchingEvent(
                            rt=rt, vid_a=str(va['vid']), vid_b=str(vb['vid']),
                            lat_a=float(va['lat']), lon_a=float(va['lon']),
                            lat_b=float(vb['lat']), lon_b=float(vb['lon']),
                            dist_km=round(dist, 3), detected_at=now,
                        ))
                        state.last_event_at = now_ts
                        state.consecutive_close = 0

                    self._state[key] = state

        # Prune stale pairs
        for key in list(self._state.keys()):
            if key not in active_keys:
                del self._state[key]

        return events
