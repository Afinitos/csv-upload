import os
import json
from datetime import datetime
from typing import Dict, List, Optional

from fastapi import Depends, FastAPI, HTTPException, Query, Response, status
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


# Limits and validation
MAX_ROWS = 10000
MAX_MAPPING_KEYS = 1000
MAX_WORKBOOK_LEN = 255
MAX_PAGE_SIZE = 100

def validate_payload(workbook: str, rows: List[Dict[str, str]], mapping: Dict[str, Optional[str]]) -> None:
    if not workbook or not isinstance(workbook, str):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="workbook is required")
    if len(workbook) > MAX_WORKBOOK_LEN:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"workbook too long (>{MAX_WORKBOOK_LEN})")
    if not isinstance(rows, list):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="rows must be a list")
    if len(rows) > MAX_ROWS:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail=f"Too many rows (>{MAX_ROWS})")
    if not isinstance(mapping, dict):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="mapping must be an object")
    if len(mapping.keys()) > MAX_MAPPING_KEYS:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Too many mapping keys (>{MAX_MAPPING_KEYS})")


class UploadUpdate(BaseModel):
    workbook: Optional[str] = None
    rows: Optional[List[Dict[str, str]]] = None
    mapping: Optional[Dict[str, Optional[str]]] = None


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
        validate_payload(payload.workbook, payload.rows, payload.mapping)
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
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save upload: {e}")


@app.get("/api/uploads", response_model=List[UploadOut])
def list_uploads(
    response: Response,
    db: Session = Depends(get_db),
    limit: int = Query(50, ge=1, le=MAX_PAGE_SIZE),
    offset: int = Query(0, ge=0),
    workbook: Optional[str] = Query(None),
):
    q = db.query(Upload)
    if workbook:
        q = q.filter(Upload.workbook == workbook)
    total = q.count()
    items = q.order_by(Upload.id.desc()).offset(offset).limit(limit).all()
    response.headers["X-Total-Count"] = str(total)
    return items


@app.get("/api/uploads/{upload_id}", response_model=UploadOut)
def get_upload(upload_id: int, db: Session = Depends(get_db)):
    rec = db.get(Upload, upload_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Not found")
    return rec


@app.delete("/api/uploads/{upload_id}", status_code=204)
def delete_upload(upload_id: int, db: Session = Depends(get_db)):
    rec = db.get(Upload, upload_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Not found")
    db.delete(rec)
    db.commit()
    return Response(status_code=204)


@app.put("/api/uploads/{upload_id}", response_model=UploadOut)
def put_upload(upload_id: int, payload: UploadIn, db: Session = Depends(get_db)):
    rec = db.get(Upload, upload_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Not found")
    validate_payload(payload.workbook, payload.rows, payload.mapping)
    rec.workbook = payload.workbook
    rec.rows = json.dumps(payload.rows, ensure_ascii=False)
    rec.mapping = json.dumps(payload.mapping, ensure_ascii=False)
    rec.row_count = len(payload.rows)
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return rec


@app.patch("/api/uploads/{upload_id}", response_model=UploadOut)
def patch_upload(upload_id: int, payload: UploadUpdate, db: Session = Depends(get_db)):
    rec = db.get(Upload, upload_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Not found")
    new_workbook = payload.workbook if payload.workbook is not None else rec.workbook
    new_rows = payload.rows if payload.rows is not None else json.loads(rec.rows)
    new_mapping = payload.mapping if payload.mapping is not None else json.loads(rec.mapping)
    validate_payload(new_workbook, new_rows, new_mapping)
    rec.workbook = new_workbook
    rec.rows = json.dumps(new_rows, ensure_ascii=False)
    rec.mapping = json.dumps(new_mapping, ensure_ascii=False)
    rec.row_count = len(new_rows)
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return rec
