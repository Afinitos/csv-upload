# csv-upload

This repo contains:

- **Frontend** (Vite/React) for CSV upload + mapping
- **Backend** (Django + DRF) for storing uploads in **PostgreSQL**
- **Vanna AI** integration: ask questions in natural language and get back **SQL + results**.

## Prerequisites

- Python 3.11+
- PostgreSQL running locally

## Python environment

This repo currently has **two** virtualenvs (`venv/` and `.venv/`). The Vanna integration
was installed in **`.venv/`**, so use that python when running Django:

```bash
.\.venv\Scripts\python.exe --version
```

## Backend: Django + Postgres

Env file is loaded from `backend/server/.env` (not committed).

### 1) Configure env

Edit `backend/server/.env` and set:

```env
POSTGRES_DB=csvupload
POSTGRES_USER=postgres
POSTGRES_PASSWORD=...
POSTGRES_HOST=localhost
POSTGRES_PORT=5432

OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini

# Chroma persistence (local)
VANNA_CHROMA_PATH=.vanna/chroma

# Recommended false (privacy/safety)
VANNA_ALLOW_LLM_TO_SEE_DATA=false
```

### 2) Run migrations + server

```bash
.\.venv\Scripts\python.exe backend/server/manage.py migrate
.\.venv\Scripts\python.exe backend/server/manage.py runserver
```

## Vanna: Train + Ask

### Train (starter)

This command stores schema + a couple of example Q→SQL pairs into the local Chroma store.

```bash
.\.venv\Scripts\python.exe backend/server/manage.py vanna_train
```

### Important: privacy vs. accuracy (allow_llm_to_see_data)

By default we run with:

```env
VANNA_ALLOW_LLM_TO_SEE_DATA=false
```

This is safer (the LLM will not run sample queries / inspect data), but it also means:

- for questions that require schema introspection, Vanna may refuse to generate SQL and you'll get an error like:
  `The LLM is not allowed to see the data in your database ... allow_llm_to_see_data=True`

To fix it, you have two options:

1. **Recommended**: train Vanna with your schema + a few starter examples:

```bash
.\.venv\Scripts\python.exe backend/server/manage.py vanna_train
```

2. **Allow introspection** (less private): set this in `backend/server/.env`:

```env
VANNA_ALLOW_LLM_TO_SEE_DATA=true
```

### Ask via API

Endpoint:

- `POST http://127.0.0.1:8000/api/ask` (also accepts trailing slash)

Body:

```json
{
  "question": "How many uploads are there?",
  "max_rows": 200
}
```

Response:

```json
{
  "sql": "SELECT ...",
  "rows": [{ "...": "..." }]
}
```

## Notes / Troubleshooting

- If you see `openai.RateLimitError: insufficient_quota`, your OpenAI key has no remaining quota.
  Top up billing or switch to another provider.
- By default we **refuse to execute non-SELECT** queries for safety.
- If the API responds with a message that Vanna "is not allowed to inspect the database", either run
  `python manage.py vanna_train` or set `VANNA_ALLOW_LLM_TO_SEE_DATA=true` (see section above).
