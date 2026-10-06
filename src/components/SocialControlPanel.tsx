"use client";

import { useCallback, useEffect, useState } from "react";

type Account = { id: string; username: string; updatedAt: string };
type Thread = { id: string; accountId: string; text: string; status: string; scheduledAt: string | null; permalink: string | null; error: string | null };
type Blog = { id: string; blogId: string; title: string; body: string; status: string; publishedUrl?: string | null; error?: string | null };
type BlogSchedule = { blogId: string; timezone: string; slots: string[] };
type Platform = "naver" | "threads";

const box = "w-full border border-[var(--control-line-strong)] bg-[var(--control-bg)] px-3 py-2 text-xs text-zinc-100 outline-none focus:border-[var(--control-cyan)]";
const button = "control-room-button px-3 py-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-40";
const label = "block text-[11px] font-bold text-[var(--control-muted)] mb-1";

export function SocialControlPanel({ platform }: { platform: Platform }) {
  const [key, setKey] = useState("");
  const [keyDraft, setKeyDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [posts, setPosts] = useState<Thread[]>([]);
  const [blogs, setBlogs] = useState<Blog[]>([]);
  const [schedules, setSchedules] = useState<BlogSchedule[]>([]);
  const [workerOnline, setWorkerOnline] = useState(false);
  const [token, setToken] = useState("");
  const [accountId, setAccountId] = useState("");
  const [text, setText] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [blogId, setBlogId] = useState("");
  const [title, setTitle] = useState("");
  const [blogBody, setBlogBody] = useState("");
  const [slot, setSlot] = useState("09:00");
  const path = platform === "threads" ? "/api/social/threads" : "/api/blog/naver";

  const load = useCallback(async (controlKey: string) => {
    if (!controlKey) return;
    try {
      const response = await fetch(path, { cache: "no-store", headers: { "x-social-control-key": controlKey } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "불러오기 실패");
      setWorkerOnline(Boolean(data.workerOnline));
      if (platform === "threads") {
        setAccounts(data.accounts || []);
        setPosts(data.posts || []);
        setAccountId((current) => current || data.accounts?.[0]?.id || "");
      } else {
        setBlogs(data.articles || []);
        setSchedules(data.schedules || []);
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "연결 오류"); }
  }, [path, platform]);

  useEffect(() => {
    const saved = sessionStorage.getItem("social-control-key") || "";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setKey(saved);
    if (saved) void load(saved);
  }, [load]);
  useEffect(() => {
    if (!key) return;
    const timer = window.setInterval(() => void load(key), 15000);
    return () => window.clearInterval(timer);
  }, [key, load]);

  async function send(body: Record<string, unknown>, method = "POST") {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(path, { method, headers: { "Content-Type": "application/json", "x-social-control-key": key }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "작업 실패");
      setMessage("저장했습니다");
      await load(key);
      return true;
    } catch (error) { setMessage(error instanceof Error ? error.message : "연결 오류"); return false; }
    finally { setBusy(false); }
  }
  const connected = Boolean(key);
  return <div className="flex flex-col gap-4 text-xs">
    <div className="control-room-panel border-l-2 border-l-[var(--control-cyan)] p-3">
      <div className="flex items-center justify-between gap-3"><strong className="text-sm text-[var(--control-cyan)]">{platform === "threads" ? "THREADS AUTO · 운영 콘솔" : "NAVER BLOG · 운영 콘솔"}</strong><span className={`text-[10px] ${workerOnline ? "text-emerald-300" : "text-amber-300"}`}>PC 작업자 {workerOnline ? "연결됨" : "연결 대기"}</span></div>
      <p className="mt-2 text-[11px] leading-5 text-zinc-400">{platform === "threads" ? "공식 Graph API로 계정을 연결하고 검토한 원고를 즉시 또는 예약 발행합니다" : "네이버 로그인은 로컬 Chrome에서 유지합니다 원고를 저장하고 브라우저 작업 대기열에 전달합니다"}</p>
    </div>
    {!connected && <form className="control-room-panel p-3" onSubmit={(event) => { event.preventDefault(); const value = keyDraft.trim(); sessionStorage.setItem("social-control-key", value); setKey(value); void load(value); }}>
      <label className={label}>관제실 소셜 접근키</label><div className="flex gap-2"><input className={box} type="password" autoComplete="off" value={keyDraft} onChange={(event) => setKeyDraft(event.target.value)} placeholder="서버에 설정된 접근키" required /><button className={button}>연결</button></div>
      <p className="mt-2 text-[10px] text-zinc-500">브라우저 탭을 닫으면 접근키가 지워집니다 네이버 비밀번호는 입력하지 않습니다</p>
    </form>}
    {connected && <div className="flex justify-end"><button className="text-[10px] text-zinc-500 hover:text-zinc-200" onClick={() => { sessionStorage.removeItem("social-control-key"); setKey(""); setAccounts([]); setPosts([]); setBlogs([]); }}>연결 해제</button></div>}
    {message && <div role="status" className="border border-amber-900 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-300">{message}</div>}
    {connected && platform === "threads" && <>
      <section className="control-room-panel p-3"><div className="mb-3 flex justify-between"><strong>01 · 계정 연결</strong><span className="text-zinc-500">{accounts.length}개 계정</span></div>
        <div className="flex gap-2"><input className={box} type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Meta Threads 장기 Access Token" /><button disabled={busy || !token.trim()} className={button} onClick={async () => { if (await send({ action: "connect", token })) setToken(""); }}>확인·저장</button></div>
        <p className="mt-2 text-[10px] text-zinc-500">threads_basic · threads_content_publish 권한 필요 토큰은 서버에서 암호화해 저장됩니다</p>
        <div className="mt-3 flex flex-wrap gap-1">{accounts.map((a) => <span key={a.id} className="border border-emerald-900 bg-emerald-950/20 px-2 py-1 text-emerald-300">@{a.username}</span>)}</div>
      </section>
      <section className="control-room-panel p-3"><strong>02 · 원고 작성 및 예약</strong>
        <label className={`${label} mt-3`}>게시 계정</label><select className={box} value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">계정 선택</option>{accounts.map((a) => <option key={a.id} value={a.id}>@{a.username}</option>)}</select>
        <label className={`${label} mt-3`}>게시할 실제 문구 · 500자 이하</label><textarea rows={5} maxLength={500} className={box} value={text} onChange={(event) => setText(event.target.value)} placeholder="이 문구가 그대로 공개됩니다" /><div className="text-right text-[10px] text-zinc-500">{text.length} / 500</div>
        <label className={`${label} mt-2`}>예약 시각 · 선택 사항 · 한국 시각</label><input className={box} type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} />
        <p className="mt-2 text-[10px] text-amber-400">PC 관제 브라우저가 실행 중이면 지정 시각에 처리합니다 꺼져 있으면 다음 날 09:00~09:59 KST 서버가 예약 작업을 확인합니다</p>
        <button disabled={busy || !accountId || !text.trim()} className={`${button} mt-3`} onClick={async () => { if (await send({ action: "create", accountId, text, scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null })) { setText(""); setScheduledAt(""); } }}>문구 확인 후 {scheduledAt ? "예약" : "초안 저장"}</button>
      </section>
      <section className="control-room-panel p-3"><div className="mb-3 flex justify-between"><strong>03 · 게시 대기 / 이력</strong><span className="text-zinc-500">{posts.length}건</span></div>
        <div className="max-h-80 space-y-2 overflow-auto">{posts.map((post) => <div key={post.id} className="border border-[var(--control-line)] bg-[var(--control-bg)] p-3"><div className="flex justify-between"><b className="text-[var(--control-cyan)]">{accounts.find((a) => a.id === post.accountId)?.username || post.accountId}</b><span className={post.status === "needs_review" || post.status === "failed" ? "text-red-400" : "text-emerald-300"}>{post.status}</span></div><p className="my-2 whitespace-pre-wrap leading-5 text-zinc-200">{post.text}</p><div className="text-[10px] text-zinc-500">{post.scheduledAt ? `예약 ${new Date(post.scheduledAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}` : "예약 없음"}</div>{post.error && <p className="mt-1 text-red-400">{post.error}</p>}{post.permalink && <a className="text-cyan-300 underline" href={post.permalink} target="_blank" rel="noreferrer">게시물 열기 ↗</a>}<div className="mt-2 flex gap-2">{["draft", "scheduled", "failed"].includes(post.status) && <button className={button} disabled={busy} onClick={() => void send({ action: "publish", id: post.id })}>이 문구 즉시 게시</button>}{post.status === "scheduled" && <button className={button} disabled={busy} onClick={() => void send({ action: "cancel", id: post.id })}>예약 취소</button>}</div></div>)}{posts.length === 0 && <p className="text-zinc-500">등록된 원고가 없습니다</p>}</div>
      </section>
    </>}
    {connected && platform === "naver" && <>
      <section className="control-room-panel p-3"><strong>01 · 네이버 원고 등록</strong><p className="mt-2 text-[10px] text-zinc-500">원본 BlogAuto와 동일하게 블로그 ID만 보관하며 비밀번호를 수집하지 않습니다</p>
        <label className={`${label} mt-3`}>블로그 ID</label><input className={box} value={blogId} onChange={(event) => setBlogId(event.target.value)} placeholder="blog.naver.com/ 뒤의 ID" />
        <label className={`${label} mt-3`}>제목</label><input className={box} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="발행할 제목" />
        <label className={`${label} mt-3`}>본문</label><textarea className={box} rows={7} value={blogBody} onChange={(event) => setBlogBody(event.target.value)} placeholder="검토한 원고를 입력하세요" />
        <button className={`${button} mt-3`} disabled={busy || !/^[a-zA-Z0-9_-]{2,50}$/.test(blogId) || !title.trim() || !blogBody.trim()} onClick={async () => { if (await send({ blogId, title: title.trim(), body: blogBody.trim(), autoPublishEligible: true })) { setTitle(""); setBlogBody(""); } }}>READY 원고 보관 · 예약 대상</button>
      </section>
      <section className="control-room-panel p-3"><strong>02 · 매일 자동 작업 시간</strong><div className="mt-2 flex gap-2"><input type="time" className={box} value={slot} onChange={(event) => setSlot(event.target.value)} /><button className={button} disabled={busy || !blogId} onClick={() => void send({ action: "save-schedule", blogId, slots: [slot], timezone: "Asia/Seoul" }, "PATCH")}>저장</button></div><div className="mt-2 text-[10px] text-zinc-500">{schedules.map((s) => `${s.blogId}: ${s.slots.join(", ")}`).join(" · ") || "예약 없음"}</div><p className="mt-1 text-[10px] text-amber-400">PC 관제 브라우저 실행 중에는 예약 시각에 작업합니다 꺼져 있으면 다음 날 09:00~09:59 KST 서버가 작업을 대기열에 넣습니다 실제 발행에는 PC 로그인과 연결이 필요합니다</p></section>
      <section className="control-room-panel p-3"><div className="mb-3 flex justify-between"><strong>03 · 원고 대기 / 발행 상태</strong><span className="text-zinc-500">{blogs.length}건</span></div><div className="max-h-80 space-y-2 overflow-auto">{blogs.map((article) => <div key={article.id} className="border border-[var(--control-line)] bg-[var(--control-bg)] p-3"><div className="flex items-start justify-between gap-2"><b className="text-zinc-100">{article.title}</b><span className="text-emerald-300">{article.status}</span></div><div className="my-2 text-[10px] text-zinc-500">{article.blogId}</div><p className="line-clamp-3 whitespace-pre-wrap text-zinc-400">{article.body}</p>{article.error && <p className="mt-2 text-red-400">{article.error}</p>}{article.publishedUrl && <a className="text-cyan-300 underline" href={article.publishedUrl} target="_blank" rel="noreferrer">공개 글 확인 ↗</a>}{["ready", "failed"].includes(article.status) && <button disabled={busy} className={`${button} mt-2`} onClick={() => void send({ id: article.id, action: "publish-now" }, "PATCH")}>브라우저 작업기에 발행 요청</button>}</div>)}{blogs.length === 0 && <p className="text-zinc-500">저장된 원고가 없습니다</p>}</div></section>
      <a className="text-[10px] text-cyan-300 underline" href="https://github.com/boksajang/naverblog-extention" target="_blank" rel="noreferrer">원본 PC 프로그램 / Chrome 연결 설명 ↗</a>
    </>}
  </div>;
}
