from flask import Flask, request, jsonify
import requests
import os
from dotenv import load_dotenv

from flask_cors import CORS

# Load environment variables
load_dotenv()

app = Flask(__name__)
CORS(app)

API_KEY = os.getenv('MADISON_METRO_API_KEY')
API_BASE = os.getenv('MADISON_METRO_API_BASE', 'https://metromap.cityofmadison.com/bustime/api/v3')

if not API_KEY:
    raise ValueError("MADISON_METRO_API_KEY environment variable is required")

def api_get(endpoint, **params):
    p = {"key": API_KEY, "format": "json"}
    p.update(params)
    r = requests.get(f"{API_BASE}/{endpoint}", params=p)
    try:
        return r.json()
    except Exception:
        return {"error": "Non-JSON response!", "text": r.text}

@app.route("/routes")
def get_routes():
    return jsonify(api_get("getroutes"))

@app.route("/directions")
def get_directions():
    rt = request.args.get("rt")
    if not rt:
        return jsonify({"error": "Missing route param 'rt'"}), 400
    return jsonify(api_get("getdirections", rt=rt))

@app.route("/stops")
def get_stops():
    rt = request.args.get("rt")
    dir_ = request.args.get("dir")
    if not rt or not dir_:
        return jsonify({"error": "Missing params: rt or dir"}), 400
    return jsonify(api_get("getstops", rt=rt, dir=dir_))

@app.route("/vehicles")
def get_vehicles():
    rt = request.args.get("rt")
    vid = request.args.get("vid")
    p = {}
    if rt:
        p['rt'] = rt
    if vid:
        p['vid'] = vid
    if not (rt or vid):
        return jsonify({"error": "Specify rt OR vid param"}), 400
    return jsonify(api_get("getvehicles", **p))

@app.route("/predictions")
def get_predictions():
    stpid = request.args.get("stpid")
    vid = request.args.get("vid")
    if not (stpid or vid):
        return jsonify({"error": "Provide stpid or vid param"}), 400
    p = {}
    if stpid:
        p['stpid'] = stpid
    if vid:
        p['vid'] = vid
    return jsonify(api_get("getpredictions", **p))


@app.route("/patterns")
def get_patterns():
    try:
        rt = request.args.get("rt")
        dir_ = request.args.get("dir")
        print(f"Patterns request: rt={rt}, dir={dir_}")
        
        if not rt:
            return jsonify({"error": "Missing route param 'rt'"}), 400
        
        # Get all patterns for the route
        print(f"Making API call to: {API_BASE}/getpatterns")
        response = api_get("getpatterns", rt=rt)
        print(f"API response: {response}")
        
        # If there's an error, return it
        if "error" in response:
            return jsonify(response)
        
        # Filter by direction if provided
        if dir_ and "bustime-response" in response:
            patterns = response["bustime-response"].get("ptr", [])
            if not isinstance(patterns, list):
                patterns = [patterns]
            
            # Filter patterns by direction
            filtered_patterns = []
            for pattern in patterns:
                if pattern.get("rtdir") == dir_:
                    filtered_patterns.append(pattern)
            
            response["bustime-response"]["ptr"] = filtered_patterns
        
        return jsonify(response)
    except Exception as e:
        print(f"Error in patterns endpoint: {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)