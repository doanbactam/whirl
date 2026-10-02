import { SITE_LINKS } from "@/lib/site";

/* Whirl's public source, and whether this browser has already been told
   about it. The announcement is a once-per-browser moment, so a plain
   localStorage flag is enough — nothing about it is worth a server row. */

export const REPO_URL = SITE_LINKS.repo;

/** "whirlchat/whirl", for fine print. */
export const REPO_LABEL = new URL(REPO_URL).pathname.replace(/^\/+/, "");

const SEEN_KEY = "announcement:open-source";

export function hasSeenOpenSourceAnnouncement(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    /* Storage is off (private mode, a locked-down embed). Without a way to
       remember the dismissal it would come back on every load, so treat it
       as seen instead. */
    return true;
  }
}

export function markOpenSourceAnnouncementSeen() {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // private mode etc. — closing it still closes it for this visit
  }
}
