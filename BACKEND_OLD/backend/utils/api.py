import requests
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

API_KEY = os.getenv('MADISON_METRO_API_KEY')
API_BASE = os.getenv('MADISON_METRO_API_BASE', 'https://metromap.cityofmadison.com/bustime/api/v3')

if not API_KEY:
    raise ValueError("MADISON_METRO_API_KEY environment variable is required")

def api_get(endpoint, **params):
    p = {"key": API_KEY, "format": "json"}
    p.update(params)
    r = requests.get(f"{API_BASE}/{endpoint}", params=p)
    return r.json()

def get_routes():
    return api_get("getroutes")

def get_directions(rt):
    return api_get("getdirections", rt=rt)

def get_stops(rt, dir_):
    return api_get("getstops", rt=rt, dir=dir_)

def get_vehicles(rt=None, vid=None):
    if not (rt or vid):
        raise ValueError("One of rt or vid is required")
    p = {}
    if rt:
        p['rt'] = rt
    if vid:
        p['vid'] = vid
    return api_get("getvehicles", **p)

def get_predictions(stpid=None, vid=None):
    if not (stpid or vid):
        raise ValueError("One of stpid or vid is required")
    p = {}
    if stpid:
        p['stpid'] = stpid
    if vid:
        p['vid'] = vid
    return api_get("getpredictions", **p)