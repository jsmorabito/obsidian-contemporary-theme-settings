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
const { Plugin, Menu, Notice, setIcon, PluginSettingTab, Setting } = require("obsidian");

const MORE_CLASS = "ct-more-button";
const READY_CLASS = "ct-has-more-menu"; // set on the explorer view once the button exists
const HIDE_TAB_LIST_CLASS = "ct-hide-tab-list"; // on <body> when the tab list button is turned off
const HIDE_MODE_BUTTON_CLASS = "ct-hide-mode-button"; // on <body> when the reading/editing button is turned off
const MODE_BUTTON_CLASS = "ct-mode-button"; // tags each note's reading/editing button (its label is translated)
const COPY_LINK_CLASS = "ct-copy-link-button"; // hover button on editor tabs that copies [[note]]
const OVERFLOW_CLASS = "ct-title-overflows"; // on an editor tab title that is cut off
const SCROLL_SPEED = 55; // px per second when a cut-off tab title scrolls on hover
const SCROLL_DELAY = 600; // ms to wait before it starts moving

const DEFAULT_SETTINGS = {
  showTabListButton: false, // the chevron at the end of a tab bar that lists open tabs
  showModeButton: false, // the note header button that switches between reading and editing
};

module.exports = class ContemporaryThemeSettings extends Plugin {
  async onload() {
    this.titleScrolls = new Map(); // tab title element -> function that stops its hover scroll
    // Editor tab headers this instance has set up -> function that removes its listeners and
    // link button. Kept per instance (not a DOM flag) so a reload, e.g. by the hot-reload plugin,
    // always sets tabs up again. Pruned as tabs close.
    this.tabHeaders = new Map();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.applySettings();
    this.addSettingTab(new ContemporarySettingTab(this.app, this));

    const inject = () => {
      this.injectAll();
      this.tagModeButtons();
      this.setUpEditorTabs();
    };
    this.registerEvent(this.app.workspace.on("layout-change", inject));
    this.registerEvent(this.app.workspace.on("active-leaf-change", inject));
    this.registerEvent(this.app.workspace.on("file-open", inject));
    this.registerEvent(this.app.workspace.on("resize", () => this.setUpEditorTabs()));
    // A tab's file can be renamed or deleted while the tab stays open in the background.
    this.registerEvent(this.app.vault.on("rename", () => this.setUpEditorTabs()));
    this.registerEvent(this.app.vault.on("delete", () => this.setUpEditorTabs()));
    this.app.workspace.onLayoutReady(inject);
  }

  onunload() {
    this.unloaded = true; // onload may still be awaiting loadData; stop it re-adding the class
    document.body.classList.remove(HIDE_TAB_LIST_CLASS, HIDE_MODE_BUTTON_CLASS);
    document.querySelectorAll("." + MORE_CLASS).forEach((el) => el.remove());
    this.titleScrolls.forEach((stop) => stop());
    this.tabHeaders.forEach((teardown) => teardown());
    document.querySelectorAll("." + MODE_BUTTON_CLASS).forEach((el) => el.classList.remove(MODE_BUTTON_CLASS));
    document.querySelectorAll("." + READY_CLASS).forEach((el) => el.classList.remove(READY_CLASS));
  }

  applySettings() {
    if (this.unloaded) return;
    document.body.classList.toggle(HIDE_TAB_LIST_CLASS, !this.settings.showTabListButton);
    document.body.classList.toggle(HIDE_MODE_BUTTON_CLASS, !this.settings.showModeButton);
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.applySettings();
  }

  // MarkdownView.modeButtonEl is internal; if it ever goes away the button just stays visible.
  tagModeButtons() {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const btn = leaf.view && leaf.view.modeButtonEl;
      if (btn && btn.classList) btn.classList.add(MODE_BUTTON_CLASS);
    }
  }

  // The file a tab shows. A background tab may still be deferred (no view.file yet),
  // so fall back to the path in its saved view state.
  leafFile(leaf) {
    const file = leaf.view && leaf.view.file;
    if (file) return file;
    const state = leaf.getViewState && leaf.getViewState();
    const path = state && state.state && state.state.file;
    return path ? this.app.vault.getFileByPath(path) : null;
  }

  // Editor tabs, in the main window and in pop-out windows (not the sidebars). Each gets a link
  // button next to its close button and hover scrolling for a cut-off title (see styles.css).
  // Uses the internal leaf.tabHeaderEl; without it a tab is simply left as it is.
  setUpEditorTabs() {
    if (this.unloaded) return;
    const { leftSplit, rightSplit } = this.app.workspace;
    const seen = new Set();

    this.app.workspace.iterateAllLeaves((leaf) => {
      const root = leaf.getRoot();
      if (root === leftSplit || root === rightSplit) return;
      const header = leaf.tabHeaderEl;
      const close = header && header.querySelector(".workspace-tab-header-inner-close-button");
      if (!close) return;
      seen.add(header);
      if (!this.tabHeaders.has(header)) this.tabHeaders.set(header, this.setUpTab(leaf, header, close));

      const btn = header.querySelector("." + COPY_LINK_CLASS);
      if (btn) btn.toggleClass("is-hidden", !this.leafFile(leaf)); // new tab, graph view, deleted file...
      this.markOverflow(header);
    });

    // Let go of tabs that have closed.
    for (const [header, teardown] of this.tabHeaders) {
      if (!seen.has(header)) teardown();
    }
  }

  setUpTab(leaf, header, close) {
    const btn = close.parentElement.createDiv({ cls: COPY_LINK_CLASS, attr: { "aria-label": "Copy link" } });
    setIcon(btn, "link");
    close.parentElement.insertBefore(btn, close);

    const onClick = (evt) => {
      evt.stopPropagation(); // don't switch tabs
      this.copyLink(leaf);
    };
    // Wait a frame so the hover icons (close, link) have taken their space before measuring.
    const onEnter = () => (header.win || window).requestAnimationFrame(() => this.startTitleScroll(header));
    const onLeave = () => {
      this.stopTitleScroll(header);
      this.markOverflow(header);
    };
    btn.addEventListener("click", onClick);
    header.addEventListener("mouseenter", onEnter);
    header.addEventListener("mouseleave", onLeave);

    return () => {
      this.stopTitleScroll(header);
      header.removeEventListener("mouseenter", onEnter);
      header.removeEventListener("mouseleave", onLeave);
      btn.remove();
      const title = header.querySelector(".workspace-tab-header-inner-title");
      if (title) title.classList.remove(OVERFLOW_CLASS);
      this.tabHeaders.delete(header);
    };
  }

  // Tag a title that is cut off, so only those get the fade at the end (styles.css).
  markOverflow(header) {
    const title = header.querySelector(".workspace-tab-header-inner-title");
    if (title) title.classList.toggle(OVERFLOW_CLASS, title.scrollWidth - title.clientWidth > 1);
  }

  // Scroll a cut-off tab title once to its end while the tab is hovered, then stop there. The fades at the
  // edges (styles.css) follow the scroll: the start fades once text has moved off the left,
  // the end fades while there is more text to the right.
  startTitleScroll(header) {
    const title = header.querySelector(".workspace-tab-header-inner-title");
    if (!title || this.titleScrolls.has(title) || !header.matches(":hover")) return;
    const max = title.scrollWidth - title.clientWidth;
    // The hover icons can be what cuts a title off, so tag it now too.
    title.classList.toggle(OVERFLOW_CLASS, max > 1);
    if (max <= 1) return;
    const win = header.win || window;
    if (win.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const travel = (max / SCROLL_SPEED) * 1000; // ms
    let raf = 0;
    let t0 = 0;

    const frame = (now) => {
      if (!t0) t0 = now;
      const t = Math.min(1, Math.max(0, (now - t0 - SCROLL_DELAY) / travel)); // constant speed, no easing
      title.scrollLeft = t * max;
      title.classList.toggle("ct-scrolled-start", t > 0.001);
      title.classList.toggle("ct-scrolled-end", t >= 1);
      if (t < 1) raf = win.requestAnimationFrame(frame); // done at the end; stays there until hover ends
    };
    raf = win.requestAnimationFrame(frame);

    this.titleScrolls.set(title, () => {
      win.cancelAnimationFrame(raf);
      title.scrollLeft = 0;
      title.classList.remove("ct-scrolled-start", "ct-scrolled-end");
      this.titleScrolls.delete(title);
    });
  }

  stopTitleScroll(header) {
    const title = header.querySelector(".workspace-tab-header-inner-title");
    const stop = title && this.titleScrolls.get(title);
    if (stop) stop();
  }

  async copyLink(leaf) {
    const file = this.leafFile(leaf);
    if (!file) return;
    const linktext = this.app.metadataCache.fileToLinktext(file, "");
    try {
      await navigator.clipboard.writeText(`[[${linktext}]]`);
      new Notice("Link copied");
    } catch (e) {
      new Notice("Couldn't copy link");
    }
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

    new Setting(containerEl)
      .setName("Show reading/editing button")
      .setDesc(
        "The note header button that switches between reading and editing view. " +
          'Switching still works with the "Toggle reading view" command and its hotkey.'
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showModeButton).onChange(async (value) => {
          this.plugin.settings.showModeButton = value;
          await this.plugin.saveSettings();
        })
      );
  }
}
