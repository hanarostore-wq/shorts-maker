import { PLAN_FEATURES, PLAN_PRICES } from "@/lib/license";
import { LicenseChecker } from "@/components/LicenseChecker";

// 결제 링크·문의처를 환경변수로 바꾼 뒤 다시 배포하지 않아도 반영되도록
// 요청마다 새로 그린다.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "소싱 마스터 PRO - 상품 소싱 + 마진 계산 확장프로그램",
  description:
    "쇼핑몰 화면에서 상품을 바로 수집하고, 팔면 얼마 남는지 즉시 계산해주는 크롬 확장프로그램.",
};

const FEATURE_ROWS: Array<{ label: string; free: string; pro: string }> = [
  { label: "상품 소싱", free: "하루 5건", pro: "무제한" },
  { label: "마진 계산기", free: "있음", pro: "있음" },
  { label: "목록 페이지 통째로 수집", free: "—", pro: "있음" },
  { label: "CSV 내보내기", free: "—", pro: "있음" },
  {
    label: "사용 기기",
    free: `${PLAN_FEATURES.free.maxDevices}대`,
    pro: `${PLAN_FEATURES.pro.maxDevices}대 (평생 ${PLAN_FEATURES.lifetime.maxDevices}대)`,
  },
];

export default function ProPage() {
  const checkoutUrls: Record<string, string | undefined> = {
    pro: process.env.CHECKOUT_URL_PRO,
    lifetime: process.env.CHECKOUT_URL_LIFETIME,
  };
  const contact = process.env.SUPPORT_CONTACT ?? "";

  return (
    <main className="flex flex-1 flex-col items-center bg-black px-4 py-10 font-mono text-zinc-200">
      <div className="flex w-full max-w-3xl flex-col gap-8">
        <header className="flex flex-col gap-3 border-b-2 border-zinc-700 pb-6">
          <span className="text-xs text-emerald-400">크롬 확장프로그램</span>
          <h1 className="text-2xl font-bold text-zinc-50">소싱 마스터 PRO</h1>
          <p className="text-sm leading-relaxed text-zinc-400">
            쇼핑몰 상품 페이지에서 버튼 한 번으로 상품 정보를 수집하고,
            <br />
            수수료·택배비까지 계산해서 <span className="text-emerald-400">팔면 얼마 남는지</span>를
            그 자리에서 알려줍니다.
          </p>
        </header>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-bold text-zinc-300">무료 / 프로 차이</h2>
          <div className="border border-zinc-800">
            <div className="grid grid-cols-3 gap-2 border-b border-zinc-800 bg-zinc-900 p-2 text-[11px] font-bold text-zinc-400">
              <span>기능</span>
              <span>무료</span>
              <span className="text-emerald-400">프로</span>
            </div>
            {FEATURE_ROWS.map((row) => (
              <div
                key={row.label}
                className="grid grid-cols-3 gap-2 border-b border-zinc-900 p-2 text-[12px] last:border-b-0"
              >
                <span className="text-zinc-300">{row.label}</span>
                <span className="text-zinc-500">{row.free}</span>
                <span className="text-emerald-400">{row.pro}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-bold text-zinc-300">가격</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {PLAN_PRICES.map((plan) => {
              const url = checkoutUrls[plan.plan];
              return (
                <div
                  key={plan.plan}
                  className="flex flex-col gap-3 border border-zinc-700 bg-zinc-900 p-4"
                >
                  <span className="text-[12px] font-bold text-zinc-300">{plan.name}</span>
                  <span className="text-2xl font-bold text-emerald-400">
                    {plan.price.toLocaleString("ko-KR")}
                    <span className="text-sm text-zinc-500">
                      원{plan.months ? " / 월" : ""}
                    </span>
                  </span>
                  <p className="text-[11px] leading-relaxed text-zinc-500">{plan.description}</p>
                  {url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="border-2 border-emerald-500 bg-emerald-500/15 p-2 text-center text-[12px] font-bold text-emerald-400 hover:bg-emerald-500/25"
                    >
                      구매하기
                    </a>
                  ) : (
                    <span className="border border-zinc-700 p-2 text-center text-[11px] text-zinc-600">
                      결제 링크 준비 중 (환경변수 CHECKOUT_URL_
                      {plan.plan.toUpperCase()} 설정)
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-zinc-600">
            결제가 끝나면 등록하신 이메일로 라이선스 키가 발송됩니다. 확장프로그램을 열고
            키를 붙여넣으면 바로 프로가 켜집니다.
            {contact && ` · 문의 ${contact}`}
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-bold text-zinc-300">내 라이선스 확인</h2>
          <LicenseChecker />
        </section>

        <footer className="border-t border-zinc-800 pt-4 text-[11px] leading-relaxed text-zinc-600">
          환불: 결제 후 7일 이내, 프로 기능을 사용하지 않았다면 전액 환불해 드립니다.
          <br />
          기기를 바꾸셨다면 기존 기기 해제를 요청해 주세요. 키 하나로 여러 명이 나눠 쓰는 것은
          이용약관 위반이며 키가 회수될 수 있습니다.
        </footer>
      </div>
    </main>
  );
}
