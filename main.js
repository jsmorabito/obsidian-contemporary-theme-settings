/*
 * Contemporary Theme Settings
 * Companion to the Contemporary theme. Adds a "..." button to the Files row in the
 * left sidebar (visible on hover or keyboard focus). Its menu is built from the file
 * explorer's own action buttons (new note, new folder, sort order, auto-reveal,
 * expand/collapse...). Each menu item re-fires the original button, so nothing is
 * reimplemented and buttons added by other plugins show up automatically.
 *
 * The explorer's own button row is only hidden (see styles.css) once this plugin has
 * successfully added the "..." button, so if injection ever fails the normal buttons stay.
 *
 * Relies on non-public Obsidian internals: leaf.tabHeaderEl, leaf.loadIfDeferred and the
 * explorer's .nav-buttons-container DOM. Everything is guarded, so a change there degrades
 * to "no menu, normal buttons" rather than breaking the explorer.
 */
const { Plugin, Menu, setIcon, PluginSettingTab, Setting } = require("obsidian");

const MORE_CLASS = "ct-more-button";
const READY_CLASS = "ct-has-more-menu"; // set on the explorer view once the button exists
const HIDE_TAB_LIST_CLASS = "ct-hide-tab-list"; // on <body> when the tab list button is turned off

const DEFAULT_SETTINGS = {
  showTabListButton: false, // the chevron at the end of a tab bar that lists open tabs
};

module.exports = class ContemporaryThemeSettings extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.applySettings();
    this.addSettingTab(new ContemporarySettingTab(this.app, this));

    const inject = () => this.injectAll();
    this.registerEvent(this.app.workspace.on("layout-change", inject));
    this.registerEvent(this.app.workspace.on("active-leaf-change", inject));
    this.app.workspace.onLayoutReady(inject);
  }

  onunload() {
    this.unloaded = true; // onload may still be awaiting loadData; stop it re-adding the class
    document.body.classList.remove(HIDE_TAB_LIST_CLASS);
    document.querySelectorAll("." + MORE_CLASS).forEach((el) => el.remove());
    document.querySelectorAll("." + READY_CLASS).forEach((el) => el.classList.remove(READY_CLASS));
  }

  applySettings() {
    if (this.unloaded) return;
    document.body.classList.toggle(HIDE_TAB_LIST_CLASS, !this.settings.showTabListButton);
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.applySettings();
  }

  injectAll() {
    const leftSplit = this.app.workspace.leftSplit;
    for (const leaf of this.app.workspace.getLeavesOfType("file-explorer")) {
      // Only the left sidebar's Files row is styled as a labelled row; leave other locations alone.
      if (leaf.getRoot() !== leftSplit) continue;

      const inner = leaf.tabHeaderEl && leaf.tabHeaderEl.querySelector(".workspace-tab-header-inner");
      const content = leaf.view && leaf.view.containerEl;
      if (!inner || !content) continue;

      if (!inner.querySelector("." + MORE_CLASS)) {
        const btn = inner.createDiv({
          cls: `clickable-icon ${MORE_CLASS}`,
          attr: { "aria-label": "More actions", role: "button", tabindex: "0" },
        });
        setIcon(btn, "ellipsis");

        btn.addEventListener("click", (evt) => {
          evt.stopPropagation(); // don't let the tab header treat this as "switch to Files"
          this.showMenu(leaf, btn, evt);
        });
        btn.addEventListener("keydown", (evt) => {
          if (evt.key !== "Enter" && evt.key !== " ") return;
          evt.preventDefault();
          evt.stopPropagation();
          this.showMenu(leaf, btn, null);
        });
      }
      content.classList.add(READY_CLASS);
    }
  }

  async showMenu(leaf, btn, evt) {
    // A background tab may not be rendered yet; make sure its buttons exist.
    if (leaf.loadIfDeferred) await leaf.loadIfDeferred();
    const bar = leaf.view.containerEl.querySelector(".nav-buttons-container");
    if (!bar) return;

    const actions = Array.from(bar.children).filter(
      (el) => el.classList.contains("nav-action-button") && el.getAttribute("aria-label")
    );

    const menu = new Menu();
    for (const el of actions) {
      const svg = el.querySelector("svg");
      const lucide = svg && Array.from(svg.classList).find((c) => c.startsWith("lucide-"));
      menu.addItem((item) => {
        item.setTitle(el.getAttribute("aria-label"));
        if (lucide) item.setIcon(lucide.slice("lucide-".length));
        if (el.classList.contains("is-active")) item.setChecked(true);
        item.onClick(() => {
          // Buttons that open their own menu (sort order) position it from the click
          // coordinates, so anchor them to the "..." button.
          const r = btn.getBoundingClientRect();
          el.dispatchEvent(
            new MouseEvent("click", { bubbles: true, cancelable: true, clientX: r.left, clientY: r.bottom })
          );
        });
      });
    }

    btn.classList.add("has-active-menu");
    menu.onHide(() => btn.classList.remove("has-active-menu"));

    if (evt) {
      menu.showAtMouseEvent(evt);
    } else {
      const r = btn.getBoundingClientRect();
      menu.showAtPosition({ x: r.left, y: r.bottom });
    }
  }
};

class ContemporarySettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Show tab list button")
      .setDesc(
        "The chevron at the end of a tab bar. Its menu lists open tabs and has Stack tabs and Close all; " +
          "those are also in the command palette. The left sidebar never shows it (the theme hides it there)."
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showTabListButton).onChange(async (value) => {
          this.plugin.settings.showTabListButton = value;
          await this.plugin.saveSettings();
        })
      );
  }
}
