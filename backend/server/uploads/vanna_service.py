from __future__ import annotations
from .vanna_tools import CustomChartTool

import os
from pathlib import Path
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

# ✅ Definiraj error ODMAH na vrhu (da import iz views.py uvijek uspije)
class VannaServiceError(Exception):
    pass

# Tek nakon toga vanna importovi (mogu puknuti ako je paket/extra missing)
from vanna import Agent
from vanna.core.registry import ToolRegistry
from vanna.core.user import UserResolver, User, RequestContext

from vanna.tools import RunSqlTool, VisualizeDataTool
from vanna.integrations.postgres import PostgresRunner
from vanna.integrations.openai import OpenAILlmService

from vanna.integrations.local import LocalFileSystem
from vanna.integrations.local.agent_memory import DemoAgentMemory
from vanna.tools.agent_memory import (
    SaveQuestionToolArgsTool,
    SearchSavedCorrectToolUsesTool,
    SaveTextMemoryTool,
)


def _resolve_vanna_files_dir() -> str:
    """Resolve a stable absolute directory for Vanna-generated files.

    Why:
    - Vanna's LocalFileSystem interprets relative paths against the *current working directory*.
    - Depending on how Django is started (IDE, manage.py, service), CWD may vary.
    - This caused files to be written into repo-root `./vanna_files` (or other unexpected folders)
      instead of `backend/server/vanna_files`.
    """

    # Repo root is 4 levels up from this file:
    # backend/server/uploads/vanna_service.py -> uploads -> server -> server -> backend -> repo-root
    repo_root = Path(__file__).resolve().parents[4]
    backend_server_dir = repo_root / "backend" / "server"

    raw = os.getenv("VANNA_FILES_DIR")
    default_rel = Path("backend/server/vanna_files")

    # No env set -> use repo-root relative default
    if not raw:
        p = repo_root / default_rel
        p.mkdir(parents=True, exist_ok=True)
        return str(p)

    env_path = Path(raw)

    # Already absolute -> use directly
    if env_path.is_absolute():
        env_path.mkdir(parents=True, exist_ok=True)
        return str(env_path)

    # Relative env: first try relative to repo root (most convenient when running from anywhere)
    p1 = (repo_root / env_path).resolve()
    try:
        p1.mkdir(parents=True, exist_ok=True)
        return str(p1)
    except Exception:
        # Fallback: relative to backend/server (common Django BASE_DIR)
        p2 = (backend_server_dir / env_path).resolve()
        p2.mkdir(parents=True, exist_ok=True)
        return str(p2)




class DjangoUserResolver(UserResolver):
    async def resolve_user(self, request_context: RequestContext) -> User:
        email = request_context.get_header("X-User-Email") or "guest@example.com"
        group = request_context.get_header("X-User-Group") or "user"
        return User(id=email, email=email, group_memberships=[group])


@dataclass
class VannaAnswer:
    components: List[Dict[str, Any]]


class VannaService:
    def __init__(self) -> None:
        # 1) LLM
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise VannaServiceError("OPENAI_API_KEY is not set.")

        llm = OpenAILlmService(
            model=os.getenv("VANNA_OPENAI_MODEL", "gpt-4.1-mini"),
            api_key=api_key,
        )

        # 2) DB tool (Postgres)
        db_host = os.getenv("DB_HOST") or os.getenv("POSTGRES_HOST", "localhost")
        db_name = os.getenv("DB_NAME") or os.getenv("POSTGRES_DB")
        db_user = os.getenv("DB_USER") or os.getenv("POSTGRES_USER")
        db_password = os.getenv("DB_PASSWORD") or os.getenv("POSTGRES_PASSWORD")
        db_port = int(os.getenv("DB_PORT") or os.getenv("POSTGRES_PORT", "5432"))

        if not db_name or not db_user:
            raise VannaServiceError("DB_NAME/DB_USER (or POSTGRES_DB/POSTGRES_USER) are not set.")

        # 3) File system for Vanna tools that read/write artifacts (CSV results, charts, etc.)
        # IMPORTANT: RunSqlTool writes query results to CSV for downstream tools.
        # We must share the same FileSystem instance across tools to avoid writing into CWD.
        files_dir = _resolve_vanna_files_dir()
        # Helpful when debugging: shows where files will be written.
        if os.getenv("VANNA_DEBUG", "").lower() in ("1", "true", "yes"):
            print(f"[vanna] cwd={os.getcwd()} files_dir={files_dir}")
        file_system = LocalFileSystem(working_directory=files_dir)

        # 2) DB tool (Postgres)
        db_tool = RunSqlTool(
            sql_runner=PostgresRunner(
                host=db_host,
                database=db_name,
                user=db_user,
                password=db_password,
                port=db_port,
            ),
            file_system=file_system,
        )

        # 4) Memory (optional)
        agent_memory = DemoAgentMemory(max_items=int(os.getenv("VANNA_MEMORY_MAX", "1000")))


        # 5) Tools registry
        tools = ToolRegistry()
        tools.register_local_tool(db_tool, access_groups=["admin", "user"])
        tools.register_local_tool(CustomChartTool(), access_groups=["admin", "user"])

        tools.register_local_tool(VisualizeDataTool(file_system=file_system), access_groups=["admin", "user"])

        tools.register_local_tool(SaveQuestionToolArgsTool(), access_groups=["admin"])
        tools.register_local_tool(SearchSavedCorrectToolUsesTool(), access_groups=["admin", "user"])
        tools.register_local_tool(SaveTextMemoryTool(), access_groups=["admin", "user"])

        # 6) Agent
        self.agent = Agent(
            llm_service=llm,
            tool_registry=tools,
            user_resolver=DjangoUserResolver(),
            agent_memory=agent_memory,
        )

    async def ask(
        self,
        question: str,
        request_headers: Dict[str, str],
        request_cookies: Dict[str, str],
    ) -> VannaAnswer:
        """
        Vanna 2.x: agent.send_message(...) -> async stream UiComponents
        """
        try:
            ctx = RequestContext(headers=request_headers, cookies=request_cookies)

            components: List[Dict[str, Any]] = []
            async for comp in self.agent.send_message(request_context=ctx, message=question):
                if hasattr(comp, "model_dump"):
                    components.append(comp.model_dump())
                elif hasattr(comp, "dict"):
                    components.append(comp.dict())
                else:
                    components.append(comp if isinstance(comp, dict) else {"value": str(comp)})

            return VannaAnswer(components=components)

        except Exception as e:
            raise VannaServiceError(str(e)) from e


_service: Optional[VannaService] = None


def get_vanna_service() -> VannaService:
    global _service
    if _service is None:
        _service = VannaService()
    return _service
