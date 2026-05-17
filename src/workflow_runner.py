import io
import os
import subprocess
import threading
from pathlib import Path
from typing import Optional

from src.workflow_output import humanize_workflow_line


class WorkflowRunner:
    def __init__(
        self,
        repo_root: Path,
        workflow_script: str,
        base_branch: str,
        ai_agent: str,
        ai_agent_label: str,
        timeout_seconds: int,
        logger,
    ) -> None:
        self.repo_root = repo_root
        self.workflow_script = workflow_script
        self.base_branch = base_branch
        self.ai_agent = ai_agent
        self.ai_agent_label = ai_agent_label
        self.timeout_seconds = timeout_seconds
        self.logger = logger

    def run(self, issue_key: str) -> str:
        script_path = (self.repo_root / self.workflow_script).resolve()
        if not script_path.exists():
            raise RuntimeError(f"Workflow script not found: {script_path}")

        command = [str(script_path), issue_key, self.base_branch]
        env = os.environ.copy()
        env["AI_AGENT"] = self.ai_agent
        self.logger.info("Executing workflow script (agent=%s): %s", self.ai_agent, " ".join(command))
        proc = subprocess.Popen(
            command,
            cwd=str(self.repo_root),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        output_lines: list[str] = []

        output_thread = threading.Thread(target=self._consume_output, args=(issue_key, proc.stdout, output_lines), daemon=True)
        output_thread.start()

        try:
            return_code = proc.wait(timeout=self.timeout_seconds)
        except subprocess.TimeoutExpired as exc:
            proc.kill()
            output_thread.join(timeout=2)
            tail = _tail(output_lines)
            raise RuntimeError(
                f"{self.ai_agent_label} workflow timed out after {self.timeout_seconds} seconds.\n{tail}"
            ) from exc

        output_thread.join(timeout=2)
        combined = "\n".join(output_lines)
        if return_code != 0:
            tail = _tail(output_lines)
            if "Blocked on environment access." in combined or "bwrap: No permissions to create a new namespace" in combined:
                raise RuntimeError(
                    f"{self.ai_agent_label} could not start inside the PRonto container because sandboxed exec mode is enabled.\n"
                    "Use CODEX_EXEC_ARGS=--dangerously-bypass-approvals-and-sandbox for Codex in Docker, then relaunch PRonto.\n"
                    f"{tail}"
                )
            raise RuntimeError(f"{self.ai_agent_label} workflow failed (exit {return_code}).\n{tail}")
        return combined.strip()

    def _consume_output(self, issue_key: str, stream: Optional[io.TextIOBase], output_lines: list[str]) -> None:
        if stream is None:
            return
        try:
            for raw_line in iter(stream.readline, ""):
                line = raw_line.rstrip()
                if not line:
                    continue
                output_lines.append(line)
                friendly_line = humanize_workflow_line(line)
                if friendly_line:
                    self.logger.info("workflow[%s]: %s", issue_key, friendly_line)
        finally:
            stream.close()


def _tail(output_lines: list[str], line_count: int = 30) -> str:
    return "\n".join(output_lines[-line_count:])
