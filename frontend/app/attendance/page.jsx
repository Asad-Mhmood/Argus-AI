import { redirect } from "next/navigation";

// The attendance dashboard now lives inside the Face Attendance workspace.
export default function AttendanceRedirect() {
  redirect("/module/face_attendance?tab=attendance");
}
