import os
from sqlalchemy import create_engine, text

database_url = os.getenv('DATABASE_URL')
engine = create_engine(database_url)
with engine.connect() as conn:
    result = conn.execute(text("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='prediction_outcomes'")).fetchall()
    print(result)
