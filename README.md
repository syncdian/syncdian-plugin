# Syncdian

End-to-end encrypted Obsidian plugin for syncing notes, attachments, settings, themes, snippets, and other community plugins across macOS, iOS, and Android.

This public repository contains **only the Obsidian plugin**. The Cloudflare backend and deployment configuration are maintained separately in a private repository.

## Install with BRAT

1. Install [BRAT](https://obsidian.md/plugins/obsidian42-brat) from Obsidian Community Plugins.
2. Run **BRAT: Add a beta plugin for testing**.
3. Enter `https://github.com/vayazka/syncdian`.
4. Enable **Syncdian** in Community Plugins.
5. Open **Settings → Syncdian** and choose **Login with GitHub**.
6. Choose **Sync this vault**. Encryption is configured automatically.
7. To connect another device, choose **Get setup code** on a connected device, then **Connect this device** on the new device and paste the code.

Releases contain `main.js`, `manifest.json`, and `versions.json` as top-level assets. BRAT can install updates without manually copying files.

## Features

- GitHub Device Flow login
- Multiple users and multiple synced vaults
- Local vault names can differ across devices
- End-to-end encrypted file contents and paths
- Automatic three-way merging for text files
- Conflict markers for overlapping text edits and conflict copies for binary files
- Realtime notifications and offline catch-up
- Notes, attachments, settings, themes, snippets, and other plugin synchronization

Workspace layouts, caches, `.trash/`, login sessions, device IDs, setup material, and Syncdian vault keys remain device-local. Syncdian itself is updated through BRAT rather than synchronized.

Third-party plugin configuration can contain credentials. Syncdian encrypts it in transit and at rest, but it becomes readable on every device that unlocks the vault. Only connect devices you trust.

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
npm run build
```

Source lives in `src/`. The build produces `main.js` at the repository root.

## License

MIT
