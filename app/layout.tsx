import type { Metadata } from "next";
import "./globals.css";
import { WorkspaceProvider } from "@/components/workspace";
import { TopNav } from "@/components/topnav";

export const metadata: Metadata = {
  title: "采购系统｜品牌尾货采购评估工作台",
  description: "品牌尾货批次采购评估工作台（面试演示，全部合成数据）",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <WorkspaceProvider>
          <TopNav />
          <main className="container">{children}</main>
          <footer className="page-footer">
            演示系统：所有品牌、门店、供应商与经营数据均为合成数据，不代表任何真实公司。
            情景贡献为假设测算，不是销售承诺或会计净利润。数据仅保存在当前浏览器。
          </footer>
        </WorkspaceProvider>
      </body>
    </html>
  );
}
