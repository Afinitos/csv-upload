import os
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

"""Vanna integration for Django.

This module is used both:
- inside Django runtime (views/management commands)
- from standalone scripts/tests

So it must NOT require Django settings to be configured at import time.
"""

try:
    # Optional: available when imported inside Django runtime.
    from django.conf import settings as _django_settings  # type: ignore

    # IMPORTANT: Accessing any attribute of django.conf.settings will throw
    # ImproperlyConfigured if DJANGO_SETTINGS_MODULE isn't set.
    # So we only consider Django settings usable if they are configured.
    if getattr(_django_settings, "configured", False):
        settings = _django_settings  # type: ignore
    else:  # pragma: no cover
        settings = None  # type: ignore
except Exception:  # pragma: no cover
    settings = None  # type: ignore

# NOTE: vanna v2.x currently exposes its classic API under `vanna.legacy.*`
from vanna.legacy.base import VannaBase
from vanna.legacy.chromadb import ChromaDB_VectorStore
from vanna.legacy.openai.openai_chat import OpenAI_Chat


class VannaServiceError(RuntimeError):
    pass


class VannaService:
    """Small wrapper around Vanna for Django usage.

    Responsibilities:
    - create a single Vanna instance (LLM + embeddings + vector store)
    - connect it to Postgres
    - expose a `ask()` method returning (sql, rows)

    Notes:
    - We keep vector store persistent on disk so the model can retain training.
    - For safety, we only allow SELECT queries by default.
    """

    def __init__(
        self,
        *,
        openai_api_key: str,
        openai_model: str,
        chroma_path: str,
        pg_host: str,
        pg_dbname: str,
        pg_user: str,
        pg_password: str,
        pg_port: int,
        allow_llm_to_see_data: bool = False,
    ) -> None:
        if not openai_api_key:
            raise VannaServiceError("OPENAI_API_KEY is not set")

        # OpenAI client used by vanna legacy adapters reads OPENAI_API_KEY env.
        # (The adapters also support config-based keys, but env is the simplest.)
        os.environ.setdefault("OPENAI_API_KEY", openai_api_key)

        # Persist chroma under backend/server/.vanna by default
        Path(chroma_path).mkdir(parents=True, exist_ok=True)

        # Build a Vanna instance by mixing: Vector store + OpenAI chat (LLM)
        # NOTE: vanna legacy adapters do NOT use cooperative super(), so we must
        # explicitly call both parent initializers.
        class MyVanna(ChromaDB_VectorStore, OpenAI_Chat):
            def __init__(self, *, vectorstore_config: dict, chat_config: dict, api_key: str):
                from openai import OpenAI

                ChromaDB_VectorStore.__init__(self, config=vectorstore_config)
                OpenAI_Chat.__init__(self, client=OpenAI(api_key=api_key), config=chat_config)

            # vanna's ChromaDB_VectorStore expects `generate_embedding` for training.
            # We'll use Chroma's local DefaultEmbeddingFunction (onnx-based) to avoid
            # an extra network dependency for embeddings.
            def generate_embedding(self, text: str):
                ef = getattr(self, "embedding_function", None)
                if ef is None:
                    raise VannaServiceError("Embedding function is not configured")
                # chroma embedding functions accept list[str] and return list[list[float]]
                return ef([text])[0]

        self.vn: VannaBase = MyVanna(
            vectorstore_config={
                "path": chroma_path,
            },
            chat_config={
                "model": openai_model,
                "temperature": 0.0,
            },
            api_key=openai_api_key,
        )

        # Connect to Postgres for run_sql
        # IMPORTANT: legacy connect_to_postgres expects psycopg2; in our env we use psycopg3.
        # We therefore implement our own run_sql via psycopg3.
        import pandas as pd
        import psycopg

        def _run_sql(sql: str, **kwargs):
            with psycopg.connect(
                host=pg_host,
                dbname=pg_dbname,
                user=pg_user,
                password=pg_password,
                port=pg_port,
                autocommit=True,
            ) as conn:
                with conn.cursor() as cur:
                    cur.execute(sql)
                    if cur.description is None:
                        return pd.DataFrame([])
                    cols = [d.name for d in cur.description]
                    rows = cur.fetchall()
                    return pd.DataFrame(rows, columns=cols)

        # Monkey-patch run_sql used by vn.generate_sql when allow_llm_to_see_data=True
        self.vn.run_sql = _run_sql  # type: ignore[attr-defined]

        self.allow_llm_to_see_data = allow_llm_to_see_data

    def ask(
        self,
        question: str,
        *,
        max_rows: int = 200,
        allow_non_select: bool = False,
    ) -> Tuple[str, List[Dict[str, Any]]]:
        if not question or not isinstance(question, str):
            raise VannaServiceError("question is required")

        # 1) Try to answer from existing training data (no LLM call)
        similar = self.vn.get_similar_question_sql(question)
        if similar and isinstance(similar, list):
            top = similar[0]
            if isinstance(top, dict) and "sql" in top and "question" in top:
                # If the question matches exactly, use the stored SQL.
                if str(top["question"]).strip().lower() == question.strip().lower():
                    sql_clean = str(top["sql"]).strip().rstrip(";")
                else:
                    sql_clean = ""
            else:
                sql_clean = ""
        else:
            sql_clean = ""

        # 2) Otherwise ask the LLM (may fail if quota is exceeded)
        if not sql_clean:
            sql = self.vn.generate_sql(question, allow_llm_to_see_data=self.allow_llm_to_see_data)
            sql_clean = sql.strip().rstrip(";")

        # Some providers / adapters return an explanatory string (not SQL)
        # when allow_llm_to_see_data=False and the question requires
        # database introspection. Convert that into a clear actionable error.
        lowered_msg = sql_clean.lower()
        if "llm is not allowed to see the data" in lowered_msg or "allow_llm_to_see_data" in lowered_msg:
            raise VannaServiceError(
                "Vanna could not generate SQL because the LLM is not allowed to inspect the database. "
                "Either (1) run `python manage.py vanna_train` to store schema context in the vector store, "
                "or (2) set VANNA_ALLOW_LLM_TO_SEE_DATA=true in backend/server/.env if you accept that risk. "
                f"Raw message: {sql_clean}"
            )

        # Guard against any other non-SQL responses
        if not lowered_msg.startswith(("select", "with", "insert", "update", "delete", "create", "alter", "drop")):
            # Common pattern when the model doesn't have enough schema context.
            if "provided context does not include" in lowered_msg or "cannot generate" in lowered_msg:
                raise VannaServiceError(
                    "Vanna could not generate SQL from the current context. "
                    "Run `python manage.py vanna_train` to store the schema in the vector store "
                    "(recommended), or set VANNA_ALLOW_LLM_TO_SEE_DATA=true in backend/server/.env. "
                    f"Raw message: {sql_clean}"
                )

            raise VannaServiceError(f"Vanna did not return SQL. Got: {sql_clean}")

        # Basic safety gate
        lowered = sql_clean.lower().lstrip()
        if not allow_non_select:
            if not (lowered.startswith("select") or lowered.startswith("with")):
                raise VannaServiceError(
                    f"Refusing to run non-SELECT SQL. Generated: {sql_clean[:200]}"
                )

        df = self.vn.run_sql(sql_clean)

        # Limit returned payload size
        if len(df.index) > max_rows:
            df = df.head(max_rows)

        rows = df.to_dict(orient="records")
        return sql_clean, rows


@lru_cache(maxsize=1)
def get_vanna_service() -> VannaService:
    # Prefer env vars loaded via dotenv in settings.py
    openai_api_key = os.getenv("OPENAI_API_KEY", "")
    openai_model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

    # If env var is relative, we want it relative to backend/server
    default_base_dir = Path(__file__).resolve().parents[1]  # backend/server
    if settings is not None and getattr(settings, "BASE_DIR", None) is not None:
        default_base_dir = Path(settings.BASE_DIR)  # type: ignore[arg-type]

    chroma_env = os.getenv("VANNA_CHROMA_PATH")
    if chroma_env:
        chroma_path = str((default_base_dir / chroma_env).resolve()) if not Path(chroma_env).is_absolute() else chroma_env
    else:
        chroma_path = str((default_base_dir / ".vanna" / "chroma").resolve())

    pg_host = os.getenv("POSTGRES_HOST", "localhost")
    pg_dbname = os.getenv("POSTGRES_DB", "csvupload")
    pg_user = os.getenv("POSTGRES_USER", "postgres")
    pg_password = os.getenv("POSTGRES_PASSWORD", "")
    pg_port = int(os.getenv("POSTGRES_PORT", "5432"))

    allow_llm_to_see_data = os.getenv("VANNA_ALLOW_LLM_TO_SEE_DATA", "false").lower() in ("1", "true", "yes")

    return VannaService(
        openai_api_key=openai_api_key,
        openai_model=openai_model,
        chroma_path=chroma_path,
        pg_host=pg_host,
        pg_dbname=pg_dbname,
        pg_user=pg_user,
        pg_password=pg_password,
        pg_port=pg_port,
        allow_llm_to_see_data=allow_llm_to_see_data,
    )
