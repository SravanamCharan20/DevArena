import type { Metadata } from "next";
import "./globals.css";
import { UserProvider } from "./utils/UserContext";

export const metadata: Metadata = {
  title: "CodeClash",
  description: "Competitive coding platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <UserProvider>
          {children}
        </UserProvider>
      </body>
    </html>
  );
}
