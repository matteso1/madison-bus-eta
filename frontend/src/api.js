const API_BASE = 'http://localhost:5000'; // or your Flask backend URL

export async function getRoutes() {
  const res = await fetch(`${API_BASE}/routes`);
  return res.json();
}

export async function getDirections(rt) {
  const res = await fetch(`${API_BASE}/directions?rt=${rt}`);
  return res.json();
}

export async function getStops(rt, dir) {
  const res = await fetch(`${API_BASE}/stops?rt=${rt}&dir=${encodeURIComponent(dir)}`);
  return res.json();
}

export async function getPredictions(stpid) {
  const res = await fetch(`${API_BASE}/predictions?stpid=${stpid}`);
  return res.json();
}