import { describe, it, expect } from "vitest";
import { hashPassword, isHashed, verifyPassword } from "../password";

describe("hashPassword", () => {
  it("平文をそのまま含まない", async () => {
    const h = await hashPassword("hunter2-secret");
    expect(h).not.toContain("hunter2-secret");
    expect(isHashed(h)).toBe(true);
  });

  it("同じパスワードでも毎回違うハッシュになる（ソルトが効いている）", async () => {
    const a = await hashPassword("samepassword");
    const b = await hashPassword("samepassword");
    expect(a).not.toBe(b);
  });
});

describe("verifyPassword", () => {
  it("正しいパスワードを受け付ける", async () => {
    const h = await hashPassword("correct-horse");
    const r = await verifyPassword("correct-horse", h);
    expect(r.ok).toBe(true);
    expect(r.needsUpgrade).toBe(false);
  });

  it("違うパスワードを拒否する", async () => {
    const h = await hashPassword("correct-horse");
    expect((await verifyPassword("wrong-horse", h)).ok).toBe(false);
  });

  it("旧データ（平文保存）でもログインでき、移行対象として印が付く", async () => {
    const r = await verifyPassword("oldplaintext", "oldplaintext");
    expect(r.ok).toBe(true);
    expect(r.needsUpgrade).toBe(true); // 呼び出し側がハッシュへ書き換える
  });

  it("旧データでもパスワードが違えば拒否する", async () => {
    const r = await verifyPassword("guess", "oldplaintext");
    expect(r.ok).toBe(false);
    expect(r.needsUpgrade).toBe(false);
  });

  it("保存値が空・壊れている場合は拒否する（例外を投げない）", async () => {
    expect((await verifyPassword("x", "")).ok).toBe(false);
    expect((await verifyPassword("x", "scrypt$broken")).ok).toBe(false);
    expect((await verifyPassword("x", "scrypt$zz$zz")).ok).toBe(false);
  });
});
