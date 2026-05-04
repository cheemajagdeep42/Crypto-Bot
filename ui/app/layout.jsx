import "./globals.css";
import { Inter } from "next/font/google";
import { AppToaster } from "../components/providers/AppToaster";
import { SolanaProviders } from "../components/wallet/SolanaProviders";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter"
});

export const metadata = {
  title: "Crypto Signal Dashboard",
  description: "Crypto trading bot dashboard with Cursor-inspired UI"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={`${inter.variable} antialiased`}>
        <SolanaProviders>
          {children}
          <AppToaster />
        </SolanaProviders>
      </body>
    </html>
  );
}
