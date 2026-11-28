// plays the "run finished" sound (a service worker can't play audio itself)
const a = new Audio(chrome.runtime.getURL("done.mp3"));
a.volume = 1;
a.onended = a.onerror = () => chrome.runtime.sendMessage({ type: "offscreenDone" });
a.play().catch(() => chrome.runtime.sendMessage({ type: "offscreenDone" }));
