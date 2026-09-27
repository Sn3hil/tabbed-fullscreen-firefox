# Tabbed Fullscreen

Expands the currently playing video to fill the browser tab's **viewport**
— not the OS-level Fullscreen API. Your tab bar, address bar, and other
tabs stay exactly where they are; you can switch tabs normally while the
video keeps playing full-size in its own tab.

## What it does

- Press `Ctrl+Shift+F` on any page, click the toolbar icon, or hover any
  video and click the small button that fades in at its top-right
  corner — all three toggle the same thing.
- It fills the tab's viewport (`100vw x 100vh`) with either the video
  itself, or — on players with custom overlay controls (progress bar,
  play/pause, etc.), like YouTube — the player's own wrapper element, so
  those controls keep working. See "How the resize works" below.
- Press the shortcut/icon/button again, click the small ✕ that fades in
  top-right, or press `Esc` to exit and restore everything to its
  original spot.
- Works inside iframes (e.g. embedded players) as well as the top-level page.


## Install (temporary, for testing)

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Click **Load Temporary Add-on…**.
3. Select the `manifest.json` file inside this folder.
4. The extension is now active until you restart Firefox (temporary
   add-ons are removed on restart — reload it the same way afterward).
5. **Refresh any tabs that were already open** before you loaded it —
   content scripts only attach to pages loaded after install.


MIT licensed — do whatever you like with it.
