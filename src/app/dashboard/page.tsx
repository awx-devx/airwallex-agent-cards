import { redirect } from "next/navigation";

// The dashboard is now the home screen (assistant + wallet balances + top-up).
// Keep this path working for old links by redirecting to it.
export default function DashboardRedirect() {
  redirect("/");
}
