export type TokenLinkMetadata = {
    coinMarketCapSlug?: string;
    contractAddress?: string;
    chain?: string;
    marketCapUsd?: number;
};

const TOKEN_METADATA: Record<string, TokenLinkMetadata> = {
    BTC: { coinMarketCapSlug: "bitcoin", marketCapUsd: 1_500_000_000_000 },
    ETH: { coinMarketCapSlug: "ethereum", marketCapUsd: 400_000_000_000 },
    BNB: { coinMarketCapSlug: "bnb", marketCapUsd: 85_000_000_000 },
    SOL: { coinMarketCapSlug: "solana", marketCapUsd: 70_000_000_000 },
    XRP: { coinMarketCapSlug: "xrp", marketCapUsd: 120_000_000_000 },
    DOGE: { coinMarketCapSlug: "dogecoin", marketCapUsd: 30_000_000_000 },
    ADA: { coinMarketCapSlug: "cardano", marketCapUsd: 20_000_000_000 },
    AVAX: { coinMarketCapSlug: "avalanche", marketCapUsd: 15_000_000_000 },
    LINK: { coinMarketCapSlug: "chainlink", marketCapUsd: 10_000_000_000 },
    TON: { coinMarketCapSlug: "toncoin", marketCapUsd: 12_000_000_000 },
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
