import { redirect } from "next/navigation";
import { requirePlatformSession } from "@/lib/platform/guards";

/** /platform → the dashboard, after the same live-session check every console page makes. */
export default async function PlatformIndex() {
  await requirePlatformSession();
  redirect("/platform/dashboard");
}
