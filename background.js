console.log("[TFV] background page loaded");

browser.browserAction.onClicked.addListener((tab) => {
  console.log("[TFV] toolbar icon clicked, tabId =", tab.id, "url =", tab.url);
  browser.tabs.sendMessage(tab.id, { type: "TFV_TOGGLE" }).then(
    () => console.log("[TFV] message delivered to tab", tab.id),
    (err) => console.error("[TFV] sendMessage FAILED:", err)
  );
});

browser.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.type === "TFV_STATE" && sender.tab) {
    browser.browserAction.setBadgeText({
      tabId: sender.tab.id,
      text: msg.active ? "ON" : ""
    });
    browser.browserAction.setBadgeBackgroundColor({
      tabId: sender.tab.id,
      color: "#e0234e"
    });
  }
});
