import { redirect } from "next/navigation";

// Profile now lives as a tab inside Settings (the sidebar was getting busy).
// Keep this route as a redirect so old links / bookmarks still land in the
// right place.
export default function ProfilePage() {
  redirect("/settings?tab=profile");
}
