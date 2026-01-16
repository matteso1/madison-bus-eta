from sqlalchemy import create_engine, text

db_url = 'postgresql://postgres:sDsIVEajwHNPJWnguwDrJaaPKiPmoupq@caboose.proxy.rlwy.net:46555/railway'
engine = create_engine(db_url)

with engine.connect() as conn:
    # Check all routes being collected
    routes = conn.execute(text("SELECT rt, COUNT(*) as cnt FROM vehicle_observations GROUP BY rt ORDER BY cnt DESC")).fetchall()
    
    print("ALL ROUTES BEING COLLECTED:")
    print("-" * 40)
    for route, count in routes:
        print(f"  Route {route}: {count} observations")
    
    print(f"\nTotal routes tracked: {len(routes)}")
