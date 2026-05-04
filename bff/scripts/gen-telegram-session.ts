/**
 * One-time interactive login: prints TELEGRAM_STRING_SESSION for bff/.env
 *
 * Prereqs: TELEGRAM_API_ID + TELEGRAM_API_HASH in env — get them after logging in at
 *   https://my.telegram.org → then open https://my.telegram.org/apps (“API development tools” form).
 *   Not BotFather; see https://core.telegram.org/api/obtaining_api_id
 *
 * Run from repo bff folder:
 *   npx ts-node --transpile-only scripts/gen-telegram-session.ts
 */
import "dotenv/config";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";

async function main(): Promise<void> {
    const apiId = Number(process.env.TELEGRAM_API_ID);
    const apiHash = (process.env.TELEGRAM_API_HASH ?? "").trim();
    if (!Number.isFinite(apiId) || apiId <= 0 || !apiHash) {
        console.error("Set TELEGRAM_API_ID and TELEGRAM_API_HASH in bff/.env (see https://my.telegram.org).");
        process.exit(1);
    }

    const rl = readline.createInterface({ input, output });
    const stringSession = new StringSession("");
    const client = new TelegramClient(stringSession, apiId, apiHash, { connectionRetries: 5 });

    try {
        await client.start({
            phoneNumber: async () => (await rl.question("Phone (+country code, e.g. +61...): ")).trim(),
            phoneCode: async () => (await rl.question("Code from Telegram: ")).trim(),
            password: async () => (await rl.question("2FA password (leave empty if none): ")).trim(),
            onError: async (err) => {
                console.error(err);
                return false;
            },
        });
    } finally {
        rl.close();
    }

    const saved = (client.session as StringSession).save();
    console.log("\nAdd this line to bff/.env:\n");
    console.log(`TELEGRAM_STRING_SESSION=${saved}\n`);
    await client.disconnect();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
