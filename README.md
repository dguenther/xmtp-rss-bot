# xmtp-rss-bot

A chatbot that allows users to subscribe to top posts from specific subreddits via direct messages on the [XMTP network](https://xmtp.org/).

Bootstrapped from the [XMTP examples](https://github.com/ephemeraHQ/xmtp-agent-examples). 

## 🚧 🚧 WARNING 🚧 🚧

This project primarily exists to experiment with xmtp, and likely has bugs, missing features, and/or security vulnerabilities. Features may change without warning or backward compatibility.

## Commands

- `reddit`: See your current subreddit subscriptions
- `reddit <subreddit>`: Subscribe to a subreddit and get recent posts (e.g., "reddit games")
- `unsubscribe <subreddit>`: Unsubscribe from a specific subreddit
- `stop`: Unsubscribe from all subreddits

## Setup

1. Install [Bun](https://bun.sh).

2. Copy `.env.example` to `.env` and fill in the required environment variables:

```bash
cp .env.example .env
```

3. Generate keys for your bot (if needed):

```bash
bun run scripts/generateKeys.ts
```

4. Update the `.env` file with your keys and settings:

```
WALLET_KEY=0x...              # Your private key
ENCRYPTION_KEY=...            # Encryption key for the local database
XMTP_ENV=dev                  # XMTP environment (dev, production, or local)
POST_INTERVAL=60              # Check for new posts every X minutes
POST_LIMIT=5                  # Number of posts to fetch at a time
DATA_DIR=data                 # Directory to store user data
```

5. Install dependencies:

```bash
bun install
```

## Running the Bot

```bash
bun run index.ts
```

## How it Works

1. The bot connects to the XMTP network using the provided wallet key.
2. Users can subscribe to specific subreddits using commands like "reddit games".
3. The bot periodically fetches top posts from all subscribed subreddits via RSS.
4. New posts are formatted and sent only to users subscribed to that specific subreddit.
5. User subscriptions and previously sent posts are saved to disk and persist between bot restarts.
