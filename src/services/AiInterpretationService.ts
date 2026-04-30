// Atlaix: Intelligence service module for Atlaix data workflows.

export interface InterpretationResult {
    original: string;
    structured: string;
    confidence: number;
    details?: {
        target?: string;
        action?: string;
        condition?: string;
        tokenAddress?: string; // Added field
    };
}

export class AiInterpretationService {
    /**
     * Simulates an AI interpretation of the user's natural language request.
     * In a real app, this would call an LLM API.
     */
    static async interpretAlert(text: string): Promise<InterpretationResult> {
        // Simulate network delay
        await new Promise(resolve => setTimeout(resolve, 1500));

        const lowerText = text.toLowerCase();
        let structured = "";
        let target = "Solana (SOL)"; // Default to a specific token instead of "Any Token"
        let tokenAddress = "So11111111111111111111111111111111111111112"; // Default SOL CA
        let action = "Monitor";
        let condition = "Unknown Condition";

        // 1. Detect Token/Asset
        if (lowerText.includes("bitcoin") || lowerText.includes("btc")) {
            target = "Bitcoin (BTC)";
            tokenAddress = "3abc...5xyz (Wrapped)"; // Mock wrapped BTC
        } else if (lowerText.includes("eth") || lowerText.includes("ethereum")) {
            target = "Ethereum (ETH)";
            tokenAddress = "0x2170...93e18 (Wrapped)"; // Mock wrapped ETH
        } else if (lowerText.includes("sol") || lowerText.includes("solana")) {
            target = "Solana (SOL)";
            tokenAddress = "So11111111111111111111111111111111111111112";
        } else if (lowerText.includes("pepe")) {
            target = "PEPE";
            tokenAddress = "0x6982508145454Ce325dDbE47a25d4ec3d2311933";
        } else {
            // For unknown/gibberish input, pick a "random" token to simulate AI "guessing" or "choosing"
            // simulating "choose the name of a token to put there"
            target = "Solana (SOL)";
            tokenAddress = "So11111111111111111111111111111111111111112";
        }

        // 2. Detect Actor/Wallet
        const isWhale = lowerText.includes("whale") || lowerText.includes("smart money");
        const actor = isWhale ? "Whale Wallet (> $1M)" : "Any Wallet";

        // 3. Detect Action
        if (lowerText.includes("sell")) {
            action = "SELLS";
        } else if (lowerText.includes("buy")) {
            action = "BUYS";
        } else if (lowerText.includes("move") || lowerText.includes("transfer")) {
            action = "TRANSFERS";
        }

        // 4. Detect Amount/Condition
        const amountMatch = text.match(/(\$?\d+(?:,\d+)*(?:\.\d+)?[kKmMbB]?)/);
        const amount = amountMatch ? amountMatch[0] : "> $0";
        condition = `${amount}`;

        // Construct structured sentence
        if (isWhale) {
            structured = `${actor} | ${action} | ${target} worth ${condition}`;
        } else {
            structured = `${actor} | ${action} | ${target} at ${condition}`;
        }

        // Specific override for the requested example
        if (lowerText.includes("bitcoin") && lowerText.includes("100") && lowerText.includes("000")) {
            structured = "Bitcoin (BTC) | PRICE HITS | $100,000";
            target = "Bitcoin (BTC)";
            tokenAddress = "3abc...5xyz (Wrapped)";
            action = "PRICE ALERT";
            condition = "$100,000";
        } else if (lowerText.includes("whale") && lowerText.includes("sell") && lowerText.includes("1000") && lowerText.includes("bitcoin")) {
            structured = "Whale Wallet (> $1M) | SELL | > 1,000 BTC";
            target = "Bitcoin (BTC)";
            tokenAddress = "3abc...5xyz (Wrapped)";
        }


        return {
            original: text,
            structured: structured,
            confidence: 0.95,
            details: {
                target,
                action,
                condition,
                tokenAddress
            }
        };
    }
}
