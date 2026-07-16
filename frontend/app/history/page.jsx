import { redirect } from "next/navigation";

// Cross-module event history now lives on the System status page.
export default function HistoryRedirect() {
  redirect("/status");
}
