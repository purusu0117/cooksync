import { identify, readCookie, verifySession } from "../session";
import { KitchenError } from "./engine";
export function kitchenIdentity(request: Request) {
  const account = identify(request);
  if (account.trusted) return account;
  const guest = verifySession(readCookie(request, "cooksync_kitchen_guest"));
  return guest ? { ...account, uid: guest.uid, dataId: guest.dataId, trusted: true } : account;
}
export function requireSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  const expected = process.env.COOKSYNC_PUBLIC_ORIGIN
    ? new URL(process.env.COOKSYNC_PUBLIC_ORIGIN).origin
    : `${url.protocol}//${request.headers.get("host") || url.host}`;
  // Next's internal URL may use localhost even when the browser connected to 127.0.0.1.
  // Host is browser-controlled by the target URL; deployment can pin the public origin explicitly.
  if (origin && origin !== expected) throw new KitchenError("別サイトからの操作は受け付けられません", 403);
}
