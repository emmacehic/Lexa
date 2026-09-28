import { redirect } from "next/navigation";

import { currentUser } from "@/lib/authz";

export default async function Home() {
  const user = await currentUser();
  redirect(user ? "/library" : "/login");
}
