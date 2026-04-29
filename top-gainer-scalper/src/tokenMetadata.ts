export type TokenLinkMetadata = {
    coinMarketCapSlug?: string;
    contractAddress?: string;
    chain?: string;
};

const TOKEN_METADATA: Record<string, TokenLinkMetadata> = {
    BTC: { coinMarketCapSlug: "bitcoin" },
    ETH: { coinMarketCapSlug: "ethereum" },
    BNB: { coinMarketCapSlug: "bnb" },
    SOL: { coinMarketCapSlug: "solana" },
    XRP: { coinMarketCapSlug: "xrp" },
    DOGE: { coinMarketCapSlug: "dogecoin" },
    ADA: { coinMarketCapSlug: "cardano" },
    AVAX: { coinMarketCapSlug: "avalanche" },
    LINK: { coinMarketCapSlug: "chainlink" },
    TON: { coinMarketCapSlug: "toncoin" },
};

export function getTokenMetadata(baseAsset: string): TokenLinkMetadata {
    return TOKEN_METADATA[baseAsset.toUpperCase()] ?? {};
}

export function getCoinMarketCapUrl(baseAsset: string): string {
    const metadata = getTokenMetadata(baseAsset);

    if (metadata.coinMarketCapSlug) {
        return `https://coinmarketcap.com/currencies/${metadata.coinMarketCapSlug}/`;
    }

    return `https://coinmarketcap.com/search/?q=${encodeURIComponent(baseAsset)}`;
}
