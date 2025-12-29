import os
from pathlib import Path

import psycopg
from django.core.management.base import BaseCommand
from dotenv import load_dotenv

from uploads.models import Upload
from uploads.vanna_service import get_vanna_service


class Command(BaseCommand):
    help = "Train Vanna on the current Postgres schema (minimal starter training)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--include-django-tables",
            action="store_true",
            help="Also include django_* and auth_* tables in schema documentation.",
        )

    def handle(self, *args, **options):
        # Ensure env vars are loaded (settings.py already loads .env, but keep robust)
        base_dir = Path(__file__).resolve().parents[3]  # backend/server
        load_dotenv(base_dir / ".env")

        vn = get_vanna_service().vn

        pg_host = os.getenv("POSTGRES_HOST", "localhost")
        pg_dbname = os.getenv("POSTGRES_DB", "csvupload")
        pg_user = os.getenv("POSTGRES_USER", "postgres")
        pg_password = os.getenv("POSTGRES_PASSWORD", "")
        pg_port = int(os.getenv("POSTGRES_PORT", "5432"))

        include_django = bool(options.get("include_django_tables"))

        # Read schema from information_schema
        with psycopg.connect(
            host=pg_host,
            dbname=pg_dbname,
            user=pg_user,
            password=pg_password,
            port=pg_port,
            autocommit=True,
        ) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT table_schema, table_name, column_name, data_type
                    FROM information_schema.columns
                    WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
                    ORDER BY table_schema, table_name, ordinal_position
                    """
                )
                rows = cur.fetchall()

        lines = ["Database schema (tables + columns):", ""]
        last_table = None
        for table_schema, table_name, column_name, data_type in rows:
            if not include_django and (
                table_name.startswith("django_") or table_name.startswith("auth_")
            ):
                continue

            full_table = f"{table_schema}.{table_name}"
            if full_table != last_table:
                lines.append(f"- {full_table}")
                last_table = full_table
            lines.append(f"    - {column_name}: {data_type}")

        schema_doc = "\n".join(lines)
        vn.train(documentation=schema_doc)

        # Starter Q->SQL pairs for the uploads table.
        upload_table = Upload._meta.db_table

        vn.train(
            question="How many uploads are there?",
            sql=f"SELECT COUNT(*) AS upload_count FROM {upload_table};",
        )
        vn.train(
            question="Show the latest 5 uploads (id, workbook, row_count, created_at).",
            sql=(
                f"SELECT id, workbook, row_count, created_at "
                f"FROM {upload_table} ORDER BY id DESC LIMIT 5;"
            ),
        )

        self.stdout.write(self.style.SUCCESS("Vanna training finished."))

