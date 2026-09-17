import { StatCounter } from "@/components/StatCounter";
import { DepartmentCard } from "@/components/DepartmentCard";
import { ProjectGrid } from "@/components/ProjectGrid";
import { departments, projects } from "@/lib/mock-data";

export default function Home() {
  const allAgents = departments.flatMap((d) => d.agents);
  const counts = {
    active: allAgents.filter((a) => a.status === "active").length,
    standby: allAgents.filter((a) => a.status === "standby").length,
    idle: allAgents.filter((a) => a.status === "idle").length,
    offline: allAgents.filter((a) => a.status === "offline").length,
  };

  return (
    <div className="flex flex-1 flex-col gap-6 bg-black px-4 py-6 sm:px-8">
      <header className="flex flex-col gap-4 border-b border-zinc-800 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">🏢</span>
            <h1 className="text-lg font-bold tracking-wide text-zinc-50">
              운영본부 <span className="text-zinc-500">AGENT HQ</span>
            </h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatCounter label="Active" value={counts.active} tone="green" />
            <StatCounter label="Standby" value={counts.standby} tone="blue" />
            <StatCounter label="Idle" value={counts.idle} tone="gray" />
            <StatCounter label="Offline" value={counts.offline} tone="red" />
          </div>
        </div>
        <p className="text-xs text-zinc-500">
          {departments.length}개 부서 · {allAgents.length}명 에이전트 운영 중
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-zinc-300">프로젝트</h2>
        <ProjectGrid projects={projects} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-zinc-300">부서 관제</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {departments.map((department) => (
            <DepartmentCard key={department.id} department={department} />
          ))}
        </div>
      </section>
    </div>
  );
}
