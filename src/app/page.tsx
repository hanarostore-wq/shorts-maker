import HomeClient from "./HomeClient";

// 관제실 HTML은 최신 클라이언트 청크와 섞이지 않도록 Vercel 정적 캐시를 사용하지 않는다.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function Page() {
  return <HomeClient />;
}
