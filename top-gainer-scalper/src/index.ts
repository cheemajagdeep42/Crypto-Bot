import { scanTopSignals } from "./scanner";

async function main(): Promise<void> {
    const result = await scanTopSignals(10);

    if (result.tokens.length === 0) {
        console.log("No scanner candidates found.");
        return;
    }

    console.log(`Updated: ${result.updatedAt}`);
    console.table(
        result.tokens.map((token) => ({
            symbol: token.symbol,
            signal: token.signal,
            score: `${token.score}/12`,
            gain: `${token.gainPercent.toFixed(2)}%`,
            pullback: token.pullbackPercent === null ? "n/a" : `${token.pullbackPercent.toFixed(2)}%`,
            spread: `${token.spreadPercent.toFixed(3)}%`,
            volume: `$${token.quoteVolume.toFixed(0)}`,
            entryApprox: token.ask,
        }))
    );
}

main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
});
