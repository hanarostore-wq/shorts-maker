import { EventEmitter } from "events";
import { departments as initialDepartments, projects } from "./mock-data";
import type { Department, Project } from "./types";

export interface LogEntry {
  id: string;
  time: string;
  departmentId: string;
  agentId: string;
  agentName: string;
  message: string;
}

interface State {
  departments: Department[];
  projects: Project[];
  log: LogEntry[];
  completedToday: number;
}

const emitter = new EventEmitter();

const state: State = {
  departments: structuredClone(initialDepartments),
  projects: structuredClone(projects),
  log: [],
  completedToday: 0,
};

export function getState(): State {
  return state;
}

export function subscribe(listener: (state: State) => void) {
  emitter.on("update", listener);
  return () => emitter.off("update", listener);
}

export function reportCompletion(input: {
  departmentId: string;
  agentId: string;
  message: string;
}) {
  const department = state.departments.find((d) => d.id === input.departmentId);
  if (!department) return null;
  const agent = department.agents.find((a) => a.id === input.agentId);
  if (!agent) return null;

  agent.status = "active";
  agent.task = input.message;

  const entry: LogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    time: new Date().toLocaleTimeString("ko-KR"),
    departmentId: department.id,
    agentId: agent.id,
    agentName: agent.name,
    message: input.message,
  };
  state.log.unshift(entry);
  state.log = state.log.slice(0, 30);
  state.completedToday += 1;

  emitter.emit("update", state);
  return entry;
}

export function reportFailure(input: {
  departmentId: string;
  agentId: string;
  message: string;
}) {
  const department = state.departments.find((d) => d.id === input.departmentId);
  if (!department) return null;
  const agent = department.agents.find((a) => a.id === input.agentId);
  if (!agent) return null;

  agent.status = "offline";
  agent.task = `⚠ ${input.message}`;

  const entry: LogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    time: new Date().toLocaleTimeString("ko-KR"),
    departmentId: department.id,
    agentId: agent.id,
    agentName: agent.name,
    message: `⚠ ${input.message}`,
  };
  state.log.unshift(entry);
  state.log = state.log.slice(0, 30);

  emitter.emit("update", state);
  return entry;
}
