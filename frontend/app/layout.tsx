import type { Metadata } from "next";
import { Manrope, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "./utils/ThemeProvider";
import { UserProvider } from "./utils/UserContext";
import { SocketProvider } from "./utils/SocketProvider";
import Navbar from "./components/Navbar";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  weight: ["500", "600", "700", "800"],
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "DevArena",
  description: "Modern real-time competitive coding platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${manrope.variable} ${spaceGrotesk.variable}`}>
        <ThemeProvider>
          <UserProvider>
            <SocketProvider>
              <div className="app-shell [font-family:var(--font-manrope)]">
                <Navbar />
                <main>{children}</main>
              </div>
            </SocketProvider>
          </UserProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
