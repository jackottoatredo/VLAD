import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { UserContextProvider } from "./contexts/UserContext";
import { NavigationGuardProvider } from "./contexts/NavigationGuardContext";
import LayoutChrome from "./components/LayoutChrome";
import AuthProvider from "./components/AuthProvider";
import ThemeProvider from "./components/ThemeProvider";
import ThemeToggle from "./components/ThemeToggle";
import Footer from "./components/Footer";
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
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-screen flex bg-background text-foreground">
        <ThemeProvider>
          <AuthProvider>
            <NavigationGuardProvider>
              <ThemeToggle />
              <UserContextProvider>
                <LayoutChrome>
                  {children}
                  <Footer />
                </LayoutChrome>
              </UserContextProvider>
            </NavigationGuardProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
