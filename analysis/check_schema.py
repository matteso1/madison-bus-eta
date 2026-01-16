from sqlalchemy import create_engine, text
engine = create_engine('postgresql://postgres:sDsIVEajwHNPJWnguwDrJaaPKiPmoupq@caboose.proxy.rlwy.net:46555/railway')
with engine.connect() as conn:
    cols = conn.execute(text("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'prediction_outcomes'")).fetchall()
    print('prediction_outcomes columns:')
    for c in cols:
        print(f'  {c[0]}: {c[1]}')
    print()
    sample = conn.execute(text('SELECT * FROM prediction_outcomes LIMIT 2')).fetchall()
    print('Sample data:')
    for s in sample:
        print(f'  {s}')
