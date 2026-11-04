# Syncdian Plugin

Automatic Obsidian synchronization for macOS, iOS, and Android. Sync notes, attachments, settings, themes, snippets, and other community plugins using GitHub login and server-side encryption.

This public repository contains **only the Obsidian plugin**. The Cloudflare backend is maintained privately at [syncdian/syncdian](https://github.com/syncdian/syncdian).

## Install with BRAT

1. Install [BRAT](https://obsidian.md/plugins/obsidian42-brat) from Obsidian Community Plugins.
2. Run **BRAT: Add a beta plugin for testing**.
3. Enter `https://github.com/syncdian/syncdian-plugin`.
4. Enable **Syncdian** in Community Plugins.
5. Open **Settings → Syncdian** and choose **Login with GitHub**.

That is the entire setup for the default tier. Your first vault is created automatically, or your existing primary vault is selected automatically. Repeat the same install and login steps on your other devices.

## Default tier

- 1 synced vault per GitHub user
- 100 MB storage per user
- Automatic vault creation and selection
- Storage usage indicator in settings

## Multi-vault tiers

Accounts with `max_vaults` greater than one can:

- Choose a vault and select **Use vault**.
- Create additional vaults while vault quota remains.
- Use different local vault names on different devices.

Vault limits and storage quotas are configured per user in D1.

## Storage upgrades

Open **Settings → Syncdian** to see current usage. Choose **Need more storage** to draft an email to `halo@syncdian.com` with your GitHub account and usage.

## Features

- GitHub Device Flow login
- Automatic first-vault setup
- Multiple users and configurable per-user tiers
- Server-side encrypted file storage
- Automatic three-way merging for text files
- Conflict markers for overlapping text edits and conflict copies for binary files
- Realtime notifications and offline catch-up
- Automatic local aliases for filenames that are invalid on Android
- Notes, attachments, settings, themes, snippets, and other plugin synchronization

Workspace layouts, caches, `.trash/`, login sessions, and device IDs remain device-local. Syncdian itself is updated through BRAT rather than synchronized.

Third-party plugin configuration can contain credentials. Syncdian encrypts it in transit and at rest, but it becomes readable on every connected device. Only connect devices you trust. Server-side encryption is not end-to-end encryption: the backend manages vault encryption keys.

## Merge behavior

- **New local vault:** downloads the selected synced vault.
- **Existing local vault:** local and remote files are merged; identical content is adopted without duplication.
- **Different text edits:** three-way merge using the last synced base version.
- **Overlapping text edits:** both sides are preserved with conflict markers.
- **Binary conflicts:** the local version is preserved as a conflict copy.
- **Edit versus delete:** edited content wins.

Sync is near-realtime at file granularity, not character-level collaborative editing.

## Development

```bash
npm install
npm run typecheck
npm run test:merge
npm run test:client
npm run build
```

Source lives in `src/`. The build produces `main.js` at the repository root.

## License

MIT
