import { Metadata } from "next";

export const metadata: Metadata = {
  title: "남다른AI - Shorts 분석기 | 운영본부 관제실",
  description: "유튜브 쇼츠 바이럴 역설계, 6대 소재 발굴, 1문장 대본 및 미드저니/Suno 프롬프트 일체형 스튜디오",
};

export default function ShortsPage() {
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#090D16]">
      <iframe
        src="/shorts/index.html"
        title="남다른AI Shorts 분석기"
        className="h-full w-full border-0"
      />
    </div>
  );
}
