import "./globals.css";
import Nav from "@/components/Nav";

export const metadata = {
  title: "VisionGuard AI",
  description:
    "AI video surveillance: attendance, PPE compliance, activity monitoring and license plate recognition.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <Nav />
        <main className="page">{children}</main>
      </body>
    </html>
  );
}
