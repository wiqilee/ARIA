# VaultVerse Role Bot

A Discord bot for VaultVerse to manage custom roles and commands.

## Features
- Assign and remove custom roles with slash commands
- Role-based access control for specific channels
- Automatic role management for events or boosters
- Simple configuration via `.env` file

---

## Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/wiqilee/vaultverse-rolebot.git
   cd vaultverse-rolebot
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Create a `.env` file** in the project root and add your bot token:
   ```env
   TOKEN=YOUR_DISCORD_BOT_TOKEN
   CLIENT_ID=YOUR_DISCORD_CLIENT_ID
   GUILD_ID=YOUR_DISCORD_GUILD_ID
   ```

4. **Make sure `.env` is listed in `.gitignore`** so it won’t be uploaded to GitHub.

---

## Usage

### Deploy Commands
Before starting the bot, deploy your slash commands:
```bash
node deploy-commands.js
```

### Run the Bot
```bash
node index.js
```

If successful, you’ll see:
```
Bot online as VaultVerse#XXXX
```

---

## File Structure
```
vaultverse-rolebot/
│
├── .gitignore              # Files ignored by Git
├── .env                    # Environment variables (not uploaded to GitHub)
├── package.json            # Project metadata & dependencies
├── package-lock.json
├── deploy-commands.js      # Script to register slash commands
├── index.js                # Main bot file
├── check-token.js          # Token validation script
└── node_modules/           # Installed dependencies
```

---

## Example Commands
- `/addrole @username RoleName` → Assign a role to a user
- `/removerole @username RoleName` → Remove a role from a user
- `/listroles` → Show all available roles

---

## Notes
- Make sure the bot has the **Manage Roles** permission in your Discord server.
- Roles the bot manages must be **below the bot’s highest role** in the role hierarchy.

---

## License
This project is licensed under the MIT License.
