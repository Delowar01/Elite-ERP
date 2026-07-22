import { redirect } from "next/navigation";

// The Team management UI lives inside Business Settings (the Users → Team tab). The standalone
// /settings/team route had no page and 404'd; redirect it to the correct tab so the nav item and
// any bookmarks resolve to the real Team panel.
export default function TeamSettingsPage() {
  redirect("/settings/organization?tab=team");
}
