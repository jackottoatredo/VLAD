import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { UserContextProvider } from "./contexts/UserContext";
import HamburgerMenu from "./components/HamburgerMenu";
import AuthProvider from "./components/AuthProvider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "VLAD Recorder",
  description: "Video Language Automated Demo recording interface.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-black">
        <AuthProvider>
          <HamburgerMenu />
          <UserContextProvider>{children}</UserContextProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
