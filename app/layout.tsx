import type { Metadata } from "next";
import "./globals.css";

const DESCRIPTION = "输入北京的一个地址，自动统计周边 1 km 的 7 类设施，生成交互地图与逐条校验的场地分析简报。";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.dzs-agent.com"),
  title: "场地分析 Agent",
  description: DESCRIPTION,
  openGraph: {
    title: "场地分析 Agent",
    description: DESCRIPTION,
    url: "/",
    siteName: "场地分析 Agent",
    locale: "zh_CN",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "场地分析 Agent：周边设施统计、交互地图与逐条校验的简报" }],
  },
  twitter: { card: "summary_large_image", title: "场地分析 Agent", description: DESCRIPTION, images: ["/og.png"] },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="zh-CN"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
