# Treasury26

A comprehensive treasury management platform for NEAR DAOs. Manage members, process payments, create vesting schedules, track balances, and handle multi-signature approvals through Sputnik DAO integration.

## Project Structure

| Directory | Description | Documentation |
|-----------|-------------|---------------|
| [nt-be](./nt-be/) | Backend API (Rust/Axum) - Balance tracking, monitoring, CSV export | [README](./nt-be/README.md) |
| [nt-fe](./nt-fe/) | Frontend (Next.js) - Web interface for treasury management | [README](./nt-fe/README.md) |
| [contracts](./contracts/) | NEAR smart contracts for bulk payments | [README](./contracts/README.md) |
| [sandbox](./sandbox/) | Local development environment with Docker | [README](./sandbox/README.md) |
| [e2e-tests](./e2e-tests/) | End-to-end tests for contract integration | [README](./e2e-tests/bulk-payment/README.md) |

## Quick Links

- **Production Backend**: https://near-treasury-backend.onrender.com
- **Add Account for Tracking**: See [nt-be/README.md](./nt-be/README.md#1-register-an-account-for-monitoring)

## Features

### Treasury Management
- Create and configure treasuries with custom policies
- Member management with role-based permissions (proposer, approver, financial member)
- Dashboard with total balance overview and USD valuations

### Financial Operations
- Single and bulk payments in NEAR, NEP-141 tokens, and cross-chain via Intents
- Token vesting schedules with cliff dates and configurable release
- Automatic balance tracking and historical charts
- CSV export of transaction history

### DAO Integration
- Sputnik DAO proposal creation and management
- Multi-signature approval workflows
- Proposal filtering by status, token type, date, and participants

### Balance Monitoring
- Register accounts for automatic balance tracking
- Real-time balance change detection across multiple token types
- Staking rewards tracking
- Historical balance data with gap-filling

### Smart Contracts
- Bulk payment processing (up to 100 payments per batch)
- Storage credit system for batch operations
- Content-addressed payment lists (SHA-256)
- Support for NEAR, fungible tokens, and NEAR Intents

## Development

See individual README files for setup instructions:

- Backend: [nt-be/README.md](./nt-be/README.md)
- Frontend: [nt-fe/README.md](./nt-fe/README.md)
- Contracts: [contracts/README.md](./contracts/README.md)
- Local sandbox: [sandbox/README.md](./sandbox/README.md)

### Telegram Bot (Local Development)

The platform supports Telegram notifications for treasury events. To develop and test the Telegram integration locally:

#### 1. Create a Bot

Open Telegram, message [@BotFather](https://t.me/BotFather), and run `/newbot`. Save the bot token it gives you.

#### 2. Expose Your Local Backend via ngrok

Telegram requires an HTTPS URL to deliver webhook updates. Use [ngrok](https://ngrok.com/) to tunnel to your local backend (port 3002 by default):

```bash
ngrok http 3002
```

Copy the `https://` forwarding URL from the ngrok output (e.g. `https://ab12-34-56.ngrok-free.app`).

#### 3. Register the Webhook

Open this URL in your browser (replace the placeholders):

```
https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=<NGROK_URL>/api/telegram/webhook&secret_token=1234567890
```

You should see `{"ok":true,"result":true,"description":"Webhook was set"}`.

#### 4. Set Environment Variables

> **Note:** Telegram rejects `localhost` URLs in bot messages (e.g. connect-treasury links). Use `127.0.0.1` instead.

Backend (`nt-be`):
```bash
export TELEGRAM_BOT_TOKEN=<your-bot-token>
export TELEGRAM_WEBHOOK_SECRET=1234567890
export FRONTEND_BASE_URL=http://127.0.0.1:3001
```

Frontend (root `.env`):
```bash
export CORS_ALLOWED_ORIGINS=http://127.0.0.1:3001
export NEXT_PUBLIC_BACKEND_API_BASE=http://127.0.0.1:3002
```

Then start the backend and frontend as usual. Add the bot to a Telegram group — it should respond with a "Connect Treasury" button linking to your local frontend.

## 💰 Bounty Contribution

- **Task:** [Task] Improve amount formatting in Trezu app
- **Reward:** $500
- **Source:** GitHub-Paid
- **Date:** 2026-04-28

