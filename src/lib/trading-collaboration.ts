import "server-only";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

const RUNTIME_DIR = "C:\\ProgramData\\YuJinTraders\\collaboration-sync";
const EVENTS_REPO = path.join(RUNTIME_DIR, "events-repo");
const COMMANDS_REPO = path.join(RUNTIME_DIR, "commands-repo");
const STATUS_PATH = path.join(RUNTIME_DIR, "status.json");
const GIT = "C:\\Program Files\\Git\\cmd\\git.exe";

export type CollaborationLog = {
  id: string;
  at: string;
  agentId?: string;
  actor: string;
  kind: "trade" | "command" | "sync";
  message: string;
};

export type CollaborationCommit = {
  branch: "trading-events" | "trading-slot-commands";
  hash: string;
  at: string;
  message: string;
};

type SafeStatus = {
  phase: string;
  updatedAt: string;
  lastExport: null | { market?: string; side?: string; at?: string; path?: string };
  lastCommand: null | { commandId?: string; agentId?: string; agentName?: string; operation?: string; slotId?: number; mode?: string; processedAt?: string; status?: string; path?: string };
  lastError?: string | null;
  pendingCommands?: number;
  exportedCount?: number;
};

function readJson(target: string): Record<string, unknown> {
  try { return JSON.parse(fs.readFileSync(target, "utf8").replace(/^\uFEFF/, "")) as Record<string, unknown>; }
  catch { return {}; }
}

function safeStatus(): SafeStatus {
  const source = readJson(STATUS_PATH);
  const exportSource = source.lastExport && typeof source.lastExport === "object" ? source.lastExport as Record<string, unknown> : null;
  const commandSource = source.lastCommand && typeof source.lastCommand === "object" ? source.lastCommand as Record<string, unknown> : null;
  return {
    phase: typeof source.phase === "string" ? source.phase : "unavailable",
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : new Date().toISOString(),
    lastExport: exportSource ? { market: String(exportSource.market || ""), side: String(exportSource.side || ""), at: String(exportSource.at || ""), path: String(exportSource.path || "") } : null,
    lastCommand: commandSource ? {
      commandId: String(commandSource.commandId || ""), agentId: String(commandSource.agentId || ""), agentName: String(commandSource.agentName || ""), operation: String(commandSource.operation || ""), slotId: Number(commandSource.slotId || 0), mode: String(commandSource.mode || ""), processedAt: String(commandSource.processedAt || ""), status: String(commandSource.status || ""), path: String(commandSource.path || ""),
    } : null,
    lastError: typeof source.lastError === "string" ? source.lastError : null,
    pendingCommands: Number(source.pendingCommands || 0),
    exportedCount: Number(source.exportedCount || 0),
  };
}

function gitLog(repo: string, branch: CollaborationCommit["branch"]): CollaborationCommit[] {
  try {
    const raw = execFileSync(GIT, ["-C", repo, "log", "-n", "8", "--format=%h%x1f%aI%x1f%s"], { encoding: "utf8", windowsHide: true });
    return raw.trim().split(/\r?\n/).filter(Boolean).flatMap((line) => {
      const [hash, at, message] = line.split("\u001f");
      return hash && at && message ? [{ branch, hash, at, message }] : [];
    });
  } catch { return []; }
}

function commandActor(message: string): string | undefined {
  const matched = message.match(/slot-command:\s+(c_[a-z]+)/i);
  return matched?.[1];
}

export function getCollaborationSnapshot() {
  const status = safeStatus();
  const commits = [...gitLog(EVENTS_REPO, "trading-events"), ...gitLog(COMMANDS_REPO, "trading-slot-commands")]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const logs: CollaborationLog[] = [];
  if (status.lastExport?.market && status.lastExport.side) logs.push({
    id: `trade-${status.lastExport.path || status.lastExport.at}`,
    at: status.lastExport.at || status.updatedAt,
    agentId: "c_trade_analyst",
    actor: "체결분석가",
    kind: "trade",
    message: `PAPER ${status.lastExport.side === "buy" ? "매수" : "매도"} 체결 · ${status.lastExport.market} · 차트·근거 GitHub 전송 완료`,
  });
  if (status.lastCommand?.commandId) logs.push({
    id: `command-${status.lastCommand.commandId}`,
    at: status.lastCommand.processedAt || status.updatedAt,
    agentId: status.lastCommand.agentId,
    actor: status.lastCommand.agentName || status.lastCommand.agentId || "슬롯관리",
    kind: "command",
    message: `PAPER 슬롯 ${status.lastCommand.operation || "명령"} · 슬롯 ${status.lastCommand.slotId || "-"} · ${status.lastCommand.status === "applied" ? "적용 완료" : status.lastCommand.status || "처리 확인 중"}`,
  });
  commits.slice(0, 8).forEach((commit) => logs.push({
    id: `${commit.branch}-${commit.hash}`,
    at: commit.at,
    agentId: commit.branch === "trading-slot-commands" ? commandActor(commit.message) : "c_trade_analyst",
    actor: commit.branch === "trading-events" ? "체결분석가" : "GitHub 명령",
    kind: "sync",
    message: `${commit.branch === "trading-events" ? "체결 동기화" : "슬롯 명령"} · ${commit.message}`,
  }));
  const unique = new Map<string, CollaborationLog>();
  logs.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).forEach((log) => unique.set(log.id, log));
  return { status, commits, logs: [...unique.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 12) };
}

export const collaborationWatchPaths = [RUNTIME_DIR, path.join(EVENTS_REPO, ".git", "logs"), path.join(COMMANDS_REPO, ".git", "logs")];
