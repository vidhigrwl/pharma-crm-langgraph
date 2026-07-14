import os
from datetime import datetime
from sqlalchemy import create_engine, Column, Integer, String, Text, DateTime
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

load_dotenv()

# Fallback to local SQLite file database for easier setup/testing
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./pharma_crm.db")

# Normalize DB URL for compatibility with SQLAlchemy dialects and drivers
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)
elif DATABASE_URL.startswith("mysql://"):
    DATABASE_URL = DATABASE_URL.replace("mysql://", "mysql+pymysql://", 1)

# Configuration arguments for the engine
connect_args = {}
if DATABASE_URL.startswith("sqlite"):
    connect_args["check_same_thread"] = False

engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class HCPInteraction(Base):
    __tablename__ = "hcp_interactions"

    id = Column(Integer, primary_key=True, index=True)
    hcp_name = Column(String(255), index=True, nullable=True)
    product = Column(String(255), nullable=True)
    summary = Column(Text, nullable=True)
    interaction_type = Column(String(100), default="Meeting", nullable=True)
    date = Column(String(50), nullable=True)
    time = Column(String(50), nullable=True)
    attendees = Column(Text, nullable=True)  # JSON or comma-separated list
    topics_discussed = Column(Text, nullable=True)
    sentiment = Column(String(50), default="Neutral", nullable=True)  # Positive, Neutral, Negative
    materials_shared = Column(Text, nullable=True)  # JSON or comma-separated list
    samples_distributed = Column(Text, nullable=True)  # JSON or comma-separated list
    outcomes = Column(Text, nullable=True)
    followup_actions = Column(Text, nullable=True)
    raw_text = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

# Create tables
def init_db():
    Base.metadata.create_all(bind=engine)
    # Auto-migration for the summary column
    from sqlalchemy import inspect, text
    inspector = inspect(engine)
    try:
        columns = [col['name'] for col in inspector.get_columns('hcp_interactions')]
        if 'summary' not in columns:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE hcp_interactions ADD COLUMN summary TEXT"))
                print("Added summary column to hcp_interactions table.")
    except Exception as e:
        print(f"Auto-migration check skipped or failed: {e}")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
