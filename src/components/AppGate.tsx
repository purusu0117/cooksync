"use client";

// 未ログインのままアプリ本体を使わせない（データの保存先が確定する前に入力させない）。
// 未ログインで保護ルートに来たら /mypage（登録・ログイン）へ誘導。
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

// ログイン不要で見せるルート
const PUBLIC = new Set(["/mypage", "/lp"]);

export default function AppGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    let session = false;
    try {
      session = window.localStorage.getItem("cooksync:session") === "1";
    } catch {
      /* noop */
    }
    const needsAuth = !PUBLIC.has(pathname);
    /* eslint-disable react-hooks/set-state-in-effect */
    if (!session && needsAuth) {
      setBlocked(true);
      router.replace("/mypage");
    } else {
      setBlocked(false);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [pathname, router]);

  if (blocked) return null;
  return <>{children}</>;
}
