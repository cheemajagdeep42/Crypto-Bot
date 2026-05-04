/**
 * Manual list for the “Other Investments” accordion. Amounts below use AUD where noted.
 *
 * @type {Array<{
 *   id: string;
 *   investmentType: string;
 *   name: string;
 *   sourceLabel: string;
 *   sourceUrl: string;
 *   totalInvested: number;
 *   buyPriceAud?: number | null;
 *   pnl: number | null;
 *   dateInvested: string;
 *   chartUrl: string;
 * }>}
 */
export const otherInvestments = [
  {
    id: "asx-zip",
    investmentType: "ASX stock",
    name: "ZIP — Zip Co Ltd",
    sourceLabel: "CommSec",
    sourceUrl: "https://www.commsec.com.au/",
    totalInvested: 20_000,
    buyPriceAud: null,
    pnl: null,
    dateInvested: "2026-03-24",
    chartUrl: "https://www.tradingview.com/symbols/ASX-ZIP/"
  },
  {
    id: "crypto-lunc",
    investmentType: "Crypto",
    name: "LUNC — Terra Luna Classic",
    sourceLabel: "CoinSpot",
    sourceUrl: "https://www.coinspot.com.au/",
    totalInvested: 5000,
    buyPriceAud: null,
    pnl: null,
    dateInvested: "2026-03-24",
    chartUrl: "https://www.coingecko.com/en/coins/terra-luna-classic"
  },
  {
    id: "gold-xau",
    investmentType: "Gold",
    name: "Gold — XAU",
    sourceLabel: "StarTrader",
    sourceUrl: "https://myaccount.startrader.com/home",
    totalInvested: 1500,
    buyPriceAud: null,
    pnl: null,
    dateInvested: "2026-03-24",
    chartUrl: "https://goldprice.org/live-gold-price.html"
  }
];
