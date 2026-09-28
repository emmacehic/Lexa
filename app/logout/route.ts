import { signOut } from "@/lib/auth";

/**
 * POST /logout — clear the session on this origin and send the browser to
 * /login. A native form post, so it does not follow AUTH_URL onto another
 * port the way client `signOut()` did.
 */
export async function POST(): Promise<Response> {
  return signOut({ redirectTo: "/login" });
}
