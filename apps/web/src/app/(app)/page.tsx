import { redirect } from "next/navigation";

/** Signed in, the app opens on the resume list (the shell sends visitors to sign in first). */
export default function HomePage() {
  redirect("/resumes");
}
