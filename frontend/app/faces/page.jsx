import { redirect } from "next/navigation";

// People enrollment now lives inside the Face Attendance workspace.
export default function FacesRedirect() {
  redirect("/module/face_attendance?tab=people");
}
