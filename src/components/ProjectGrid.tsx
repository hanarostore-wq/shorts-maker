import type { Project } from "@/lib/types";

export function ProjectGrid({ projects }: { projects: Project[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {projects.map((project) => (
        <div
          key={project.id}
          className="flex flex-col gap-1 border-2 border-zinc-700 bg-zinc-950 p-3"
        >
          <div className="flex items-center justify-between">
            <span className="truncate text-xs font-bold text-zinc-100">
              {project.name}
            </span>
            <span className="font-mono text-xs font-bold text-emerald-400">
              {project.agentCount}명
            </span>
          </div>
          <span className="truncate text-[11px] text-zinc-500">담당 · {project.leadAgent}</span>
        </div>
      ))}
    </div>
  );
}
