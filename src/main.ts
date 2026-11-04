import { App, Notice, Plugin, PluginSettingTab, Setting, TFile } from "obsidian";
import { SyncClient } from "./client";
import { SyncEngine } from "./sync";
import { EMPTY_DATA, type CloudVault, type DeviceChallenge, type PluginData, type StoragePlan, type VaultSyncState } from "./types";

export default class SyncdianPlugin extends Plugin {
  data!: PluginData;
  client!: SyncClient;
  cloudVaults: CloudVault[] = [];
  plan: StoragePlan | null = null;
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
      onSyncComplete: () => void this.refreshUsage(),
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
      const interval = Math.max(challenge.interval, 5);
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
      this.plan = result.plan;
      this.data.user = result.user;
      if (result.vaults.length === 0) {
        await this.createVault();
        return;
      }
      if (result.plan.maxVaults === 1) {
        const changed = this.data.activeVaultId !== result.vaults[0].id;
        this.data.activeVaultId = result.vaults[0].id;
        await this.persist();
        if (changed) this.restartEngine();
      } else if (!result.vaults.some((vault) => vault.id === this.data.activeVaultId)) {
        this.data.activeVaultId = "";
        this.statusBar.setText("Syncdian: choose vault");
        await this.persist();
      }
      this.refreshDisplay();
    } catch (caught) {
      console.error("Syncdian could not initialize vaults", caught);
      new Notice(`Syncdian: ${caught instanceof Error ? caught.message : "Could not initialize vault"}`, 8000);
    }
  }

  async refreshUsage(): Promise<void> {
    if (!this.data.sessionToken) return;
    try {
      const result = await this.client.listVaults();
      this.cloudVaults = result.vaults;
      this.plan = result.plan;
      this.refreshDisplay();
    } catch {
      // Usage refresh is non-critical and must not interrupt file sync.
    }
  }

  async createVault(): Promise<void> {
    if (!this.data.sessionToken) return;
    try {
      const vault = await this.client.createVault(this.app.vault.getName());
      this.data.activeVaultId = vault.id;
      this.data.states[vault.id] = { initialized: false, lastRevision: 0, files: {} };
      await this.persist();
      await this.refreshUsage();
      this.restartEngine();
      this.refreshDisplay();
    } catch (caught) {
      new Notice(`Syncdian: ${caught instanceof Error ? caught.message : "Could not create vault"}`, 8000);
    }
  }

  async selectVault(vaultId: string): Promise<void> {
    if (!vaultId) return;
    this.data.activeVaultId = vaultId;
    await this.persist();
    this.restartEngine();
    this.refreshDisplay();
  }

  async logout(): Promise<void> {
    this.engine.stop();
    try { await this.client.logout(); } catch { /* local logout still proceeds */ }
    this.data.sessionToken = "";
    this.data.user = null;
    this.data.activeVaultId = "";
    this.data.vaultKeys = {};
    this.cloudVaults = [];
    this.plan = null;
    await this.persist();
    this.statusBar.setText("Syncdian: login required");
    this.refreshDisplay();
  }

  private async handleStatusClick(): Promise<void> {
    if (!this.data.sessionToken) {
      await this.login();
      return;
    }
    if (!this.data.activeVaultId) {
      const setting = (this.app as unknown as { setting: { open(): void; openTabById(id: string): void } }).setting;
      setting.open();
      setting.openTabById(this.manifest.id);
      return;
    }
    this.engine.syncNow();
  }

  private restartEngine(): void {
    this.engine.stop();
    void this.engine.start();
  }
}

class SyncdianSettingTab extends PluginSettingTab {
  private selectedVaultId = "";

  constructor(app: App, private readonly plugin: SyncdianPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Syncdian" });
    containerEl.createEl("p", { text: "Secure vault, settings, themes, and plugin synchronization across your devices." });

    if (!this.plugin.data.sessionToken) {
      new Setting(containerEl).setName("GitHub account").setDesc("Login once and synchronization starts automatically.")
        .addButton((button) => button.setButtonText("Login with GitHub").setCta().onClick(() => void this.plugin.login()));
      if (this.plugin.challenge) {
        new Setting(containerEl).setName("GitHub verification").setDesc(`Enter code ${this.plugin.challenge.userCode} in the browser.`)
          .addButton((button) => button.setButtonText("Open GitHub").onClick(() => {
            if (this.plugin.challenge) window.open(this.plugin.challenge.verificationUriComplete ?? this.plugin.challenge.verificationUri, "_blank");
          }));
      }
      return;
    }

    new Setting(containerEl).setName("GitHub account").setDesc(`Logged in as @${this.plugin.data.user?.login ?? "unknown"}`)
      .addButton((button) => button.setButtonText("Logout").onClick(() => void this.plugin.logout()));

    const active = this.plugin.cloudVaults.find((vault) => vault.id === this.plugin.data.activeVaultId);
    if (active) {
      containerEl.createEl("p", { text: `Syncing “${active.name}”.` });
      new Setting(containerEl).setName("Sync now")
        .addButton((button) => button.setButtonText("Sync now").setCta().onClick(() => this.plugin.syncNow()));
    }

    const plan = this.plugin.plan;
    if (plan && plan.maxVaults > 1) {
      this.selectedVaultId ||= this.plugin.data.activeVaultId || this.plugin.cloudVaults[0]?.id || "";
      new Setting(containerEl).setName("Vault").setDesc("Choose which synced vault to use on this device.")
        .addDropdown((dropdown) => {
          for (const vault of this.plugin.cloudVaults) dropdown.addOption(vault.id, vault.name);
          dropdown.setValue(this.selectedVaultId).onChange((value) => { this.selectedVaultId = value; });
        })
        .addButton((button) => button.setButtonText("Use vault").onClick(() => void this.plugin.selectVault(this.selectedVaultId)));
      if (this.plugin.cloudVaults.length < plan.maxVaults) {
        new Setting(containerEl).setName("New vault").setDesc(`${this.plugin.cloudVaults.length} of ${plan.maxVaults} vaults used.`)
          .addButton((button) => button.setButtonText("Create new vault").onClick(() => void this.plugin.createVault()));
      }
    }

    if (plan) {
      const percentage = Math.min(100, Math.round((plan.usedBytes / plan.storageQuotaBytes) * 100));
      const setting = new Setting(containerEl).setName("Storage").setDesc(`${formatBytes(plan.usedBytes)} of ${formatBytes(plan.storageQuotaBytes)} used (${percentage}%).`);
      const progress = setting.controlEl.createEl("progress");
      progress.max = plan.storageQuotaBytes;
      progress.value = plan.usedBytes;
      progress.style.width = "100%";
      new Setting(containerEl).setName("Need more storage?").setDesc("Email us with your account and current usage.")
        .addButton((button) => button.setButtonText("Need more storage").onClick(() => {
          const subject = encodeURIComponent("Syncdian storage upgrade");
          const body = encodeURIComponent(`Hi Vayazka,\n\nI need more Syncdian storage.\nGitHub: @${this.plugin.data.user?.login ?? "unknown"}\nUsage: ${formatBytes(plan.usedBytes)} of ${formatBytes(plan.storageQuotaBytes)}\n`);
          window.open(`mailto:helo@vayazka.com?subject=${subject}&body=${body}`, "_blank");
        }));
    }

    new Setting(containerEl).setName("Automatic sync").addToggle((toggle) => toggle.setValue(this.plugin.data.autoSync).onChange((value) => {
      this.plugin.data.autoSync = value;
      void this.plugin.persist();
    }));
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
