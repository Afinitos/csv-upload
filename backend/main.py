import os
import json
from datetime import datetime
from typing import Dict, List, Optional

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import Column, DateTime, Integer, String, Text, create_engine
from sqlalchemy.orm import Session, declarative_base, sessionmaker


# Database setup
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./backend/data.db")
is_sqlite = DATABASE_URL.startswith("sqlite")

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if is_sqlite else {},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class Upload(Base):
    __tablename__ = "uploads"

    id = Column(Integer, primary_key=True, index=True)
    workbook = Column(String(255), nullable=False)
    mapping = Column(Text, nullable=False)  # JSON string
    rows = Column(Text, nullable=False)  # JSON string
    row_count = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# Schemas
class UploadIn(BaseModel):
    workbook: str
    rows: List[Dict[str, str]]
    mapping: Dict[str, Optional[str]]


class UploadOut(BaseModel):
    id: int
    workbook: str
    row_count: int
    created_at: datetime

    class Config:
        from_attributes = True  # Pydantic v2 replacement for orm_mode


# FastAPI app
app = FastAPI(title="CSV Upload Backend", version="1.0.0")

# CORS for Vite dev servers
origins = [
    "http://localhost:5173",
    "http://localhost:5174",
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(bind=engine)


@app.get("/healthz")
def healthz():
    return {"ok": True}


@app.post("/api/uploads", response_model=UploadOut)
def create_upload(payload: UploadIn, db: Session = Depends(get_db)):
    try:
        rows_json = json.dumps(payload.rows, ensure_ascii=False)
        mapping_json = json.dumps(payload.mapping, ensure_ascii=False)
        row_count = len(payload.rows)

        record = Upload(
            workbook=payload.workbook,
            rows=rows_json,
            mapping=mapping_json,
            row_count=row_count,
        )
        db.add(record)
        db.commit()
        db.refresh(record)
        return record
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save upload: {e}")


@app.get("/api/uploads", response_model=List[UploadOut])
def list_uploads(db: Session = Depends(get_db)):
    q = db.query(Upload).order_by(Upload.id.desc()).all()
    return q
