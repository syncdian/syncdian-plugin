import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile } from "obsidian";
import { SyncClient } from "./client";
import { generateRecoveryCode, generateVaultKey, unwrapVaultKey, wrapVaultKey } from "./crypto";
import { SyncEngine } from "./sync";
import { EMPTY_DATA, type CloudVault, type DeviceChallenge, type PluginData, type VaultSyncState } from "./types";

export default class SyncdianPlugin extends Plugin {
  data!: PluginData;
  client!: SyncClient;
  cloudVaults: CloudVault[] = [];
  challenge: DeviceChallenge | null = null;
  private engine!: SyncEngine;
  private statusBar!: HTMLElement;
  private settingsTab?: SyncdianSettingTab;
  private loginInProgress = false;

  async onload(): Promise<void> {
    const saved = await this.loadData() as Partial<PluginData> | null;
    this.data = {
      ...EMPTY_DATA,
      ...saved,
      vaultKeys: saved?.vaultKeys ?? {},
      states: saved?.states ?? {},
      user: saved?.user ?? null,
    };
    this.data.deviceId ||= crypto.randomUUID();
    this.client = new SyncClient(() => this.data);
    this.statusBar = this.addStatusBarItem();
    this.statusBar.setText(this.data.sessionToken ? "Syncdian: set up sync" : "Syncdian: login required");
    this.statusBar.style.cursor = "pointer";
    this.statusBar.setAttribute("title", "Click to continue Syncdian setup or sync now");
    this.statusBar.addEventListener("click", () => void this.handleStatusClick());
    this.engine = new SyncEngine({
      app: this.app,
      data: () => this.data,
      state: () => this.activeState(),
      persist: () => this.persist(),
      status: (text) => this.statusBar.setText(text),
    });
    this.settingsTab = new SyncdianSettingTab(this.app, this);
    this.addSettingTab(this.settingsTab);
    this.addCommand({ id: "sync-now", name: "Sync now", callback: () => this.engine.syncNow() });
    this.registerEvent(this.app.vault.on("create", (file) => {
      if (file instanceof TFile) this.engine.localChanged(file.path);
    }));
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (file instanceof TFile) this.engine.localChanged(file.path);
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      if (file instanceof TFile) this.engine.localDeleted(file.path);
    }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (file instanceof TFile) this.engine.localRenamed(file.path, oldPath);
    }));
    await this.persist();
    this.app.workspace.onLayoutReady(() => void this.engine.start());
    if (this.data.sessionToken) void this.refreshVaults();
  }

  onunload(): void {
    this.engine?.stop();
  }

  async persist(): Promise<void> {
    await this.saveData(this.data);
  }

  syncNow(): void {
    this.engine.syncNow();
  }

  private async handleStatusClick(): Promise<void> {
    if (!this.data.sessionToken) {
      await this.login();
      return;
    }
    if (!this.data.activeVaultId || !this.data.vaultKeys[this.data.activeVaultId]) {
      const setting = (this.app as unknown as { setting: { open(): void; openTabById(id: string): void } }).setting;
      setting.open();
      setting.openTabById(this.manifest.id);
      return;
    }
    this.engine.syncNow();
  }

  activeVaultIdSafe(): string {
    return this.data.activeVaultId || this.cloudVaults[0]?.id || "";
  }

  activeState(): VaultSyncState {
    const id = this.data.activeVaultId || "default";
    this.data.states[id] ||= { initialized: false, lastRevision: 0, files: {} };
    return this.data.states[id];
  }

  refreshDisplay(): void {
    this.settingsTab?.display();
  }

  async login(): Promise<void> {
    if (this.loginInProgress) return;
    this.loginInProgress = true;
    try {
      this.challenge = await this.client.startLogin();
      this.refreshDisplay();
      const challenge = this.challenge;
      window.open(challenge.verificationUriComplete ?? challenge.verificationUri, "_blank");
      let interval = Math.max(challenge.interval, 5);
      const deadline = Date.now() + challenge.expiresIn * 1000;
      while (Date.now() < deadline && this.challenge === challenge) {
        await new Promise((resolve) => setTimeout(resolve, interval * 1000));
        const result = await this.client.pollLogin(challenge.deviceCode);
        if (result.status === "complete" && result.sessionToken && result.user) {
          this.data.sessionToken = result.sessionToken;
          this.data.user = result.user;
          this.data.activeVaultId = "";
          this.statusBar.setText("Syncdian: set up sync");
          this.challenge = null;
          await this.persist();
          await this.refreshVaults();
          this.refreshDisplay();
          new Notice(`Syncdian: logged in as ${result.user.login}`);
          return;
        }
        if (result.status === "denied") throw new Error("GitHub login was denied or expired");
      }
      throw new Error("GitHub login expired");
    } catch (caught) {
      new Notice(`Syncdian: ${caught instanceof Error ? caught.message : "Login failed"}`, 8000);
    } finally {
      this.loginInProgress = false;
      this.challenge = null;
      this.refreshDisplay();
    }
  }

  async refreshVaults(): Promise<void> {
    if (!this.data.sessionToken) return;
    try {
      const result = await this.client.listVaults();
      this.cloudVaults = result.vaults;
      this.data.user = result.user;
      this.refreshDisplay();
    } catch (caught) {
      console.error("Syncdian could not list vaults", caught);
    }
  }

  async createVault(): Promise<void> {
    if (!this.data.sessionToken) return;
    try {
      const vaultKey = generateVaultKey();
      const recoveryCode = generateRecoveryCode();
      const wrapped = await wrapVaultKey(vaultKey, recoveryCode);
      const vault = await this.client.createVault(this.app.vault.getName(), wrapped);
      this.data.vaultKeys[vault.id] = vaultKey;
      this.data.activeVaultId = vault.id;
      this.data.states[vault.id] = { initialized: false, lastRevision: 0, files: {} };
      await this.persist();
      await this.refreshVaults();
      this.restartEngine();
      new SetupCodeModal(this.app, recoveryCode).open();
      this.refreshDisplay();
    } catch (caught) {
      new Notice(`Syncdian: ${caught instanceof Error ? caught.message : "Could not create vault"}`, 8000);
    }
  }

  async unlockVault(vaultId: string, setupCode: string): Promise<void> {
    if (!vaultId) {
      new Notice("Syncdian: choose a synced vault");
      return;
    }
    try {
      if (!this.data.vaultKeys[vaultId]) {
        if (!setupCode) {
          new Notice("Syncdian: enter the setup code from a connected device");
          return;
        }
        const wrapped = await this.client.getVaultKey(vaultId);
        this.data.vaultKeys[vaultId] = await unwrapVaultKey(wrapped, setupCode);
      }
      this.data.activeVaultId = vaultId;
      await this.persist();
      this.restartEngine();
      this.refreshDisplay();
    } catch (caught) {
      delete this.data.vaultKeys[vaultId];
      new Notice("Syncdian: setup code is incorrect or the vault could not be opened", 8000);
    }
  }

  async connectAnotherDevice(): Promise<void> {
    const vaultId = this.data.activeVaultId;
    const vaultKey = this.data.vaultKeys[vaultId];
    if (!vaultId || !vaultKey) return;
    try {
      const setupCode = generateRecoveryCode();
      const wrapped = await wrapVaultKey(vaultKey, setupCode);
      await this.client.updateVaultKey(vaultId, wrapped);
      new SetupCodeModal(this.app, setupCode).open();
    } catch (caught) {
      new Notice(`Syncdian: ${caught instanceof Error ? caught.message : "Could not create setup code"}`, 8000);
    }
  }

  async logout(): Promise<void> {
    this.engine.stop();
    try { await this.client.logout(); } catch { /* local logout still proceeds */ }
    this.data.sessionToken = "";
    this.data.user = null;
    this.data.activeVaultId = "";
    this.data.vaultKeys = {};
    this.cloudVaults = [];
    await this.persist();
    this.statusBar.setText("Syncdian: login required");
    this.refreshDisplay();
  }

  private restartEngine(): void {
    this.engine.stop();
    void this.engine.start();
  }
}

class SyncdianSettingTab extends PluginSettingTab {
  private selectedVaultId = "";
  private recoveryCode = "";

  constructor(app: App, private readonly plugin: SyncdianPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Syncdian" });
    containerEl.createEl("p", {
      text: "End-to-end encrypted vault, settings, themes, and plugin synchronization. Local vault names can be different on every device.",
    });

    if (!this.plugin.data.sessionToken) {
      new Setting(containerEl).setName("GitHub account").setDesc("Sign in with GitHub Device Flow; no client secret is stored in the plugin.")
        .addButton((button) => button.setButtonText("Login with GitHub").setCta().onClick(() => void this.plugin.login()));
      if (this.plugin.challenge) {
        const setting = new Setting(containerEl).setName("GitHub verification").setDesc(`Enter code ${this.plugin.challenge.userCode} in the browser.`);
        setting.addButton((button) => button.setButtonText("Open GitHub").onClick(() => {
          if (this.plugin.challenge) window.open(this.plugin.challenge.verificationUriComplete ?? this.plugin.challenge.verificationUri, "_blank");
        }));
      }
      return;
    }

    new Setting(containerEl).setName("GitHub account").setDesc(`Logged in as @${this.plugin.data.user?.login ?? "unknown"}`)
      .addButton((button) => button.setButtonText("Logout").onClick(() => void this.plugin.logout()));

    const active = this.plugin.cloudVaults.find((vault) => vault.id === this.plugin.data.activeVaultId);
    if (active) {
      containerEl.createEl("p", { text: `This vault is synced as “${active.name}”.` });
      new Setting(containerEl).setName("Sync now").setDesc("Check for changes on this device and your other devices.")
        .addButton((button) => button.setButtonText("Sync now").setCta().onClick(() => this.plugin.syncNow()));
      new Setting(containerEl).setName("Connect another device").setDesc("Get a setup code to connect a phone, tablet, or another computer.")
        .addButton((button) => button.setButtonText("Get setup code").onClick(() => void this.plugin.connectAnotherDevice()));
    } else if (this.plugin.cloudVaults.length === 0) {
      new Setting(containerEl)
        .setName("Sync this vault")
        .setDesc(`Start syncing “${this.plugin.app.vault.getName()}”. Encryption is set up automatically.`)
        .addButton((button) => button.setButtonText("Sync this vault").setCta().onClick(() => void this.plugin.createVault()));
    } else {
      this.selectedVaultId ||= this.plugin.activeVaultIdSafe();
      if (this.plugin.cloudVaults.length > 1) {
        new Setting(containerEl).setName("Synced vault").setDesc("Choose the vault you want to use on this device.")
          .addDropdown((dropdown) => {
            for (const vault of this.plugin.cloudVaults) dropdown.addOption(vault.id, vault.name);
            dropdown.setValue(this.selectedVaultId).onChange((value) => { this.selectedVaultId = value; });
          });
      } else {
        containerEl.createEl("p", { text: `Connect this device to “${this.plugin.cloudVaults[0].name}”.` });
      }
      if (!this.plugin.data.vaultKeys[this.selectedVaultId]) {
        new Setting(containerEl).setName("Setup code").setDesc("On a connected device, open Syncdian and choose Get setup code.")
          .addText((text) => {
            text.inputEl.type = "password";
            text.setPlaceholder("Paste setup code").onChange((value) => { this.recoveryCode = value.trim(); });
          });
      }
      new Setting(containerEl).addButton((button) => button.setButtonText("Connect this device").setCta().onClick(() => {
        void this.plugin.unlockVault(this.selectedVaultId, this.recoveryCode);
      }));
    }

    new Setting(containerEl).setName("Automatic sync").addToggle((toggle) => toggle.setValue(this.plugin.data.autoSync).onChange((value) => {
      this.plugin.data.autoSync = value;
      void this.plugin.persist();
    }));

    if (active || this.plugin.cloudVaults.length > 0) {
      new Setting(containerEl).setName("Create a separate synced vault").setDesc("Keep the current vault separate and sync this local vault as a new one.")
        .addButton((button) => button.setButtonText("Create separate vault").onClick(() => void this.plugin.createVault()));
    }
  }
}

class SetupCodeModal extends Modal {
  constructor(app: App, private readonly code: string) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Connect another device" });
    contentEl.createEl("p", { text: "Copy this setup code, then choose Connect this device in Syncdian on your other device. You can generate a new code here anytime." });
    const codeEl = contentEl.createEl("pre", { text: this.code });
    codeEl.style.userSelect = "all";
    codeEl.style.wordBreak = "break-all";
    new Setting(contentEl).addButton((button) => button.setButtonText("Copy code").onClick(() => {
      void navigator.clipboard.writeText(this.code);
      new Notice("Syncdian: setup code copied");
    })).addButton((button) => button.setButtonText("Done").setCta().onClick(() => this.close()));
  }
}
