import Link from "next/link";

export default function NotFound() {
  return (
    <div className="empty-state">
      <div className="icon">🧭</div>
      <h1>该记录不存在</h1>
      <p className="muted">链接可能已过期，或本地工作区中没有这条记录。</p>
      <Link className="btn primary" href="/opportunities">
        返回采购机会列表
      </Link>
    </div>
  );
}
