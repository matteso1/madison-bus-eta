"""One-time migration: re-export latest .pkl model to .ubj format."""
import pickle
import json
from pathlib import Path

models_dir = Path(__file__).parent.parent / 'models' / 'saved'
registry_path = models_dir / 'registry.json'

with open(registry_path) as f:
    registry = json.load(f)

latest = registry['latest']
pkl_path = models_dir / f'model_{latest}.pkl'
ubj_path = models_dir / f'model_{latest}.ubj'

print(f"Loading {pkl_path}...")
with open(pkl_path, 'rb') as f:
    model = pickle.load(f)

print(f"Saving native format to {ubj_path}...")
model.save_model(str(ubj_path))

# Update registry entry filename
for entry in registry['models']:
    if entry['version'] == latest:
        entry['filename'] = f'model_{latest}.ubj'
        break

with open(registry_path, 'w') as f:
    json.dump(registry, f, indent=2, default=str)

print(f"Done. Model {latest} migrated to .ubj format.")
