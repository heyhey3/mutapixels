import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { WalletProvider } from "@/components/wallet-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mutapixels — an NFT that can hold money",
  description:
    "NEP-171 pixel creatures on NEAR with their own token vaults. Mutations pay royalties, anyone can feed a pixel, only the current holder can withdraw, and the vault moves with the token on transfer.",
};

const themeScript = `(function(){try{var saved=localStorage.getItem("mutapixels-theme");var system=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches;var theme=(saved==="light"||saved==="dark")?saved:(system?"dark":"light");document.documentElement.dataset.theme=theme;}catch(e){document.documentElement.dataset.theme="light";}})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <WalletProvider>
          <SiteHeader />
          <main>{children}</main>
          <footer className="footer">
            <span>MUTAPIXELS · NEAR TESTNET · NEP-171 TOKEN ACCOUNTS</span>
            <span>Testnet prototype. Not audited. No yield is promised.</span>
          </footer>
        </WalletProvider>
      </body>
    </html>
  );
}
