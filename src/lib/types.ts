export type AgentStatus = "active" | "standby" | "idle" | "offline";

export interface Agent {
  id: string;
  name: string;
  task: string;
  status: AgentStatus;
}

export interface Department {
  id: string;
  name: string;
  icon: string;
  agents: Agent[];
}

export interface Project {
  id: string;
  name: string;
  departmentId: string;
  agentCount: number;
  leadAgent: string;
}
