import Link from "next/link";
import { IntegrationPanel } from "@/components/IntegrationPanel";

export default function SettingsPage() {
  return (
    <div className="flex flex-1 flex-col gap-6 bg-black px-4 py-6 font-mono sm:px-8">
      <header className="flex items-center justify-between border-b-2 border-zinc-700 pb-4">
        <h1 className="text-lg font-bold tracking-wide text-zinc-50">⚙ 설정</h1>
        <Link
          href="/"
          className="border-2 border-zinc-700 px-3 py-1.5 text-xs font-bold text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
        >
          ← 관제실로
        </Link>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-bold text-zinc-300">외부 연동</h2>
        <IntegrationPanel />
        <p className="text-[11px] text-zinc-600">
          연동에 문제가 생기면 이 화면이 아니라 관제실의 &quot;스토어부서&quot;에서
          해당 직원 상태로 바로 표시됩니다.
        </p>
      </section>
    </div>
  );
}
