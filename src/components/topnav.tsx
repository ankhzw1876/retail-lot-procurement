"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/opportunities", label: "采购机会" },
  { href: "/decisions", label: "决策记录" },
  { href: "/data", label: "数据说明" },
];

export function TopNav() {
  const pathname = usePathname();
  return (
    <header className="topbar">
      <div>
        <Link className="brand" href="/" aria-current={pathname === "/" ? "page" : undefined}>采购系统</Link>{" "}
        <span className="subtitle">品牌尾货采购评估工作台</span>
      </div>
      <nav aria-label="主导航">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={pathname.startsWith(n.href) ? "active" : undefined}
          >
            {n.label}
          </Link>
        ))}
      </nav>
      <span className="demo-badge">演示数据 · 情景测算，非销售承诺</span>
    </header>
  );
}
