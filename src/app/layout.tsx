import type { Metadata, Viewport } from "next";
import { TimeZoneSync } from "@/components/system/TimeZoneSync";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "WorkPulse — Know who's free, who's slammed, who's shipping",
    template: "%s · WorkPulse",
  },
  description:
    "WorkPulse gives freelancer teams a live view of everyone's free hours, the client work on their plate, and how close each task is to done.",
  applicationName: "WorkPulse",
  robots: { index: true, follow: true },
  openGraph: {
    title: "WorkPulse — Team availability, decoded",
    description: "Live workload, free hours and client tasks for freelancer teams.",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#4f46e5",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TimeZoneSync />
        {children}
      </body>
    </html>
  );
}
