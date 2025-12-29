# 🚀 GTFS-RT Alerts Integration - Much Better Approach!

## What Changed

**Before:** Manually tracking events and construction from multiple sources
- ❌ Manual event calendar (UW football, festivals, etc.)
- ❌ Scraping Madison open data for construction
- ❌ Hard to maintain, easy to miss things

**After:** Using official GTFS-RT Alerts feed
- ✅ **Official source** - Direct from Madison Metro
- ✅ **Automatic** - They update it, we use it
- ✅ **Comprehensive** - Detours, events, weather, construction, everything!

## The Endpoint

**GTFS-RT Alerts:** `https://metromap.cityofmadison.com/gtfsrt/alerts`

This is the **official** feed that includes:
- **Detours** - Route changes due to road closures
- **Special Events** - UW football, festivals, etc.
- **Weather Conditions** - Service impacts from weather
- **Construction** - Road work affecting routes
- **Service Issues** - Any other transit disruptions

## How It Works

1. **Fetches alerts** every 5 minutes (alerts change frequently)
2. **Parses protobuf** format (standard GTFS-RT)
3. **Matches to routes** - Knows which routes are affected
4. **Categorizes** - Detours, events, weather, construction
5. **Adds to records** - Every transit record gets alert context

## New Data Fields

Every record now has:

- `has_alert` - 1 if route has any active alert
- `alert_count` - Number of active alerts
- `has_detour` - 1 if route has detour
- `has_event` - 1 if route affected by special event
- `has_weather_alert` - 1 if weather-related alert
- `has_construction_alert` - 1 if construction-related alert

## Installation

```bash
pip install gtfs-realtime-bindings protobuf
```

Already added to `requirements.txt`!

## Why This is Better

### Efficiency
- **One API call** instead of multiple sources
- **Official data** - no guessing or manual updates
- **Real-time** - updates as things happen

### Accuracy
- **Direct from Metro** - they know their own service
- **Route-specific** - knows exactly which routes affected
- **Time-aware** - knows when alerts are active

### Maintenance
- **Zero maintenance** - Metro updates it, we use it
- **No manual calendars** - events come from official source
- **No scraping** - clean API integration

## Example Insights

Now you can answer:

- "Route 80 has 2 active alerts: detour + UW football event"
- "Construction alerts increase delays by 40% on affected routes"
- "Detours cause 3x higher prediction errors"
- "Weather alerts correlate with 50% delay increases"

## Testing

The collector will automatically use GTFS-RT alerts if available. Check logs:

```
✅ GTFS-RT Alerts loaded
```

If you see:
```
⚠️  GTFS-RT Alerts not available
```

Install dependencies:
```bash
pip install -r requirements.txt
```

## What About Old Code?

The old event tracker and construction tracker are still there but **not used** anymore. GTFS-RT Alerts replaces both!

You can remove them later if you want, but keeping them doesn't hurt (they're just not imported).

## Next Steps

1. **Install dependencies** (if not already):
   ```bash
   pip install gtfs-realtime-bindings protobuf
   ```

2. **Restart collector** - It will automatically use GTFS-RT alerts

3. **Check data** - New records will have alert fields populated

4. **Analyze** - Use alert data for better insights!

## References

- [GTFS-RT Specification](https://developers.google.com/transit/gtfs-realtime)
- [Madison Metro Developer Info](https://www.cityofmadison.com/metro/business/information-for-developers)
- [GTFS-RT Service Alerts Guide](https://developers.google.com/transit/gtfs-realtime/guides/service-alerts)

