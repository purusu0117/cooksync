import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // 個人ローカルアプリなので画像最適化はオフ（任意のsrc＝ローカル/生成画像URLをそのまま表示）
    unoptimized: true,
  },
};

export default nextConfig;
