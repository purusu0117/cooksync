import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // 個人ローカルアプリなので画像最適化はオフ（任意のsrc＝ローカル/生成画像URLをそのまま表示）
    unoptimized: true,
  },
  // スマホからTailscale経由(別オリジン)でdev資産にアクセスできるよう許可。
  // これが無いとNext devがJS/HMR/フォントをブロックし、画面は出るがボタンが無反応になる。
  allowedDevOrigins: ["node.tail41e069.ts.net", "100.85.225.61"],
};

export default nextConfig;
