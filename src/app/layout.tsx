import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "COMPANY | Company Policy Assistant",
  description: "Secure answers grounded in company policy documents.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}